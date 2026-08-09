/**
 * POST /api/admin-booking-action
 *
 * 운영자가 PayPal 거래내역 확인 후 admin UI 에서 클릭하는 동기화 endpoint.
 *
 * Actions:
 *   1. 'mark-paid'        — pending_bookings 의 결제 신고 → 통장/PayPal 입금 확인됨
 *                            → status='CONFIRMED' + booking 정식 doc 생성
 *                            + AI 플래너 trigger / 영수증 메일 (booking-processor 호출)
 *                            + 텔레그램 booking 채널 #2 "✅ 매칭 완료" 알림
 *
 *   2. 'mark-refunded'    — PayPal 에서 운영자 수동 환불 후 admin 클릭 → bookings 의
 *                            기존 doc 에 status='REFUNDED' + refundedKRW + reason
 *                            + 사용자에게 환불 안내 이메일
 *                            + 텔레그램 booking #3 "💸 환불 완료"
 *
 *   3. 'mark-canceled'    — 사용자 요청으로 결제 전 취소 / 노쇼
 *                            → status='CANCELED' + reason
 *                            + 텔레그램 booking #4 "❌ 취소"
 *
 * Auth: Firebase Admin token (verifyAdminToken — ADMIN_EMAIL 매칭).
 *
 * Body:
 *   {
 *     bookingRef,           // 'CT-YYYYMMDD-XXX' (pending_bookings doc ID)
 *     action,               // 'mark-paid' | 'mark-refunded' | 'mark-canceled'
 *     paypalTransactionId,  // (mark-paid) PayPal 거래 ID — 운영자가 PayPal 에서 복사
 *     refundedKRW,          // (mark-refunded) 환불 금액 (KRW). 미지정 시 전액
 *     reason,               // 모든 action 공통 옵션 — 사유 텍스트
 *   }
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { buildManualPaymentEmail } from './_shared/manual-payment-emails.js';
import { sendEmail } from './_send-email.js';
import { confirmBookingAsPaid } from './_shared/booking-confirm.js';
import { refundPaypalCapture } from './_shared/paypal-refund.js';
import { releaseSlotForCanceledOrder } from './_shared/slot-capacity.js';
import { buildAdminJsonCors } from './_shared/cors.js';

/**
 * 취소·환불이 **확정 성공**한 뒤 확정 좌석(slot_bookings)을 해제한다 (2026-08-09).
 * mark-refunded(전액) · dispatch-cancel 공용.
 *
 * 이전엔 두 경로 모두 좌석을 그대로 뒀다 → 환불된 좌석이 영구히 팔리지 않았다(매출손실).
 *
 * 안전 규칙 (helper 계약과 동일):
 *   - 🔴 **환불이 종단 성공(COMPLETED)했을 때만.** `refundFinal` 이 그 게이트다 — 아래 참조.
 *   - 되돌리는 양은 확정 원장(slot_confirmed)이 증명하는 만큼뿐. 증거 없으면 좌석 미변경 + 보고.
 *     (기록 없이 pax 를 빼면 다른 손님의 확정석을 지운다 = 오버부킹.)
 *   - 어떤 슬롯인지는 서버 스냅샷 바인딩(paypal_order_snapshots)만이 근거 — body 신뢰 금지.
 *   - cart 자식(parentOrderID)은 형제와 capture 를 공유해 라인별 좌석 귀속이 불가능 → 보류.
 *   - best-effort: 돈은 이미 움직였다. 실패해도 admin action 자체는 성공 응답을 유지하고 알린다.
 *
 * @param {boolean} args.refundFinal — 돈이 **확정으로** 고객에게 갔는가(refundPaypalCapture 의 `final`).
 *   fail-closed(기본 미지정 = 해제 안 함). `ok:true` 로는 부족하다:
 *     - PENDING(eCheck·리스크홀드)은 나중에 FAILED 로 뒤집힌다(F4 webhook 이 REFUND_FAILED 로 치유).
 *     - captureID 가 없으면 PayPal 을 아예 호출하지 않았다 = 운영자 수동 환불 대기.
 *   두 경우에 좌석을 풀면 환불받지 못한 손님의 자리를 남에게 파는 상태가 된다(좌석회계 ↔ 환불상태 불일치).
 *   게이트를 호출자마다 두면 새 호출자가 빠뜨린다 → 여기 한 곳에서 막는다.
 *   (capturePaypalOrder.js 의 `refundOk = !!(refundRes?.ok && refundRes?.final)` 와 같은 판정.)
 */
