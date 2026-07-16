/**
 * Vercel API Route: Cancel Booking + PayPal Refund
 * POST /api/cancelBooking
 * Headers: Authorization: Bearer <Firebase ID token>
 * body: { bookingID, reason?, tier? }
 *
 * 플로우:
 *   1. bookings/{bookingID} 조회 + 소유자 검증 (verified auth.email)
 *   2. evaluateRefundPolicy() 로 환불율 결정
 *   3. PayPal /v2/payments/captures/{captureID}/refund 호출
 *   4. bookings doc 업데이트 (status=CANCELED, refundID, refundedAmount, canceledReason)
 *   5. Google Sheets 상태 업데이트 (best-effort)
 *   6. Telegram 알림 (태연님)
 *
 * Security (PR #418, Audit W-C4 — 2026-05-13): body.userEmail 신뢰 종료.
 * 이전엔 공격자가 victim 의 bookingID + email 만 알면 (이메일은 PII 유출/추측 가능)
 * 남의 예약 환불 가능 → PayPal 자금 victim 으로 다시 들어가지만 booking 데이터 손상.
 * 이제 Authorization Bearer 의 verified email 만 사용.
 */
import { captureError } from './_shared/sentry.js';
import { evaluateRefundPolicy } from './_refund-policy.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { notifyOperator } from './_shared/operator-alerts.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { buildManualPaymentEmail } from './_shared/manual-payment-emails.js';
import { sendEmail } from './_send-email.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { refundPaypalCapture } from './_shared/paypal-refund.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok  = (data) => ({ ok: true, data });

// 🔴 F2 (2026-07-16): 결과 **미상**(요청은 나갔으나 응답을 못 봄) 코드 집합. "환불 안 됨" 이 아니다 —
//   PayPal 이 처리했을 수 있다. 이 코드들은 CONFIRMED 로 되돌리면 안 된다(재시도 → 이중환불 위험).
//   확정 실패(돈 확실히 안 움직임)는 helper 가 별도 코드로 준다: PAYPAL_AUTH_FAILED / NO_CAPTURE_ID /
//   NO_IDEMPOTENCY_KEY / REFUND_REQUEST_INVALID(F5) / REFUND_AMOUNT_INVALID(F1c) / PAYPAL_REFUND_FAILED.
const REFUND_OUTCOME_UNKNOWN = new Set(['PAYPAL_REFUND_TIMEOUT', 'PAYPAL_NETWORK_ERROR']);
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
const TEST_ACCOUNTS = [];

