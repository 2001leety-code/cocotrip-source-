/**
 * payment-review — capture 무결성 불일치의 durable 격리 기록 (money-critical).
 *
 * 왜: 불일치는 **돈이 이미 캡처된 뒤** 발견된다. 그래서
 *   - 일반 실패(재시도 가능)로 버리면 안 된다 → 사용자가 재결제 시도 = 이중청구 위험.
 *   - 예약을 CONFIRMED 로 확정해서도 안 된다 → 결제와 다른 예약이 확정됨.
 *   → 결제 기록은 남기고 예약은 확정하지 않는 **격리 상태**가 필요하다.
 *
 * ⚠️ Telegram 은 알림 수단일 뿐 SSOT 가 아니다 (알림 유실/스로틀 = 사고 은폐).
 *    Firestore `payment_reviews/{orderID}` 가 SSOT — 운영자 조회·해결의 기준.
 *
 * 상태 흐름:
 *   CREATED → CAPTURED_VALIDATED → CONFIRMED
 *           → CAPTURED_MISMATCH  → PAYMENT_REVIEW → (REFUND_PENDING → REFUNDED | MANUALLY_CONFIRMED)
 */

export const PAYMENT_REVIEW_STATUS = 'PAYMENT_REVIEW';

/**
 * 해결(resolution) 값 SSOT — 격리 해제 판정에 쓰인다.
 * ⚠️ 리터럴을 여기저기 하드코딩하면 판정부(paymentGate)와 기록부가 조용히 어긋난다
 *    (한쪽 오타 = 영구 격리 또는 무단 해제). 반드시 이 상수를 import 해서 쓸 것.
 *
 * MANUALLY_CONFIRMED — 운영자가 돈을 확인하고 수동 확정. **이행 허용.**
 * REFUNDED           — 환불로 종결. 돈이 없으므로 이행 금지.
 * REJECTED           — 확정하지 않고 종결. 이행 금지.
 */
export const PAYMENT_REVIEW_RESOLUTION = Object.freeze({
  MANUALLY_CONFIRMED: 'MANUALLY_CONFIRMED',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
});

/** 이 resolution 만 이행(유료 콘텐츠 발급)을 허용한다. */
export function isReviewFulfillable(review) {
  if (!review) return false;
  return review.resolvedAt != null && review.resolution === PAYMENT_REVIEW_RESOLUTION.MANUALLY_CONFIRMED;
}

/**
 * 비민감 capture 요약 (원본 전체를 저장하지 않음 — PII/카드정보 보존 금지).
 * @param {object} capture PayPal capture 응답
 * @returns {object}
 */
export function summarizeCapture(capture) {
  const node = capture?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderStatus: capture?.status ?? '',
    captureStatus: node?.status ?? '',
    captureID: node?.id ?? '',
    amount: node?.amount ?? null,
    purchaseUnitCount: Array.isArray(capture?.purchase_units) ? capture.purchase_units.length : 0,
    captureCount: Array.isArray(capture?.purchase_units?.[0]?.payments?.captures)
      ? capture.purchase_units[0].payments.captures.length : 0,
    createTime: node?.create_time ?? capture?.create_time ?? '',
  };
}

/**
 * payment_reviews 문서 본문 생성 (순수 — 테스트 용이).
 *
 * @param {object} p
 * @param {'single'|'cart'} p.flow
 * @param {string} p.orderID
 * @param {object} p.verdict            verifyCaptureIntegrity 의 실패 결과 {code, detail, ...}
 * @param {object} p.capture            PayPal capture 응답
 * @param {number} [p.expectedAmountMinor]
 * @param {string} [p.expectedCurrency]
 * @param {string} [p.userEmail]
 * @param {string} [p.payerEmail]
 * @returns {object}
 */
export function buildPaymentReviewDoc({
  flow, orderID, verdict = {}, capture, expectedAmountMinor = null, expectedCurrency = 'USD',
  userEmail = '', payerEmail = '',
  // 운영자가 MANUALLY_CONFIRMED / REFUNDED 로 해결하려면 아래가 필요하다.
  // 없으면 격리 기록만 남고 "무엇을 확정할지" 를 알 수 없어 해결 자체가 불가능해진다.
  coupon = null,        // { couponDocId, couponUserId, promoCode } — 소진된 쿠폰 복구 판단용
  bookingPayload = null, // 확정 시 재구성할 예약 내용 (PII 최소화해서 호출자가 전달)
}) {
  const summary = summarizeCapture(capture);
  return {
    ...(coupon ? { coupon } : {}),
    ...(bookingPayload ? { bookingPayload } : {}),
    orderID,
    flow,
    status: PAYMENT_REVIEW_STATUS,
    // 왜 격리됐는가
    mismatchCode: verdict.code || 'UNKNOWN',
    mismatchDetail: verdict.detail || '',
    // 기대 vs 실제 (최소단위 정수 — 부동소수점 금지)
    expectedAmountMinor,
    expectedCurrency: String(expectedCurrency || '').toUpperCase(),
    actualAmountMinor: Number.isSafeInteger(verdict.amountMinor) ? verdict.amountMinor : null,
    actualCurrency: verdict.currency || summary.amount?.currency_code || '',
    // 돈은 이미 나갔다는 사실을 명시적으로 기록
    paymentCaptured: summary.captureStatus === 'COMPLETED',
    captureID: verdict.captureID || summary.captureID || '',
    captureStatus: summary.captureStatus,
    rawCaptureSummary: summary,
    userEmail: (userEmail || '').toLowerCase(),
    payerEmail,
    // 운영자 해결 추적 (미해결 = null)
    resolvedAt: null,
    resolvedBy: null,
    resolution: null, // 'MANUALLY_CONFIRMED' | 'REFUNDED' | ...
    auditNote: null,
  };
}