async function releaseSeatsAfterRefund({ adminDb, bookingRef, bookingId, bookingData, action, refundFinal }) {
  if (!refundFinal) {
    console.warn('[admin-booking-action] 환불 미확정(PENDING·captureID 없음) — 좌석 해제 보류:', { bookingRef, action });
    return;
  }
  try {
    if (bookingData && bookingData.parentOrderID) {
      console.warn('[admin-booking-action] slot release skipped — cart child (형제와 capture 공유):', bookingRef);
      return;
    }
    const orderId = (bookingData && bookingData.orderID) || bookingId;
    const release = await releaseSlotForCanceledOrder({ adminDb, orderId });
    if (release.released) {
      console.log('[admin-booking-action] slot released:', { bookingRef, action, slot: release.slot, pax: release.pax });
      return;
    }
    // NO_SNAPSHOT_BINDING = 비슬롯 상품(수동입금·차터 등)의 정상 상태 → 조용히 통과(알림 홍수 방지).
    console.warn('[admin-booking-action] slot release skipped:', release.reason, { bookingRef, action });
    if (release.reason === 'NO_CONFIRMED_RECORD') {
      notify('admin', [
        '⚠️ <b>환불 완료 — 좌석 해제 보류 (확정 원장 없음)</b>',
        `<code>${bookingRef}</code> · ${action}`,
        `슬롯: ${release.slot?.tourId} / ${release.slot?.date} / ${release.slot?.slotId}`,
        '→ 이 주문이 좌석을 확정한 기록이 없어 좌석을 건드리지 않았습니다. 수동 확인 필요.',
      ].join('\n')).catch(() => {});
    }
  } catch (e) {
    console.error('[admin-booking-action] slot release failed (non-fatal):', e.message);
    notify('admin', [
      '🚨 <b>환불 완료 — 좌석 해제 실패 (좌석이 잠긴 채 남음)</b>',
      `<code>${bookingRef}</code> · ${action}`,
      `오류: ${(e.message || '').slice(0, 200)}`,
      '→ 환불은 정상. 해당 슬롯의 확정석만 수동 해제 필요.',
    ].join('\n')).catch(() => {});
  }
}

// 이메일 발송 헬퍼 — 실패해도 admin action 자체는 성공해야 (booking 상태 갱신은
// 이미 끝났고, 이메일 누락은 admin 이 수동 재발송 가능).
async function sendCustomerNotification(kind, booking) {
  try {
    if (!booking?.customerEmail) {
      console.warn('[admin-booking-action] no customerEmail — skip email');
      return;
    }
    const { subject, html, text } = buildManualPaymentEmail(kind, booking);
    await sendEmail({ to: booking.customerEmail, subject, html, text });
    console.log(`[admin-booking-action] customer email sent (${kind}):`, booking.customerEmail);
  } catch (e) {
    console.error(`[admin-booking-action] customer email (${kind}) failed:`, e.message);
  }
}

export const config = { runtime: 'nodejs' };
export const maxDuration = 30;

// PR #437 (W-H11): per-request origin allowlist — was wildcard '*'.
// JSON_HEADERS is now built per-handler-call so it can echo req.headers.origin.
const JSON_HEADERS_STATIC = { 'Cache-Control': 'no-store' };
const CORS_METHODS = 'POST, OPTIONS';

const VALID_ACTIONS = new Set(['mark-paid', 'mark-refunded', 'mark-canceled', 'dispatch-cancel']);

/**
 * 'dispatch-cancel' — 차량·기사를 못 구해 우리 쪽 사정으로 취소하는 경우 (운영자 2026-07-28).
 *
 * 취소정책(24h 바이너리)은 **고객 귀책** 취소에만 적용된다. 이건 우리 귀책이므로
 * 출발이 코앞이어도 **항상 전액 환불**이고, 사유가 필수다(고객에게 그대로 전달된다).
 * 사유 분류는 고객 안내 문구 키로도 쓰이므로 자유 문자열을 허용하지 않는다.
 */