function getDb() {
  const db = initAdminDb('cancelBooking');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

// PayPal token + baseUrl resolution moved to api/_shared/paypal.js
// (shared with capturePaypalOrder.js + createPaypalOrder.js).

// HTML parse_mode 용 이스케이프: user/동적 필드(<>&)가 HTML 파싱을 깨지 않게 변환.
function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function airportPlainLine(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const lugTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const parts = [];
  if (terminal) parts.push(`터미널 ${escHtml(terminal)}`);
  if (flightNumber) parts.push(`편명 ${escHtml(flightNumber)}`);
  if (lugTotal > 0) parts.push(`수하물 ${lugTotal}개(S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`);
  return parts.length ? `\n공항: ${parts.join(' · ')}` : '';
}

// 2026-05-04: 2-채널 분리. 환불 영수증은 booking 채널 (cocotrip bot), 배차 취소는
// dispatch 채널 (driver bot) — 사용자 정책 ("정보는 driver, 결제내역은 cocotrip").
async function sendRefundTelegram({ bookingRef, productType, paxCount, tourDate, userEmail, refundUSD, refundPercent, reason, airport, pickupLocation, dropoffLocation }) {
  // (1) booking 채널 — 환불 재무 영수증
  const refundMsg =
    `🔴 <b>예약 취소·환불 처리</b>\n` +
    `<code>${escHtml(bookingRef)}</code>\n` +
    `상품: ${escHtml(productType)} · ${paxCount}명 · ${escHtml(tourDate)}\n` +
    `고객: ${escHtml(userEmail)}\n` +
    `환불액: <b>$${refundUSD} (${refundPercent}%)</b>\n` +
    `사유: ${escHtml(reason) || '-'}`;
  // (2) dispatch 채널 — 배차에서 빼라는 알림 (운행 정보 포함)
  const route = [pickupLocation, dropoffLocation].filter(Boolean).join(' → ') || '-';
  const dispatchMsg =
    `❌ <b>배차 취소</b>\n` +
    `<code>${escHtml(bookingRef)}</code>\n` +
    `상품: ${escHtml(productType)} · ${paxCount}명\n` +
    `날짜: ${escHtml(tourDate)}\n` +
    `경로: ${escHtml(route)}\n` +
    `사유: ${escHtml(reason) || '-'}` +
    airportPlainLine(airport);

  // (3) operator A 채널 — admin 본인 즉시 가시성 (PR-G). booking 봇 분리 운영 중에도 메인 봇으로
  // 환불은 무조건 들어와야 함 (사용자 정책).
  const operatorMsg =
    `💸 환불 처리 — <code>${escHtml(bookingRef)}</code>\n` +
    `${escHtml(userEmail)}\n` +
    `$${refundUSD} (${refundPercent}%)\n` +
    `사유: ${escHtml(reason) || '-'}\n` +
    `→ /admin/refunds 에서 확인`;

  // PR #457 (Audit Y-H13 — 2026-05-16): inspect Promise.allSettled results.
  // Pre-fix: `await Promise.allSettled([...])` discarded the array → individual
  // notify() returning {ok:false, error} or a rejection were silent. If
  // Telegram booking channel was down during a refund storm, operator never
  // saw the refund alerts even though refund itself succeeded.
  // Now: per-channel inspection, fallback alert via admin channel (separate
  // token) so at least one path delivers.
  const [bookingResult, dispatchResult, operatorResult] = await Promise.allSettled([
    notify('booking',  refundMsg),
    notify('dispatch', dispatchMsg),
    notifyOperator('refund', operatorMsg).catch((err) => {
      console.error('[cancelBooking] notifyOperator failed (silent fail 방지):', err.message);
      return { ok: false, error: err.message };
    }),
  ]);

  function inspect(name, result) {
    if (result.status === 'rejected') return { channel: name, reason: result.reason?.message || 'rejected' };
    const value = result.value;
    if (value && typeof value === 'object' && value.ok === false) {
      return { channel: name, reason: value.error || 'unknown' };
    }
    return null;
  }
  const failures = [
    inspect('booking', bookingResult),
    inspect('dispatch', dispatchResult),
    inspect('operator', operatorResult),
  ].filter(Boolean);

  if (failures.length > 0) {
    console.error('[cancelBooking] refund Telegram partial-fail:', { bookingRef, failures });
    // Fallback alert via admin channel (separate token → resilient to the
    // booking/dispatch channels being misconfigured). throttledTelegramAlert
    // also dedups via key so a Firestore brownout doesn't flood.
    throttledTelegramAlert({
      key: 'refund-telegram-partial-fail',
      channel: 'admin',
      severity: 'critical',
      message: [
        `🚨 <b>환불 알림 일부 채널 실패</b>`,
        ``,
        `<b>BookingRef:</b> <code>${bookingRef}</code>`,
        `<b>환불액:</b> $${refundUSD} (${refundPercent}%)`,
        `<b>실패 채널:</b>`,
        ...failures.map((f) => `  • <code>${f.channel}</code>: ${String(f.reason).replace(/[<>&]/g, '_').slice(0, 200)}`),
        ``,
        `→ /admin/refunds 에서 환불 자체는 정상 확인. 알림 미수신 채널 점검.`,
      ].join('\n'),
      context: { bookingRef, refundUSD, refundPercent, failures: failures.map((f) => f.channel) },
    }).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    // PR #418 (Audit W-C4): require Authorization: Bearer <ID-token>.
    // body.userEmail 무시 — verified auth.email 만 사용.
    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, JSON_CORS);
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }
    const userEmail = auth.email;

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingID, reason = '' } = body;
    if (!bookingID) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('bookingID required', 'MISSING_FIELDS')));
    }

    // 2026-05-03: TEST 계정도 실제 결제는 LIVE PayPal로 진행되므로 (createPaypalOrder
    // 변경) refund도 항상 LIVE. sandbox PayPal 환불 호출 케이스 자체가 없음.
    const isSandbox = false;
    void TEST_ACCOUNTS;
    const db = getDb();

    // 1. 예약 조회 + 소유자 검증
    const ref = db.collection('bookings').doc(bookingID);
    const doc = await ref.get();
    if (!doc.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Booking not found', 'NOT_FOUND')));
    }
    const booking = doc.data();
    if ((booking.userEmail || '').toLowerCase() !== userEmail.toLowerCase()) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('Not your booking', 'FORBIDDEN')));
    }
    if (booking.status !== 'CONFIRMED') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(`Cannot cancel: status=${booking.status}`, 'INVALID_STATE')));
    }
    if (!booking.captureID) {
      res.writeHead(500, JSON_CORS);
      return res.end(JSON.stringify(_err('captureID missing — PayPal refund impossible', 'NO_CAPTURE_ID')));
    }

    // 🔴 F7/F8 보호조치 (2026-07-16): cart 자식 예약(parentOrderID 보유)은 형제와 하나의 captureID 를
    //   공유한다(cart-capture.js). 여기서 개별 취소하면 24h 바이너리 정책상 refundRatio=1.0 →
    //   refundUSD=null → refundPaypalCapture 가 amount 를 생략 → **capture 전액환불**(카트 전체)이 되어
    //   라인 1건 취소가 카트 전부를 환불시킨다(직접 손실). 현재는 child doc 에 userEmail 이 없어 위
    //   소유자 가드(403)가 우연히 막지만, 그건 설계가 아니라 필드 누락 사고다 — userEmail 한 줄만
    //   추가되면 이 경로가 무장된다. parentOrderID 를 명시 거부해 그 사고를 원천 차단한다.
    //   ⚠️ cart 라인별 환불의 올바른 해법은 capture 단위 환불 원장(capture_refunds/{captureID})이며 P1 밖이다.
    if (booking.parentOrderID) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'Cart line items cannot be individually cancelled here — please contact support for cart refunds.',
        'CART_CHILD_REFUND_UNSUPPORTED')));
    }

    // 2026-05-03: AI 플래너 ($9.90)는 디지털 상품 — 결제 즉시 itinerary + PDF
    // 다운로드 가능 (캡쳐 가능). 환불해주면 사업자만 손해. 명시적 거부.
    // 차터/투어/공항픽업은 시간 기반 환불 정책 적용 (evaluateRefundPolicy).
    if ((booking.productType || '').toString().startsWith('ai-planner')) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'AI Plans are digital products delivered immediately and are non-refundable.',
        'NO_REFUND_DIGITAL',
      )));
    }

    // SAFETY (PR #418 패턴 확장): tier 도 body 신뢰 종료. 클라가 tier:'Platinum' 위조 시
    // 0% 환불 창에서 100% 환불받는 IDOR(직접 자금 손실). 인증 uid 의 서버 저장 tier
    // (users/{uid}.tier — loyalty.js 가 totalSpent/bookings 로 계산) 만 사용. 조회 실패=Bronze(최소권한).
    let tier = 'Bronze';
    try {
      const uSnap = await db.collection('users').doc(auth.uid).get();
      const serverTier = uSnap.exists ? (uSnap.data() || {}).tier : null;
      if (typeof serverTier === 'string' && serverTier) tier = serverTier;
    } catch (tierErr) {
      console.warn('[cancelBooking] tier lookup failed → Bronze:', tierErr.message);
    }

    // 2. 환불 정책 평가
    // PR #426 (Audit CY3 — 2026-05-14): pass tourTime so the cutoff isn't
    // anchored at 00:00 KST. Legacy bookings without tourTime fall back to
    // '00:00' inside evaluateRefundPolicy (no regression for existing data).
    const policy = evaluateRefundPolicy({
      tourDate: booking.tourDate,
      tourTime: booking.tourTime || undefined,
      tier,
    });
    if (!policy.canRefund) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Cancellation window closed — no refund available', 'NO_REFUND')));
    }

    const originalUSD = parseFloat(booking.amountUSD || '0');
    const refundUSD = (originalUSD * policy.refundRatio).toFixed(2);
    const refundKRW = Math.round((booking.amountKRW || 0) * policy.refundRatio);

    // 3. PayPal Refund (2026-05-07: Braintree 통합 제거 — PayPal 단일).
    // 잔여 booking 중 provider='braintree' 인 레거시 도큐먼트는 captureID 가
    // Braintree transaction id 형식이라 PayPal /captures/{id}/refund 가 404 가 남.
    // 운영자가 admin-payments UI 에서 manual refund 처리해야 함.
    if (booking.provider === 'braintree') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'Legacy Braintree booking — manual refund required via admin-payments console.',
        'LEGACY_BRAINTREE_BOOKING',
      )));
    }
    // SECURITY (버그헌트 2026-06-14): 환불 호출 전 status CONFIRMED→CANCELING 을 트랜잭션으로
    // 원자 선점. 이전엔 read-check(L205)와 refund 사이에 락이 없어 더블클릭/동시요청 시 두 요청이
    // 모두 CONFIRMED 가드를 통과 → 부분환불(ratio<1)이 2회 발사돼 원금 초과 환불(직접 자금 손실).
    // 선점에 성공한 단 한 요청만 refund. (capturePaypalOrder 의 used_paypal_orders 락과 동형.)
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const f = fresh.exists ? fresh.data() : null;
        if (!f || f.status !== 'CONFIRMED') {
          throw new Error('ALREADY_CLAIMED'); // 동시/중복 취소 — 다른 요청이 이미 선점
        }
        tx.update(ref, { status: 'CANCELING', cancelClaimedAt: FieldValue.serverTimestamp() });
      });
    } catch (claimErr) {
      if (claimErr && claimErr.message === 'ALREADY_CLAIMED') {
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err('Cancellation already in progress or completed', 'CANCEL_IN_PROGRESS')));
      }
      throw claimErr;
    }

    // PR #425 (Audit CY5 prep): shared paypal-refund helper. Same flow as
    // admin-booking-action.js mark-refunded path, so both surfaces stay in
    // sync if PayPal's API ever shifts.
    const refundResult = await refundPaypalCapture({
      captureID: booking.captureID,
      // 🔴 이중환불 방어 키 (2026-07-15). **captureID 가 아니라 bookingID 다.**
      //   cart 자식 예약 N개가 하나의 captureID 를 공유하고(_shared/cart-capture.js) 각자
      //   `${orderID}__${lineId}` 로 자기 문서를 갖는다 → 라인별 개별 취소 = 같은 capture 에
      //   서로 다른 금액의 정당한 환불 2회. captureID 를 키로 쓰면 두 번째가 첫 번째 응답으로
      //   캐시 반환돼 **돈은 안 나갔는데 refundID 가 기록되고 CANCELED 로 확정된다**(미환불 은폐).
      //   bookingID 는 문서 id 라 재시도해도 동일하고 예약당 환불은 1회뿐이라 키로 정확하다.
      //   이 키가 없으면 아래 !ok 분기(CONFIRMED 복구 → 재시도 허용)가 곧 이중환불 경로다.
      idempotencyKey: bookingID,
      refundUSD: policy.refundRatio < 1.0 ? refundUSD : null,
      // capture 통화 우선(레거시 문서엔 필드가 없을 수 있어 helper 가 USD 폴백).
      currency: booking.currency,
      note: policy.refundRatio < 1.0
        ? `CocoTrip cancellation: ${policy.refundPercent}% refund`
        : 'CocoTrip cancellation: full refund',
      isSandbox,
    });
    if (!refundResult.ok) {
      const outcomeUnknown = REFUND_OUTCOME_UNKNOWN.has(refundResult.code);
      // 🔴 F2 (2026-07-16): CAS 로만 상태를 되돌린다. 이전엔 무조건 `ref.update({status:'CONFIRMED'})`
      //   였는데, 환불 처리 후 PayPal 이 쏘는 webhook(PAYMENT.CAPTURE.REFUNDED, t≈3s)이 먼저 REFUNDED
      //   를 써놓으면 우리 복구(t≈21s)가 그걸 **덮어썼다**. webhook 은 eventId 멱등 + 이미 200 이라
      //   재전송이 없어 복구 불능(영구 clobber). 그래서 선점 상태(CANCELING)일 때만 쓴다.
      //   (tx 안에는 외부호출 없음 — get/update 만.)
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          const f = fresh.exists ? fresh.data() : null;
          if (!f || f.status !== 'CANCELING') return; // webhook 등이 이미 확정 — 건드리지 않는다
          if (outcomeUnknown) {
            // 돈이 움직였는지 모른다 → CONFIRMED 로 되돌리는 것은 "환불 안 됨" 단정이므로 금지.
            //   재시도도 막는다(멱등키 보존기간 미문서화 → 창 밖 재시도 = 진짜 이중환불).
            tx.update(ref, {
              status: 'REFUND_UNKNOWN',
              refundUnknownAt: FieldValue.serverTimestamp(),
              refundUnknownCode: refundResult.code,
              refundIdempotencyKey: bookingID, // 운영자 수동 재시도가 같은 키를 쓸 수 있게 박제
              updatedAt: FieldValue.serverTimestamp(),
            });
          } else {
            // 확정 실패만 CONFIRMED 복구 = 사용자 재시도 허용. CAS 가 CONFIRMED 를 요구하므로 필수.
            tx.update(ref, { status: 'CONFIRMED', cancelClaimedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
          }
        });
      } catch (e) { console.error('[cancelBooking] post-refund state write failed:', e.message); }

      if (outcomeUnknown) {
        // 🔴 이 알럿이 load-bearing 이다. REFUND_UNKNOWN 상태는 읽는 코드가 없다(CANCELING 과 동일) →
        //   텔레그램이 유일한 탐지 수단. throttle key 로 storm 시 flood 방지.
        throttledTelegramAlert({
          key: 'refund-outcome-unknown',
          channel: 'admin',
          severity: 'critical',
          message: `🚨 <b>환불 결과 미상 — PayPal 대조 필요</b>\n`
            + `<code>${escHtml(bookingID)}</code>\n`
            + `capture: <code>${escHtml(booking.captureID)}</code>\n`
            + `코드: ${escHtml(refundResult.code)}\n`
            + `→ PayPal 거래내역에서 환불 여부 확인 후 수동 확정`,
          context: { bookingID, code: refundResult.code },
        }).catch(() => {});
        res.writeHead(202, JSON_CORS);
        return res.end(JSON.stringify(_err('환불 처리를 확인 중입니다. 운영자가 확인 후 연락드립니다.', 'REFUND_PENDING_VERIFICATION')));
      }
      res.writeHead(refundResult.status || 502, JSON_CORS);
      return res.end(JSON.stringify(_err(refundResult.error, refundResult.code || 'REFUND_FAILED')));
    }
    const refundData = refundResult.refund;

    // 🟠 F3c-lite (옵션 B, 2026-07-16): PENDING(eCheck 등)은 비종단이지만 CANCELED 종단은 유지한다 —
    //   strict(비종단 REFUND_PENDING 상태 도입)는 eCheck 가 API 에서 영구 PENDING 으로 남으면 정상
    //   경로 전체가 퇴행하는 리스크가 있어 샌드박스 실측 전 금지. 대신 관측 알럿으로 빈도를 측정하고
    //   (throttle 의 error_log 가 raw 전건 저장 → 측정기), FAILED 뒤집힘은 F4 webhook 이 REFUND_FAILED
    //   로 치유한다. refundStatus 는 아래 update 가 이미 PENDING 그대로 기록한다.
    if (refundResult.pending) {
      throttledTelegramAlert({
        key: 'refund-pending-observed',
        channel: 'admin',
        severity: 'high',
        message: `🟠 <b>환불 PENDING 관측 (eCheck?)</b>\n<code>${escHtml(bookingID)}</code>\nrefund: <code>${escHtml(refundData.id)}</code>\n→ 완료되면 CAPTURE.REFUNDED, 실패하면 REFUND.FAILED webhook 이 온다`,
        context: { bookingID, refundID: refundData.id },
      }).catch(() => {});
    }

    // 4. Firestore 업데이트
    await ref.update({
      status: 'CANCELED',
      canceledAt: FieldValue.serverTimestamp(),
      canceledReason: reason,
      refundID: refundData.id,
      refundedAmount: refundKRW,
      refundedUSD: refundUSD,
      refundPercent: policy.refundPercent,
      refundStatus: refundData.status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 5. Telegram 알림 (best-effort)
    // 2026-05-04: 어드민 텔레그램에는 친화적 라벨로 표시 (charter_custom_estimate →
    // "Custom Charter (Estimate — pending reconciliation)"). 어드민 검색은 booking 의
    // raw productType 필드로 가능.
    sendRefundTelegram({
      bookingRef: booking.bookingRef || bookingID,
      productType: productDisplayLabel(booking.productType),
      paxCount: booking.paxCount,
      tourDate: booking.tourDate,
      userEmail,
      refundUSD,
      refundPercent: policy.refundPercent,
      reason,
      airport: booking.airport,
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
    });

    // 6. 사용자 환불 안내 이메일 (4-lang, best-effort).
    // Launch P1-4 (2026-05-10): 사용자 자가 취소 시에도 환불 영수증 이메일 발송.
    // 기존 누락: admin-booking-action 의 mark-refunded 만 메일 보내고 사용자 자가
    // 취소 (cancelBooking endpoint) 는 사용자 알림 누락 → 운영자 매뉴얼 발송 부담.
    (async () => {
      try {
        const { subject, html, text } = buildManualPaymentEmail('refunded', {
          bookingRef: booking.bookingRef || bookingID,
          refundedKRW: refundKRW,
          refundReason: reason || null,
          language: booking.language || 'en',
        });
        await sendEmail({ to: userEmail, subject, html, text });
        console.log('[cancelBooking] refund email sent:', userEmail);
      } catch (e) {
        console.error('[cancelBooking] refund email failed (non-fatal):', e.message);
      }
    })();

    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({
      bookingID,
      status: 'CANCELED',
      refundID: refundData.id,
      refundPercent: policy.refundPercent,
      refundedKRW: refundKRW,
      refundedUSD: refundUSD,
      hoursUntilTour: policy.hoursUntilTour,
    })));
  } catch (err) {
    console.error('[cancelBooking] Error:', err);
    await captureError(err, {
      route: '/api/cancelBooking',
      method: req.method,
    });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