/**
 * payment_reviews/{orderID} 기록 (best-effort 아님 — 실패 시 호출자에게 throw).
 * 이 쓰기가 실패하면 캡처된 돈의 유일한 durable 기록이 사라지므로 조용히 무시하지 않는다.
 *
 * @param {object} p
 * @param {object} p.db Firestore admin db
 * @param {object} p.serverTimestamp FieldValue.serverTimestamp 결과
 * @returns {Promise<object>} 기록된 doc
 */
export async function recordPaymentReview({ db, serverTimestamp, ...rest }) {
  const doc = buildPaymentReviewDoc(rest);
  // ⚠️ merge 로 쓰되 해결 필드(resolvedAt/resolvedBy/resolution/auditNote)는 **덮어쓰지 않는다** —
  //   같은 orderID 가 재기록될 때 null 로 리셋되면 운영자가 이미 해결한 건이 미해결로 되돌아간다.
  const { resolvedAt, resolvedBy, resolution, auditNote, ...rest2 } = doc;
  const ref = db.collection('payment_reviews').doc(rest.orderID);
  const existing = await ref.get().catch(() => null);
  const alreadyExists = !!(existing && existing.exists);
  await ref.set({
    ...rest2,
    // 신규일 때만 해결 필드를 미해결(null)로 초기화.
    ...(alreadyExists ? {} : { resolvedAt, resolvedBy, resolution, auditNote }),
    ...(alreadyExists ? {} : { createdAt: serverTimestamp }),
    updatedAt: serverTimestamp,
  }, { merge: true });
  return doc;
}

/**
 * 격리 해결 **기록** (P1, 2026-07-15). 환불·확정을 실행하지 않는다 — 기록만.
 *
 * 이전엔 이 writer 가 코드베이스에 없어서 격리 해제가 **Firebase 콘솔 수동 편집뿐**이었다.
 * 정상 고객이 오격리되면 풀어줄 제품 표면이 아예 없었다.
 *
 * ⚠️ recordPaymentReview 를 재사용할 수 없다 — 그 함수는 해결 필드를 의도적으로 벗겨내고
 *    기존 문서엔 재주입하지 않는다(바로 위 주석). 그래서 별도 경로다.
 * ⚠️ 4필드를 **원자적으로 함께** 쓴다. isReviewFulfillable 이 `resolvedAt != null &&
 *    resolution === MANUALLY_CONFIRMED` 를 AND 로 보므로, 한쪽만 쓰면 영구 격리(또는 무단 해제).
 * ⚠️ 이미 해결된 건은 덮어쓰지 않는다(멱등 + 감사 무결성). 운영자 더블클릭에도 최초 판단이 남는다.
 *
 * @param {object} args
 * @param {object} args.db — Admin SDK Firestore
 * @param {*} args.serverTimestamp — FieldValue.serverTimestamp()
 * @param {string} args.orderID
 * @param {string} args.resolution — PAYMENT_REVIEW_RESOLUTION 의 값 (리터럴 하드코딩 금지)
 * @param {string} args.resolvedBy — 운영자 이메일 (verifyAdminToken 의 auth.email)
 * @param {string} [args.auditNote]
 * @returns {Promise<{ok: true, alreadyResolved?: boolean} | {ok: false, code: string}>}
 */
export async function resolvePaymentReview({ db, serverTimestamp, orderID, resolution, resolvedBy, auditNote }) {
  if (!db || !orderID) return { ok: false, code: 'BAD_REQUEST' };
  if (!Object.values(PAYMENT_REVIEW_RESOLUTION).includes(resolution)) return { ok: false, code: 'INVALID_RESOLUTION' };
  if (!resolvedBy) return { ok: false, code: 'NO_RESOLVER' };

  const ref = db.collection('payment_reviews').doc(orderID);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: 'REVIEW_NOT_FOUND' };
  const cur = snap.data() || {};
  if (cur.resolvedAt != null) return { ok: true, alreadyResolved: true };

  await ref.set({
    resolution,
    resolvedBy,
    resolvedAt: serverTimestamp,
    auditNote: auditNote || null,
    updatedAt: serverTimestamp,
  }, { merge: true });
  return { ok: true, alreadyResolved: false };
}

/**
 * 불일치 시 클라이언트 응답 본문.
 * 핵심: `retryable:false` — 사용자가 재결제하면 이중청구. 일반 성공/실패로 표시 금지.
 *
 * ⚠️ paymentCaptured 를 참으로 **단정하지 않는다.** DECLINED/NO_CAPTURE_NODE 처럼 돈이 실제로
 *   이동하지 않은 verdict 에서 "결제 접수됨 · 재결제 마세요" 라고 하면, 사용자는 결제됐다고 믿는데
 *   실제론 안 됐고 lock 은 이미 'captured' 라 재시도도 409 → 매출 손실 + 신뢰 손상.
 *   실제 capture status 에서 파생한다.
 *
 * @param {object} p
 * @param {object} [p.capture] PayPal capture 응답 (paymentCaptured 파생용)
 * @returns {object}
 */
export function buildPaymentReviewResponse({ orderID, captureID, message, capture } = {}) {
  const captured = summarizeCapture(capture).captureStatus === 'COMPLETED';
  return {
    ok: true,
    finalized: false,
    retryable: false,
    paymentCaptured: captured,
    paymentStatus: captured ? 'CAPTURED' : 'NOT_CAPTURED',
    bookingStatus: PAYMENT_REVIEW_STATUS,
    orderID,
    captureID: captureID || '',
    message: message || (captured
      ? 'Payment was received. Your booking is pending manual verification.'
      : 'We could not complete your payment. Our team is checking it — please contact us instead of paying again.'),
  };
}