const DISPATCH_CANCEL_CATEGORIES = new Set(['no_vehicle', 'no_driver', 'other']);

const DISPATCH_CANCEL_LABEL = {
  no_vehicle: { ko: '차량 미확보', en: 'No vehicle available', ja: '車両を確保できず', zh: '无法安排车辆' },
  no_driver: { ko: '기사 미확보', en: 'No driver available', ja: 'ドライバーを確保できず', zh: '无法安排司机' },
  other: { ko: '운영 사정', en: 'Operational reason', ja: '運営上の事情', zh: '运营原因' },
};

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
}

export default async function handler(req, res) {
  const JSON_HEADERS = { ...JSON_HEADERS_STATIC, ...buildAdminJsonCors(req, { methods: CORS_METHODS }) };
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  // Admin 인증
  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    res.writeHead(tokenAuth.status || 401, JSON_HEADERS);
    return res.end(JSON.stringify(_err(tokenAuth.error || 'auth required', 'AUTH_FAILED')));
  }
  const adminUid = tokenAuth.uid;
  const adminEmail = tokenAuth.email;

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingRef, action, paypalTransactionId, refundedKRW, reason, cancelCategory } = body;

    if (!bookingRef) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('bookingRef required', 'MISSING_BOOKING_REF')));
    }
    if (!VALID_ACTIONS.has(action)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`Invalid action. Allowed: ${[...VALID_ACTIONS].join(', ')}`, 'INVALID_ACTION')));
    }
    // dispatch-cancel 은 사유가 고객에게 그대로 전달된다 → 빈 사유로 집행 금지.
    if (action === 'dispatch-cancel') {
      if (!DISPATCH_CANCEL_CATEGORIES.has(cancelCategory)) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          `cancelCategory required. Allowed: ${[...DISPATCH_CANCEL_CATEGORIES].join(', ')}`,
          'MISSING_CANCEL_CATEGORY')));
      }
      if (!String(reason || '').trim()) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('취소 사유를 입력해주세요 (고객에게 그대로 전달됩니다)', 'MISSING_REASON')));
      }
    }

    // 🔴 F1 money 가드 (2026-07-16): refundedKRW 는 운영자 자유입력(AdminPayments window.prompt)이라
    //   '50,000'(한국 로케일 콤마)·'abc'·{} 가 들어올 수 있다. Number() 가 NaN 을 만들고
    //   **NaN 과의 모든 비교는 false** 라 아래 mark-refunded 의 REFUND_EXCEEDS_ORIGINAL /
    //   REFUND_ORIGINAL_UNKNOWN 가드가 둘 다 조용히 통과한다 → refundUSD=null → refundPaypalCapture
    //   가 amount 를 생략 → PayPal 이 capture **전액** 환불(부분환불 의도가 전액환불로 집행 = 직접 손실).
    //   ⚠️ 비교 연산으로는 NaN 을 원리적으로 못 거른다 — 반드시 별도 유한성 검사여야 한다.
    //   ⚠️ 감사로그(admin_actions.add)보다 **앞**에 둔다: Firestore 는 NaN 을 doubleValue:null 로
    //      수용해 throw 하지 않으므로, 뒤에 두면 "운영자가 얼마를 의도했는가" 포렌식이 오염된다.
    //   refundedKRW 미지정(전액환불 의도)은 통과 — != null 로 걸러 amount 미지정 경로를 보존한다.
    if (refundedKRW != null) {
      const _krw = Number(refundedKRW);
      if (!Number.isFinite(_krw) || _krw <= 0) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          `환불액이 올바른 숫자가 아닙니다 (받은 값: ${JSON.stringify(refundedKRW)})`,
          'REFUND_AMOUNT_INVALID')));
      }
    }

    const adminDb = initAdminDb('admin-booking-action');
    if (!adminDb) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    const pendingRef = adminDb.collection('pending_bookings').doc(bookingRef);
    const pendingSnap = await pendingRef.get();

    if (!pendingSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`pending_bookings/${bookingRef} not found`, 'NOT_FOUND')));
    }
    const pending = pendingSnap.data();

    // Audit log — 모든 action 공통
    const auditEntry = {
      adminUid, adminEmail,
      bookingRef,
      action,
      reason: reason || null,
      cancelCategory: cancelCategory || null,
      previousStatus: pending.status,
      paypalTransactionId: paypalTransactionId || null,
      refundedKRW: refundedKRW != null ? Number(refundedKRW) : null,
      at: FieldValue.serverTimestamp(),
    };
    await adminDb.collection('admin_actions').add(auditEntry);

    // ──────── Action 1: mark-paid ────────────────────────────────────
    if (action === 'mark-paid') {
      // 공통 confirm 로직은 _shared/booking-confirm.js 로 추출 (paypal-webhook 과 공유)
      const result = await confirmBookingAsPaid({
        db: adminDb,
        bookingRef,
        paypalTransactionId,
        source: 'admin',
        adminUid,
        adminEmail,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        res.writeHead(status, JSON_HEADERS);
        return res.end(JSON.stringify(_err(result.error, result.code)));
      }
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          bookingRef,
          status: 'CONFIRMED',
          bookingId: result.bookingId,
          ...(result.alreadyConfirmed ? { alreadyConfirmed: true } : {}),
        },
      }));
    }

    // ──────── Action 2: mark-refunded ────────────────────────────────
    //
    // PR #425 (Audit CY5 — 2026-05-14): 이전엔 Firestore status='REFUNDED' +
    // 환불 이메일만 발송하고 PayPal API 호출은 누락. 결과: 사용자 mypage 와
    // 이메일은 "환불 완료" 라고 표시되지만 PayPal 계정엔 그대로 돈이 남음.
    // 운영자가 별도로 PayPal Dashboard 에서 수동 refund 안 누르면 사용자가
    // 며칠씩 환불 못 받음. 이제 captureID 가 있으면 자동 PayPal refund 호출.
    if (action === 'mark-refunded') {
      // 환불은 confirmed booking 에만 가능
      if (pending.status !== 'CONFIRMED') {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`Cannot refund — current status: ${pending.status}`, 'INVALID_STATUS')));
      }
      const refundKrw = refundedKRW != null ? Number(refundedKRW) : pending.priceKRW;

      // bookings doc 에서 captureID 조회 — PayPal 자동 환불용.
      const bookingId = pending.paypalTransactionId || bookingRef;
      const bookingSnap = await adminDb.collection('bookings').doc(bookingId).get();
      const bookingData = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
      const captureID = bookingData.captureID || pending.paypalCaptureId || null;

      // 🔴 money 가드: 입력 환불액이 결제 원금을 초과하면 차단.
      //   초과 시 captureID 경로에서 refundKrw<originalKRW 가 false → refundUSD=null →
      //   refundPaypalCapture 가 부분 의도임에도 silent 전액 환불 + Firestore refundedKRW 과대기록.
      //   refundKrw===originalKRW(전액) / refundKrw<originalKRW(부분) 은 정상.
      const originalKRW = Number(bookingData.amountKRW || pending.priceKRW || 0);
      if (originalKRW > 0 && refundKrw > originalKRW) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          `환불액(₩${refundKrw.toLocaleString('ko-KR')})이 결제 원금(₩${originalKRW.toLocaleString('ko-KR')})을 초과합니다`,
          'REFUND_EXCEEDS_ORIGINAL')));
      }
      // 부분환불 명시(refundedKRW 입력)인데 원금 정보가 없거나 손상(NaN)이라 비례 검증 불가 →
      //   자동 전액환불 대신 차단. F1b(2026-07-16): amountKRW 가 손상 문자열('1,000,000')이면
      //   originalKRW=NaN 이 되고 NaN<=0 이 false 라 이 가드를 빠져나가 전액환불이 나갔다 → isFinite 확장.
      if ((!Number.isFinite(originalKRW) || originalKRW <= 0) && refundedKRW != null) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          '결제 원금 정보가 없어 부분환불 금액을 검증할 수 없습니다 (전액환불은 금액 미지정으로 재시도)',
          'REFUND_ORIGINAL_UNKNOWN')));
      }

      // PayPal API 호출 — captureID 가 있을 때만. 없으면 manual booking
      // (paypal.me QR 수동 입금 등) 으로 간주하고 운영자가 별도 환불 진행.
      let paypalRefund = null;
      let refundFinal = false;   // 좌석 해제 게이트 — COMPLETED(final)만 종단 성공
      if (captureID) {
        const usdToKrw = Number(process.env.KRW_USD_RATE)
          || Number(process.env.VITE_USD_KRW_RATE)
          || 1430;
        // refundKrw → refundUSD 환산. 부분환불 (refundedKRW < priceKRW) 일 때 비례 계산.
        let refundUSD = null;
        if (originalKRW > 0 && refundKrw < originalKRW) {
          const originalUSD = parseFloat(bookingData.amountUSD || '0');
          if (originalUSD > 0) {
            refundUSD = (originalUSD * (refundKrw / originalKRW)).toFixed(2);
          } else {
            refundUSD = (refundKrw / usdToKrw).toFixed(2);
          }
        }
        const result = await refundPaypalCapture({
          captureID,
          // 🔴 이중환불 방어 키 (2026-07-15). bookingRef(pending_bookings 문서 id) + 금액.
          //   금액을 포함하는 이유: 운영자가 AdminPayments 의 window.prompt 로 **임의 금액**을
          //   넣는다. bookingRef 단독 키면 "실패 후 다른 금액으로 재시도" 가 첫 요청의 캐시된
          //   응답을 받아 원하는 금액이 환불되지 않는다. 금액을 넣으면 같은 금액 재시도만
          //   멱등이 되고(= 타임아웃 재클릭 방어), 다른 금액은 별개 환불로 취급된다.
          //   ⚠️ captureID 단독 금지 — cart 자식들이 captureID 를 공유한다(helper 주석 참조).
          //   ⚠️ 영구 중복 방어는 이 키가 아니라 위 status!=='CONFIRMED' 가드가 담당한다.
          //      (PayPal 은 PayPal-Request-Id 보존 기간을 공식화하지 않는다.)
          idempotencyKey: `${bookingRef}:${refundUSD || 'full'}`,
          refundUSD,
          // capture 통화 우선. bookings 문서가 없으면 bookingData={} → undefined → helper 가 USD 폴백.
          currency: bookingData.currency,
          note: reason
            ? `CocoTrip admin refund: ${String(reason).slice(0, 80)}`
            : 'CocoTrip admin refund',
        });
        if (!result.ok) {
          console.error('[admin-booking-action] PayPal refund failed:', result.code, result.error);
          // PayPal 실패 시 Firestore 도 업데이트 하지 않음 — 운영자가 정확한
          // 사유 보고 수동 처리하도록 status code 그대로 반환.
          res.writeHead(result.status, JSON_HEADERS);
          return res.end(JSON.stringify(_err(result.error, result.code)));
        }
        paypalRefund = result.refund;
        refundFinal = result.final === true;
        // 🟠 F3c-lite (옵션 B, 2026-07-16): PENDING 은 비종단 — REFUNDED 종단은 유지하되 운영자에게
        //   관측 알럿. FAILED 뒤집힘은 F4 webhook(REFUND_FAILED)이 치유. strict 전환은 샌드박스 실측 후.
        if (result.pending) {
          notify('admin', `🟠 <b>admin 환불 PENDING 관측 (eCheck?)</b>\n<code>${bookingRef}</code>\nrefund: <code>${paypalRefund.id}</code>\n→ 실패 시 REFUND.FAILED webhook 이 REFUND_FAILED 로 전환`).catch(() => {});
        }
      } else {
        console.warn('[admin-booking-action] mark-refunded without captureID — Firestore-only refund (manual PayPal expected):', bookingRef);
      }

      const firestoreUpdate = {
        status: 'REFUNDED',
        refundedKRW: refundKrw,
        refundReason: reason || null,
        refundedAt: FieldValue.serverTimestamp(),
        refundedByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(paypalRefund
          ? { refundID: paypalRefund.id, refundStatus: paypalRefund.status, refundSource: 'paypal-api' }
          : { refundSource: 'manual' }),
      };

      await pendingRef.update(firestoreUpdate);
      await adminDb.collection('bookings').doc(bookingId).set({
        ...firestoreUpdate,
        refundedByAdminUid: adminUid,
      }, { merge: true });

      // 🔴 좌석 해제 — **전액환불일 때만**. 부분환불은 예약이 살아있을 수 있어(굿윌 일부 환급 등)
      //   좌석을 푸는 것이 오버부킹으로 이어진다 → 보류하고 로그만 남긴다(운영자 판단 영역).
      //   전액 판정: 금액 미지정(= 전액환불 의도) 또는 원금 대비 100%.
      const isFullRefund = refundedKRW == null
        || (Number.isFinite(originalKRW) && originalKRW > 0 && refundKrw >= originalKRW);
      if (isFullRefund) {
        // refundFinal 이 false 면 helper 가 보류한다 (PENDING·captureID 없음 = 아직 환불 안 됨).
        await releaseSeatsAfterRefund({ adminDb, bookingRef, bookingId, bookingData, action, refundFinal });
      } else {
        console.warn('[admin-booking-action] 부분환불 — 좌석 해제 보류 (예약 유효 가능):', { bookingRef, refundKrw, originalKRW });
      }

      const telText = [
        paypalRefund
          ? '💸 <b>환불 완료 (PayPal API 자동)</b>'
          : '💸 <b>환불 완료 (PayPal 수동 처리)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>환불액:</b> ₩${refundKrw.toLocaleString('ko-KR')}`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        paypalRefund ? `<b>PayPal refund:</b> <code>${paypalRefund.id}</code>` : null,
        reason ? `<b>사유:</b> ${reason}` : null,
      ].filter(Boolean).join('\n');
      notify('booking', telText).catch(() => {});

      // 사용자 4-lang 환불 안내 이메일
      sendCustomerNotification('refunded', {
        ...pending,
        refundedKRW: refundKrw,
        refundReason: reason || null,
      }).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          bookingRef,
          status: 'REFUNDED',
          refundedKRW: refundKrw,
          refundSource: paypalRefund ? 'paypal-api' : 'manual',
          ...(paypalRefund ? { refundID: paypalRefund.id } : {}),
        },
      }));
    }

    // ──────── Action 4: dispatch-cancel (배차 실패 = 우리 귀책 취소) ────────
    // 고객 귀책 취소(24h 바이너리)와 달리 **항상 전액 환불**. 부분환불 인자를 받지 않는다.
    if (action === 'dispatch-cancel') {
      if (pending.status !== 'CONFIRMED') {
        // 이미 취소/환불된 건을 다시 누르면 두 번째 환불이 나갈 수 있다 → 상태 가드가 영구 방어선.
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`취소할 수 없는 상태입니다: ${pending.status}`, 'INVALID_STATUS')));
      }

      const bookingId = pending.paypalTransactionId || bookingRef;
      const bookingSnap = await adminDb.collection('bookings').doc(bookingId).get();
      const bookingData = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
      const captureID = bookingData.captureID || pending.paypalCaptureId || null;
      const refundKrw = Number(bookingData.amountKRW || pending.priceKRW || 0) || 0;
      const lang = pending.language || bookingData.language || 'en';
      const categoryLabel = (DISPATCH_CANCEL_LABEL[cancelCategory] || DISPATCH_CANCEL_LABEL.other);
      const reasonText = `${categoryLabel[lang] || categoryLabel.en} — ${String(reason).trim()}`;

      // PayPal 자동 환불 — refundUSD 를 주지 않으면 capture 전액이 환불된다(= 의도).
      // captureID 가 없으면 수동 입금 건이므로 운영자가 별도 환불(기존 mark-refunded 와 동일 정책).
      let paypalRefund = null;
      let refundFinal = false;   // 좌석 해제 게이트 — COMPLETED(final)만 종단 성공
      if (captureID) {
        const result = await refundPaypalCapture({
          captureID,
          // 같은 예약에 대한 배차실패 취소는 1회뿐 — 재클릭/타임아웃 재시도를 멱등 처리.
          idempotencyKey: `${bookingRef}:dispatch-cancel`,
          refundUSD: null,
          currency: bookingData.currency,
          note: `CocoTrip dispatch failure refund: ${String(reason).slice(0, 60)}`,
        });
        if (!result.ok) {
          console.error('[admin-booking-action] dispatch-cancel refund failed:', result.code, result.error);
          // 환불이 안 됐는데 CANCELED 로 적으면 "취소됐는데 돈은 안 온" 상태가 된다 → 상태 미변경.
          res.writeHead(result.status, JSON_HEADERS);
          return res.end(JSON.stringify(_err(result.error, result.code)));
        }
        paypalRefund = result.refund;
        refundFinal = result.final === true;
        if (result.pending) {
          notify('admin', `🟠 <b>배차실패 취소 환불 PENDING (eCheck?)</b>\n<code>${bookingRef}</code>\nrefund: <code>${paypalRefund.id}</code>`).catch(() => {});
        }
      } else {
        console.warn('[admin-booking-action] dispatch-cancel without captureID — 수동 환불 필요:', bookingRef);
      }

      const update = {
        status: 'CANCELED',
        canceledAt: FieldValue.serverTimestamp(),
        canceledByUid: adminUid,
        canceledReason: reasonText,
        cancelReason: reasonText,          // mark-canceled 와 필드명 호환
        cancelCategory,
        cancelFault: 'operator',           // 우리 귀책 — 취소율 집계에서 고객 귀책과 분리
        dispatchFailed: true,
        refundedKRW: refundKrw,
        refundPercent: 100,
        updatedAt: FieldValue.serverTimestamp(),
        ...(paypalRefund
          ? { refundID: paypalRefund.id, refundStatus: paypalRefund.status, refundSource: 'paypal-api' }
          : { refundSource: 'manual-pending' }),
      };
      await pendingRef.update(update);
      await adminDb.collection('bookings').doc(bookingId).set(update, { merge: true });

      // 🔴 좌석 해제 — dispatch-cancel 은 정의상 항상 전액환불 + 예약 취소다(우리 귀책).
      //   위 status 가드(CONFIRMED 만 통과)가 재클릭 방어선이고, 원장 tombstone 이 2차 방어선.
      //   단 **환불이 확정 성공했을 때만** — captureID 없음(수동 환불 대기)·PENDING 은 helper 가 보류한다.
      //   (예약은 CANCELED 로 확정되지만 좌석은 잠긴 채 남는다. 위 booking 알림의 "수동 환불 필요" 가 탐지선.)
      await releaseSeatsAfterRefund({ adminDb, bookingRef, bookingId, bookingData, action, refundFinal });

      notify('booking', [
        '🚐 <b>배차 실패 — 예약 취소 + 전액 환불</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>사유:</b> ${reasonText}`,
        `<b>환불액:</b> ₩${refundKrw.toLocaleString('ko-KR')}`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        paypalRefund ? `<b>PayPal refund:</b> <code>${paypalRefund.id}</code>` : '⚠️ captureID 없음 — 수동 환불 필요',
      ].filter(Boolean).join('\n')).catch(() => {});

      // 고객 안내 — 사유를 그대로 전달한다(운영자가 남긴 문장이 곧 고객 안내문).
      sendCustomerNotification('refunded', {
        ...pending,
        refundedKRW: refundKrw,
        refundReason: reasonText,
        language: lang,
      }).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          bookingRef,
          status: 'CANCELED',
          cancelCategory,
          reason: reasonText,
          refundedKRW: refundKrw,
          refundSource: paypalRefund ? 'paypal-api' : 'manual-pending',
          ...(paypalRefund ? { refundID: paypalRefund.id } : {}),
        },
      }));
    }

    // ──────── Action 3: mark-canceled ────────────────────────────────
    if (action === 'mark-canceled') {
      await pendingRef.update({
        status: 'CANCELED',
        cancelReason: reason || null,
        canceledAt: FieldValue.serverTimestamp(),
        canceledByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const telText = [
        '❌ <b>예약 취소</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        reason ? `<b>사유:</b> ${reason}` : null,
      ].filter(Boolean).join('\n');
      notify('booking', telText).catch(() => {});

      // 사용자 4-lang 취소 안내 이메일
      sendCustomerNotification('canceled', {
        ...pending,
        cancelReason: reason || null,
      }).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: { bookingRef, status: 'CANCELED' } }));
    }

    // unreachable
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err('unhandled action', 'UNHANDLED')));
  } catch (err) {
    console.error('[admin-booking-action] failed:', err.message);
    await captureError(err, { route: '/api/admin-booking-action', method: req.method, adminEmail });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
