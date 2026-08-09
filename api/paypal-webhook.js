/**
 * POST /api/paypal-webhook
 *
 * PayPal Business Webhook 수신 endpoint — 한국 체류 외국인 사용자의 paypal.me/cocotripkr
 * 결제가 머천트 계정에 입금되면 PayPal 이 이 endpoint 로 IPN-style webhook 발사.
 * memo 의 bookingRef (CT-YYYYMMDD-XXX) 로 자동 매칭 → admin 클릭 0건 워크플로우.
 *
 * 처리 이벤트:
 *   PAYMENT.CAPTURE.COMPLETED — 자동 [입금 확인] (mark-paid 동등)
 *   PAYMENT.SALE.COMPLETED    — 레거시 NVP/SOAP 거래도 paypal.me 에서 발사
 *   PAYMENT.CAPTURE.REFUNDED  — 자동 [환불 처리] (mark-refunded 동등)
 *   PAYMENT.SALE.REFUNDED     — 레거시 환불
 *   * 그 외 — 로그만 남기고 200 응답 (PayPal 재시도 차단)
 *
 * 보안:
 *   PayPal verify-webhook-signature API 호출 — 헤더 5종 + 본문 + webhook_id 매칭 확인.
 *   PAYPAL_WEBHOOK_ID 미설정 시 모든 이벤트 거부 (운영자 등록 누락 방지).
 *
 * 멱등:
 *   paypal_webhook_log/{eventId} doc 존재 여부로 중복 처리 차단.
 *   confirmBookingAsPaid 자체도 status='CONFIRMED' 면 부수효과 스킵.
 *
 * 운영자 등록:
 *   PayPal Developer Dashboard → My Apps & Credentials → 본인 앱 → Webhooks → Add Webhook
 *   URL: https://cocotripkr.com/api/paypal-webhook
 *   Events: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED
 *           (옵션) PAYMENT.SALE.COMPLETED, PAYMENT.SALE.REFUNDED
 *   Webhook ID 복사 → Vercel env PAYPAL_WEBHOOK_ID 등록 (Production)
 *
 * ENV:
 *   PAYPAL_WEBHOOK_ID         — 등록된 webhook ID (필수)
 *   PAYPAL_CLIENT_ID          — 기존 (signature verify 용)
 *   PAYPAL_CLIENT_SECRET      — 기존
 *   PAYPAL_WEBHOOK_TOLERANCE  — amount 매칭 허용오차 (옵션, default 0.01 = 1%)
 */
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { notify } from './_shared/notify.js';
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { confirmBookingAsPaid } from './_shared/booking-confirm.js';
import {
  applyRefundEvent, applyRefundStatusEvent, fetchAuthoritativeCaptureStatus, checkEnvironmentsMatch,
} from './_shared/refund-ledger.js';
import { releaseSlotForCanceledOrder } from './_shared/slot-capacity.js';

// PR #423 (CZ6): disable Vercel's auto-bodyParser so we receive the raw
// PayPal-signed bytes. If Vercel parses + we re-stringify (the previous
// branch in readRawBody), key ordering and number normalisation drift
// from PayPal's canonical form and verify-webhook-signature returns
// FAILURE on every legitimate event — auto-confirm silently stops working.
export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },
};
export const maxDuration = 30;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const BOOKING_REF_PATTERN = /CT-\d{8}-\d{3}/;

// PR #423 (CZ6): PayPal signs the raw request bytes. To verify the signature
// we MUST parse the body ourselves from the original bytes — never let
// Vercel parse + re-stringify, because key ordering / number normalisation
// drift produces a JSON shape that PayPal's canonical-form hash rejects.
//
// With `api: { bodyParser: false }` set above, req.body is undefined and we
// always read the IncomingMessage stream. The two preserved branches handle
// dev/test setups where the stream has already been consumed.
async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer?.(req.body)) return req.body.toString('utf8');
  // No fallback to JSON.stringify(req.body) — that's the exact bug CZ6 fixes.
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * 서명 검증 결과 3분류 (2026-07-29).
 *
 * 🔴 이전에는 셋을 전부 "검증 실패" 로 뭉쳐 200 ack 했다. 그래서 **PayPal 검증 API 가
 *   429/5xx 로 잠깐 죽으면** 그 사이 들어온 결제·환불 이벤트가 전부 조용히 버려졌다.
 *   PayPal 은 200 을 받으면 재전송하지 않는다 = 영구 유실.
 *
 *   bad_request  본문/헤더 자체가 잘못됨 → 재전송해도 같다. 200 ack.
 *   rejected     PayPal 이 FAILURE 라고 답함 → 결정적. 200 ack (재시도 storm 차단).
 *   transient    검증 API 429/5xx·네트워크 장애 → **판단 불가**. 5xx 로 재전송 유도.
 */
const VERIFY = { OK: 'ok', BAD_REQUEST: 'bad_request', REJECTED: 'rejected', TRANSIENT: 'transient' };

async function verifyWebhookSignature({ headers, bodyString, webhookId, isSandbox }) {
  let accessToken;
  let baseUrl;
  try {
    ({ accessToken, baseUrl } = await getPaypalAccessToken(isSandbox));
  } catch (e) {
    // 토큰 발급 실패 = PayPal 쪽 일시 장애. 서명이 틀렸다는 뜻이 아니다.
    return { verified: false, kind: VERIFY.TRANSIENT, reason: `token_fetch_failed: ${e.message}` };
  }

  // PayPal 은 webhook_event 필드를 객체로 받음 — 본문을 그대로 파싱해서 전달.
  // (raw string 이 아니라 JSON 인 점이 가장 자주 헷갈리는 부분)
  let webhookEvent;
  try {
    webhookEvent = JSON.parse(bodyString);
  } catch {
    return { verified: false, kind: VERIFY.BAD_REQUEST, reason: 'invalid_json' };
  }

  const verifyPayload = {
    auth_algo: headers['paypal-auth-algo'] || headers['Paypal-Auth-Algo'],
    cert_url: headers['paypal-cert-url'] || headers['Paypal-Cert-Url'],
    transmission_id: headers['paypal-transmission-id'] || headers['Paypal-Transmission-Id'],
    transmission_sig: headers['paypal-transmission-sig'] || headers['Paypal-Transmission-Sig'],
    transmission_time: headers['paypal-transmission-time'] || headers['Paypal-Transmission-Time'],
    webhook_id: webhookId,
    webhook_event: webhookEvent,
  };

  // 누락 헤더 = signature 위변조 가능성. 즉시 거부.
  for (const [k, v] of Object.entries(verifyPayload)) {
    if (k === 'webhook_event') continue;
    if (!v) return { verified: false, kind: VERIFY.BAD_REQUEST, reason: `missing_header:${k}`, webhookEvent };
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verifyPayload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // 네트워크 장애·타임아웃 — 서명이 틀렸는지 알 수 없다.
    return { verified: false, kind: VERIFY.TRANSIENT, reason: `verify_api_network: ${e.message}`, webhookEvent };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // 429/5xx = PayPal 쪽 일시 장애. 4xx 는 우리 요청이 잘못된 것(재전송해도 같다).
    const transient = res.status === 429 || res.status >= 500;
    return {
      verified: false,
      kind: transient ? VERIFY.TRANSIENT : VERIFY.BAD_REQUEST,
      reason: `verify_api_${res.status}`, debug: txt, webhookEvent,
    };
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { verified: false, kind: VERIFY.TRANSIENT, reason: `verify_api_bad_json: ${e.message}`, webhookEvent };
  }
  if (data && data.verification_status === 'SUCCESS') {
    return { verified: true, kind: VERIFY.OK, reason: 'SUCCESS', webhookEvent };
  }
  return {
    verified: false,
    // 응답은 왔는데 SUCCESS 가 아니다 = PayPal 이 명시적으로 거절. 결정적이다.
    kind: data && data.verification_status ? VERIFY.REJECTED : VERIFY.TRANSIENT,
    reason: (data && data.verification_status) || 'unknown_verify_response',
    webhookEvent,
  };
}

function extractBookingRefFromEvent(event) {
  const r = event?.resource || {};
  // 후보 필드 — paypal.me/Checkout API/SOAP 모두 대응
  const candidates = [
    r.note_to_payee,
    r.custom_id,
    r.invoice_id,
    r.purchase_units?.[0]?.custom_id,
    r.purchase_units?.[0]?.invoice_id,
    r.description,
  ].filter(Boolean);

  for (const text of candidates) {
    const m = String(text).match(BOOKING_REF_PATTERN);
    if (m) return m[0];
  }
  return null;
}

function extractAmountUSD(event) {
  const r = event?.resource || {};
  // PAYMENT.CAPTURE.* 와 PAYMENT.SALE.* 의 amount 위치가 다름
  const amount = r.amount || r.purchase_units?.[0]?.amount || {};
  const value = parseFloat(amount.value || amount.total || '0');
  const currency = amount.currency_code || amount.currency || 'USD';
  return { value: Number.isFinite(value) ? value : 0, currency };
}

function extractRefundedCaptureId(event) {
  // refund 이벤트의 links 에 up rel 로 원래 capture id 가 들어 있음
  const links = event?.resource?.links || [];
  const upLink = links.find((l) => l.rel === 'up');
  if (!upLink?.href) return null;
  // href 형식: https://api.paypal.com/v2/payments/captures/{captureId}
  const m = String(upLink.href).match(/\/(captures|sale)\/([^/?]+)/);
  return m ? m[2] : null;
}

/**
 * PR #438 (Audit Y-H7 — 2026-05-16): PayPal-direct flow (createPaypalOrder +
 * capturePaypalOrder) 는 order memo 에 custom_id/invoice_id/note_to_payee 를
 * 안 넣어서 webhook 이 bookingRef 로 매칭 불가 → 매 capture 마다
 * "unmatched" alert 발사. 이걸 막으려면 PayPal 이 capture event 에 함께 주는
 * `supplementary_data.related_ids.order_id` 로 우리 `bookings/{orderID}` 를
 * 직접 lookup. capturePaypalOrder 가 이미 status='CONFIRMED' 로 저장한 후라
 * webhook 은 단순 ack 만 하면 됨 (사용자에게는 redundant alert 없음).
 */
function extractPaypalOrderId(event) {
  const r = event?.resource || {};
  return r.supplementary_data?.related_ids?.order_id
      || r.purchase_units?.[0]?.payments?.captures?.[0]?.supplementary_data?.related_ids?.order_id
      || null;
}

function webhookLogPayload({ eventId, eventType, status, detail, environment }) {
  return {
    eventId,
    eventType: eventType || 'unknown',
    status,
    paypalEnvironment: environment || 'unverified',
    detail: detail || null,
    receivedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * 진단용 로그 — 실패를 삼킨다.
 * ⚠️ **처리 완료(processed)를 남기는 경로에는 쓰지 말 것.** 로그가 조용히 실패하면
 *   "상태는 바뀌었는데 processed 는 없음" 또는 그 반대가 되어 재전송 때 이중 반영된다.
 *   그런 경로는 transaction 안에서 함께 쓰거나 logWebhookEventStrict 를 쓴다.
 */
async function logWebhookEvent({ db, eventId, eventType, status, detail, environment }) {
  try {
    await db.collection('paypal_webhook_log').doc(eventId).set({
      eventId,
      eventType: eventType || 'unknown',
      status, // 'processed' | 'duplicate' | 'unmatched' | 'unsupported' | 'verify_failed' | 'error' | 'environment_mismatch'
      // 🔴 2026-07-29: 어느 PayPal 환경에서 **검증에 통과한** 이벤트인지. 사후 대사·격리 판정 근거.
      //   서명 검증 전 단계에서 남기는 로그는 'unverified'.
      paypalEnvironment: environment || 'unverified',
      detail: detail || null,
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[paypal-webhook] log failed:', e.message);
  }
}

/** 실패를 던지는 버전 — 호출부가 5xx 로 응답해 PayPal 재전송을 받아야 하는 경로용. */
async function logWebhookEventStrict({ db, eventId, eventType, status, detail, environment }) {
  await db.collection('paypal_webhook_log').doc(eventId).set(
    webhookLogPayload({ eventId, eventType, status, detail, environment }),
    { merge: true },
  );
}

async function alertAdmin(text) {
  try { await notify('admin', text); } catch {}
}

/**
 * 환불 웹훅이 확정 좌석(slot_bookings)을 되돌린다 (2026-08-09).
 *
 * 왜 필요했나: PR #1270 이 좌석 해제를 붙인 곳은 우리 코드를 타는 경로뿐이었다
 *   (cancelBooking / admin mark-refunded / dispatch-cancel). 운영자가 PayPal 대시보드에서
 *   직접 환불하면 우리가 아는 유일한 통로가 이 웹훅이라, 예약만 REFUNDED 로 바뀌고
 *   slot_bookings[slotId] 는 그대로 남았다 → 그 좌석은 다시 팔리지 않는다(매출손실).
 *
 * 🔴 fail-closed. 아래 게이트 중 하나라도 어긋나면 **좌석을 건드리지 않는다** —
 *   좌석을 잘못 여는 것은 오버부킹(현장 사고)이고, 안 여는 것은 매출손실에 그친다.
 *   1. `PAYMENT.CAPTURE.REFUNDED` 만. `PAYMENT.SALE.REFUNDED` 는 레거시 NVP/SOAP 거래로
 *      createPaypalOrder 스냅샷 규약 밖이다(orderID 자체가 없다).
 *   2. 환불 resource 가 `COMPLETED`. PENDING(eCheck·리스크홀드)은 나중에 FAILED 로 뒤집히고
 *      (F4 webhook 이 REFUND_FAILED 로 치유) 그러면 환불받지 못한 손님의 자리를 남에게 판 상태가 된다.
 *      status 가 아예 없는 이벤트도 단정하지 않는다.
 *      (cancelBooking·admin 의 `refundRes.final` 게이트와 같은 판정 — 여기선 웹훅 payload 가 근거다.)
 *   3. 원장 판정이 전액(`REFUNDED`). 부분환불은 예약이 살아있을 수 있어(굿윌 일부 환급 등)
 *      좌석을 풀면 오버부킹이 된다 → 운영자 판단 영역.
 *   4. bookings 문서 매칭이 있어야 orderID 를 안다. pending_bookings 만 매칭된 수동 QR 건은
 *      PayPal order 자체가 없다.
 *   5. cart 자식(parentOrderID)은 형제와 capture 를 공유해 라인별 좌석 귀속이 불가능 → 보류.
 *      (형제 N건이 captureID 를 공유하는 경우는 호출부의 F6 ambiguous 가드가 이미 조기 반환한다.)
 *
 * 되돌리는 양·근거 슬롯은 helper 계약 그대로 — 확정 원장(slot_confirmed)이 증명하는 만큼만,
 * 슬롯은 서버 스냅샷(paypal_order_snapshots)만이 근거다. bookings 문서의 tourId/tourSlotId 등
 * 클라이언트 출처 필드는 쓰지 않는다(엉뚱한 슬롯을 깎는다).
 *
 * best-effort: 이 시점엔 환불 원장 transaction 이 이미 커밋됐다(= 이벤트가 processed).
 *   여기서 503 을 던져도 PayPal 재전송은 duplicate_event 로 걸러져 좌석은 어차피 안 열린다
 *   → 응답은 200 을 유지하고 운영자에게 알린다(좌석을 임의로 조작하지 않는다).
 *
 * @returns {Promise<boolean>} 좌석을 실제로 차감했는가 (관측용 — 응답 slotReleased)
 */
async function releaseSeatsAfterRefundWebhook({
  adminDb, eventType, refundStatus, resultStatus, bookingsDocId, bookingData, bookingRef, captureId,
}) {
  if (eventType !== 'PAYMENT.CAPTURE.REFUNDED') return false;

  const refundFinal = String(refundStatus || '').toUpperCase() === 'COMPLETED';
  if (!refundFinal) {
    console.warn('[paypal-webhook] 환불 미확정 — 좌석 해제 보류:', { bookingRef, refundStatus: refundStatus || null });
    return false;
  }
  if (resultStatus !== 'REFUNDED') {
    console.warn('[paypal-webhook] 부분환불 — 좌석 해제 보류 (예약 유효 가능):', { bookingRef, resultStatus });
    return false;
  }
  if (!bookingsDocId) {
    console.warn('[paypal-webhook] bookings 미매칭(수동 QR 등) — 좌석 해제 보류:', { bookingRef });
    return false;
  }
  if (bookingData && bookingData.parentOrderID) {
    console.warn('[paypal-webhook] slot release skipped — cart child (형제와 capture 공유):', bookingRef);
    return false;
  }

  try {
    const orderId = (bookingData && bookingData.orderID) || bookingsDocId;
    const release = await releaseSlotForCanceledOrder({ adminDb, orderId });
    if (release.released) {
      console.log('[paypal-webhook] slot released:', { bookingRef, slot: release.slot, pax: release.pax });
      return true;
    }
    // NO_SNAPSHOT_BINDING = 비슬롯 상품(AI 플래너·수동입금 등)의 정상 상태 → 조용히 통과(알림 홍수 방지).
    // ALREADY_RELEASED = cancelBooking·admin 이 먼저 풀고 웹훅이 뒤따라온 정상 경로.
    console.warn('[paypal-webhook] slot release skipped:', release.reason, { bookingRef });
    if (release.reason === 'NO_CONFIRMED_RECORD') {
      await alertAdmin([
        '⚠️ <b>환불 완료 — 좌석 해제 보류 (확정 원장 없음)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>슬롯:</b> ${release.slot?.tourId} / ${release.slot?.date} / ${release.slot?.slotId}`,
        '',
        '→ 이 주문이 좌석을 확정한 기록이 없어 좌석을 건드리지 않았습니다',
        '   (기록 없이 빼면 다른 손님의 확정석을 지웁니다). 좌석 수동 확인 필요.',
      ].join('\n'));
    }
    return false;
  } catch (e) {
    console.error('[paypal-webhook] slot release failed (non-fatal):', e.message);
    captureError(e, { tag: 'paypal-webhook-slot-release', captureId, bookingRef });
    await alertAdmin([
      '🚨 <b>환불 완료 — 좌석 해제 실패 (좌석이 잠긴 채 남음)</b>',
      '',
      `<b>예약번호:</b> <code>${bookingRef}</code>`,
      `<b>Capture:</b> <code>${captureId}</code>`,
      `<b>오류:</b> ${(e.message || '').slice(0, 200)}`,
      '',
      '→ 환불 기록은 정상. 해당 슬롯의 확정석만 수동 해제 필요.',
    ].join('\n'));
    return false;
  }
}

/**
 * 🔴 2026-07-29 — 상태를 바꾸는 **모든** 웹훅 경로 앞에 세우는 환경 검사.
 *
 * 이전에는 환불 원장에만 있었다. 그래서 CAPTURE.COMPLETED(예약 확정)나
 * REFUND.FAILED(상태 되돌리기)는 환경을 넘나들며 그대로 통과했다.
 *
 * bookings 와 pending_bookings 의 환경값을 **함께** 본다(한쪽만 골라 비교하면
 * 어느 쪽을 고르냐로 판정이 갈린다). 하나라도 반대 환경이면 데이터를 건드리지 않는다.
 *
 * 🔴 결과를 셋으로 나눈다. store_unavailable 을 environment_mismatch 로 바꿔 200 을 주면
 *   일시적 Firestore 장애가 "격리 완료" 로 둔갑해 PayPal 이 재전송하지 않는다 = 이벤트 유실.
 *
 * @returns {Promise<{ok: boolean, status: string, bookingEnvironment?: string|null, error?: string}>}
 */
const ENV_GUARD = {
  MATCHED: 'matched',
  MISMATCH: 'environment_mismatch',
  STORE_UNAVAILABLE: 'store_unavailable',
};

async function guardWebhookEnvironment({ db, eventId, eventType, environment, bookingRef, bookingsDocId, captureId }) {
  const envs = [];
  try {
    if (bookingsDocId) {
      const s = await db.collection('bookings').doc(bookingsDocId).get();
      if (s.exists) envs.push((s.data() || {}).paypalEnvironment);
    }
    if (bookingRef) {
      const p = await db.collection('pending_bookings').doc(bookingRef).get();
      if (p.exists) envs.push((p.data() || {}).paypalEnvironment);
    }
  } catch (e) {
    // 🔴 조회 실패는 **환경 불일치가 아니다**. 둘을 합치면 일시적 Firestore 장애가
    //   "격리 완료 + 200" 으로 둔갑해 PayPal 이 재전송하지 않는다 = 이벤트 영구 유실.
    console.error('[paypal-webhook] 환경 확인 조회 실패 — 재전송 유도:', e.message);
    return { ok: false, status: ENV_GUARD.STORE_UNAVAILABLE, error: e.message };
  }
  const verdict = checkEnvironmentsMatch(envs, environment);
  if (verdict.ok) return { ok: true, status: ENV_GUARD.MATCHED };

  await logWebhookEvent({
    db, environment, eventId, eventType,
    status: 'environment_mismatch',
    detail: {
      reason: 'webhook_environment_differs_from_booking',
      bookingEnvironment: verdict.bookingEnvironment,
      bookingRef: bookingRef || null,
      bookingsDocId: bookingsDocId || null,
      captureId: captureId || null,
    },
  });
  await alertAdmin(`🚨 <b>웹훅 환경 불일치 — 격리</b>\n\n이벤트: ${eventType}\n웹훅: ${environment}\n예약: ${verdict.bookingEnvironment || '표시없음'}\n예약번호: <code>${bookingRef || bookingsDocId || '-'}</code>\n→ 데이터를 갱신하지 않았습니다.`);
  return { ok: false, status: ENV_GUARD.MISMATCH, bookingEnvironment: verdict.bookingEnvironment };
}

/** 일시 장애 공통 5xx 응답 — PayPal 이 재전송하게 한다(200 으로 삼키면 영구 유실). */
function respondRetryable(res, reason, detail) {
  console.error(`[paypal-webhook] 일시 장애로 재전송 유도: ${reason}`, detail || '');
  res.writeHead(503, JSON_HEADERS);
  return res.end(JSON.stringify({ ok: false, status: 'retryable', reason }));
}

/**
 * PR #440 (Audit Y-H9 — 2026-05-16): operator alert for verify_failed,
 * deduplicated so a misconfigured webhook secret doesn't spam Telegram.
 *
 * Uses Firestore as a 1-hour-per-reason throttle. Doc key is
 * sha256(reason) so distinct verify-failure reasons each get one
 * alert per hour. If Firestore is unavailable, fall back to always
 * alerting (operator visibility > spam concerns during outage).
 */
async function alertVerifyFailedDedup({ db, eventId, reason, eventType }) {
  const reasonKey = String(reason || 'unknown').slice(0, 200);
  const message = [
    '🚨 <b>PayPal Webhook signature 검증 실패</b>',
    '',
    `<b>이벤트 ID:</b> <code>${(eventId || 'unknown').slice(0, 80)}</code>`,
    `<b>이벤트 타입:</b> ${eventType || 'unknown'}`,
    `<b>실패 사유:</b> ${reasonKey}`,
    '',
    '→ 본 응답은 PayPal 에 200 ack (재시도 storm 차단). 진짜 misconfig 라면',
    '  PAYPAL_WEBHOOK_ID 또는 PAYPAL_*_CLIENT_SECRET 점검 필요.',
    '→ 1시간당 같은 사유 1회만 알림 (dedup).',
  ].join('\n');

  if (!db) {
    notify('admin', message).catch(() => {});
    return;
  }

  try {
    const { createHash } = await import('node:crypto');
    const reasonHash = createHash('sha256').update(reasonKey).digest('hex').slice(0, 32);
    const throttleRef = db.collection('paypal_verify_alert_throttle').doc(reasonHash);
    const now = Date.now();
    const WINDOW_MS = 60 * 60 * 1000;
    const shouldSend = await db.runTransaction(async (tx) => {
      const snap = await tx.get(throttleRef);
      const lastSentMs = snap.exists ? Number(snap.data()?.lastSentMs || 0) : 0;
      if (lastSentMs && (now - lastSentMs) < WINDOW_MS) return false;
      tx.set(throttleRef, { lastSentMs: now, lastReason: reasonKey, lastEventId: eventId || null }, { merge: true });
      return true;
    });
    if (shouldSend) {
      notify('admin', message).catch(() => {});
    } else {
      console.log('[paypal-webhook] verify_failed alert deduped (within 1h window):', reasonHash);
    }
  } catch (e) {
    // Throttle infra failure — alert anyway so the real issue isn't masked.
    console.warn('[paypal-webhook] verify_failed dedup throttle failed (alerting anyway):', e.message);
    notify('admin', message).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const headers = req.headers || {};
  const eventId = headers['paypal-transmission-id'] || headers['Paypal-Transmission-Id'] || `noheader-${Date.now()}`;

  try {
    // 🔴 2026-07-29 (단일 환경 검증): 이 배포는 **한 환경만** 받는다.
    //   Preview+PAYPAL_ENV=sandbox → sandbox Webhook ID + sandbox API 로만 1회 검증
    //   그 외(운영 포함)          → live Webhook ID + live API 로만 1회 검증
    //   양방향 폴백을 완전히 제거했다. 이전에는 프리뷰 샌드박스 배포도 live 서명을 먼저
    //   검증해 **성공하면 live 이벤트를 그대로 처리**했다 — 한쪽만 막힌 반쪽 차단이었다.
    const isSandboxDeploy = resolveIsSandbox();
    const activeWebhookId = isSandboxDeploy
      ? (process.env.PAYPAL_SANDBOX_WEBHOOK_ID || '').trim()
      : (process.env.PAYPAL_WEBHOOK_ID || '').trim();
    if (!activeWebhookId) {
      // 이 환경에 맞는 Webhook ID 가 없다 → 검증 불가. 다른 환경 ID 로 대신하지 않는다.
      const missingKey = isSandboxDeploy ? 'PAYPAL_SANDBOX_WEBHOOK_ID' : 'PAYPAL_WEBHOOK_ID';
      console.error(`[paypal-webhook] ${missingKey} not configured — rejecting`);
      await alertAdmin(`🚨 <b>PayPal Webhook 미구성</b>\n\n${missingKey} env 누락 (${isSandboxDeploy ? 'sandbox' : 'live'} 배포).\n→ 다른 환경의 Webhook ID 로 대체하지 않습니다.`);
      res.writeHead(503, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'webhook not configured' }));
    }

    const adminDb = initAdminDb('paypal-webhook');
    if (!adminDb) {
      // 🔴 2026-07-29: 이전엔 200 이었다. Firestore 가 잠깐 죽은 사이 들어온 결제·환불
      //   이벤트가 전부 조용히 버려졌다(PayPal 은 200 을 받으면 재전송하지 않는다).
      //   저장소 불능은 "처리했다" 가 아니라 "아직 못 했다" 다 → 503 으로 재전송을 받는다.
      return respondRetryable(res, 'firestore_unavailable');
    }

    // 멱등 — 같은 transmission-id 재시도면 처리 스킵
    const logRef = adminDb.collection('paypal_webhook_log').doc(eventId);
    let existing;
    try {
      existing = await logRef.get();
    } catch (e) {
      // 멱등 확인을 못 하면 이중 반영 위험이 있다 → 처리하지 않고 재전송을 받는다.
      return respondRetryable(res, 'webhook_log_read_failed', e.message);
    }
    if (existing.exists && existing.data()?.status === 'processed') {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, idempotent: true }));
    }

    // raw body 읽기
    const bodyString = await readRawBody(req);

    // ── signature 검증 — **정확히 1회, 이 배포의 환경으로만** ───────────
    //   폴백이 없다. 다른 환경의 Webhook ID 는 요청 본문에 들어가지 않는다.
    //   verifiedEnvironment 기본값은 'unverified' — 서명이 실제로 통과해야 환경이 확정된다.
    let verifiedEnvironment = 'unverified';
    const verifyResult = await verifyWebhookSignature({
      headers, bodyString, webhookId: activeWebhookId, isSandbox: isSandboxDeploy,
    });
    if (verifyResult.verified) {
      verifiedEnvironment = isSandboxDeploy ? 'sandbox' : 'live';
    }

    if (!verifyResult.verified) {
      // 🔴 검증 API 자체가 죽은 경우(429/5xx/네트워크)를 "서명 실패" 로 분류해 버리면 안 된다.
      //   결정적 실패가 아니므로 5xx 로 재전송을 받는다.
      if (verifyResult.kind === VERIFY.TRANSIENT) {
        await logWebhookEvent({
          db: adminDb, environment: 'unverified', eventId,
          eventType: verifyResult.webhookEvent?.event_type,
          status: 'verify_unavailable',
          detail: { reason: verifyResult.reason },
        });
        return respondRetryable(res, 'paypal_verify_api_unavailable', verifyResult.reason);
      }
      console.error('[paypal-webhook] signature verification failed:', verifyResult.reason);
      await logWebhookEvent({
        db: adminDb, environment: verifiedEnvironment, eventId,
        eventType: verifyResult.webhookEvent?.event_type,
        status: 'verify_failed',
        detail: { reason: verifyResult.reason },
      });

      // PR #440 (Audit Y-H9 — 2026-05-16): respond 200 (NOT 401) on
      // verify_failed.
      //
      // Pre-fix: 401 → PayPal interprets as "deliverable but unprocessed"
      // and retries up to 25 times over 3 days (per PayPal IPN docs).
      // Each retry calls verifyWebhookSignature → consumes PayPal API
      // quota. A single misconfigured webhook secret could storm 25×
      // /transmission for every PayPal event.
      //
      // Signature failure is DETERMINISTIC — retrying won't fix it.
      // The right behavior is to ack so PayPal stops, log the failure
      // for forensics (already done above), and surface to the operator
      // via Telegram with dedup (so a misconfig storm doesn't spam the
      // channel either). Security is unaffected: we still don't process
      // the unverified event below.
      await alertVerifyFailedDedup({
        db: adminDb,
        eventId,
        reason: verifyResult.reason,
        eventType: verifyResult.webhookEvent?.event_type,
      });

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'signature verification failed', acked: true }));
    }

    const event = verifyResult.webhookEvent;
    const eventType = event.event_type || 'unknown';
    console.log('[paypal-webhook] verified event:', eventType, eventId);

    // ─── PAYMENT.CAPTURE.COMPLETED / PAYMENT.SALE.COMPLETED ─────────
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'PAYMENT.SALE.COMPLETED') {
      const bookingRef = extractBookingRefFromEvent(event);
      const { value: amountUSD, currency } = extractAmountUSD(event);
      const paypalTxId = event.resource?.id || null;

      if (!bookingRef) {
        // PR #438 (Audit Y-H7 — 2026-05-16): PayPal-direct flow (Smart
        // Buttons) doesn't carry our bookingRef in any memo field, but the
        // capture event DOES carry the original PayPal order id under
        // supplementary_data.related_ids.order_id. capturePaypalOrder.js
        // stores `bookings/{orderID}` with status='CONFIRMED' before this
        // webhook arrives, so the right behavior here is just to ack —
        // not to alert the operator (alert is for genuine unmatched cases
        // like manual QR with malformed memo).
        const paypalOrderId = extractPaypalOrderId(event);
        if (paypalOrderId) {
          const directBookingDoc = await adminDb.collection('bookings').doc(paypalOrderId).get();
          if (directBookingDoc.exists) {
            const directData = directBookingDoc.data() || {};
            const envOk = await guardWebhookEnvironment({
              db: adminDb, eventId, eventType, environment: verifiedEnvironment,
              bookingsDocId: paypalOrderId, bookingRef: directData.bookingRef || null,
              captureId: paypalTxId,
            });
            if (!envOk.ok) {
              if (envOk.status === ENV_GUARD.STORE_UNAVAILABLE) {
                return respondRetryable(res, 'environment_check_unavailable', envOk.error);
              }
              res.writeHead(200, JSON_HEADERS);
              return res.end(JSON.stringify({ ok: true, status: 'environment_mismatch' }));
            }
            // 🔴 2026-07-29: 이 경로도 processed 기록을 삼키지 않는다.
            //   로그가 조용히 실패하면 PayPal 재전송 때 멱등 확인이 헛돌아 매번 다시 처리된다.
            //   재전송은 안전하다 — 예약은 capture endpoint 가 이미 CONFIRMED 로 저장했고
            //   이 분기는 **읽기만** 한다(확정·적립·메일 없음). 그래서 processed 로그만 수렴한다.
            try {
              await logWebhookEventStrict({
                db: adminDb, environment: verifiedEnvironment, eventId, eventType,
                status: 'processed',
                detail: {
                  reason: 'already_confirmed_via_capture_endpoint',
                  bookingRef: directData.bookingRef || paypalOrderId,
                  paypalOrderId, paypalTxId, amountUSD, currency,
                },
              });
            } catch (e) {
              return respondRetryable(res, 'processed_log_write_failed', e.message);
            }
            console.log('[paypal-webhook] PayPal-direct capture ack (no alert):', paypalOrderId);
            res.writeHead(200, JSON_HEADERS);
            return res.end(JSON.stringify({ ok: true, status: 'already_confirmed' }));
          }
        }
        console.warn('[paypal-webhook] no bookingRef in memo — manual review:', eventId);
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'no_booking_ref', amountUSD, currency, paypalTxId, paypalOrderId },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — bookingRef 미매칭</b>\n\n' +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          (paypalOrderId ? `PayPal Order: <code>${paypalOrderId}</code>\n` : '') +
          `금액: $${amountUSD} ${currency}\n` +
          'memo 에 CT-YYYYMMDD-XXX 패턴 없음 — admin UI 에서 수동 매칭 필요'
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // pending_bookings 매칭 + amount 검증
      const pendingSnap = await adminDb.collection('pending_bookings').doc(bookingRef).get();
      if (!pendingSnap.exists) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'pending_not_found', bookingRef, amountUSD, paypalTxId },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — pending_bookings 없음</b>\n\n' +
          `예약번호: <code>${bookingRef}</code>\n` +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          `금액: $${amountUSD} ${currency}`
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }
      const pending = pendingSnap.data();

      // amount sanity — PriceUSD 와 ±1% (또는 env 설정값) 매칭.
      //
      // PR #431 (Audit Y-H6 — 2026-05-14): default rate 1380 → 1430.
      // 1380 was the launch-era estimate; the current policy_krw_per_usd
      // (src/data/pricing_spec.json) is 1430. Stale 1380 produced a ~3.5 %
      // expected-USD undershoot, so legitimate refund webhooks were being
      // logged as `amount_mismatch` and routed to the operator queue.
      // Pulls from the same env var precedence as capturePaypalOrder.js
      // (PR #425): KRW_USD_RATE > VITE_USD_KRW_RATE > 1430 default.
      const tolerance = parseFloat(process.env.PAYPAL_WEBHOOK_TOLERANCE || '0.01');
      const fallbackUsdToKrw = Number(process.env.KRW_USD_RATE)
        || Number(process.env.VITE_USD_KRW_RATE)
        || 1430;
      const expectedUSD = parseFloat(pending.priceUSD || (Number(pending.priceKRW || 0) / fallbackUsdToKrw));
      if (expectedUSD > 0 && Math.abs(amountUSD - expectedUSD) / expectedUSD > tolerance) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: {
            reason: 'amount_mismatch',
            bookingRef, paypalTxId,
            paidUSD: amountUSD, expectedUSD,
            tolerancePct: tolerance,
          },
        });
        await alertAdmin(
          '⚠️ <b>PayPal Webhook — 금액 불일치</b>\n\n' +
          `예약번호: <code>${bookingRef}</code>\n` +
          `PayPal TX: <code>${paypalTxId}</code>\n` +
          `결제: $${amountUSD}\n` +
          `예상: $${expectedUSD.toFixed(2)} (허용오차 ${(tolerance * 100).toFixed(1)}%)\n\n` +
          'admin UI 에서 수동 검토'
        );
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'amount_mismatch' }));
      }

      // 🔴 상태를 바꾸기 직전 환경 검사 — 환경이 어긋나면 확정하지 않는다.
      const confirmEnvOk = await guardWebhookEnvironment({
        db: adminDb, eventId, eventType, environment: verifiedEnvironment,
        bookingRef, bookingsDocId: null, captureId: paypalTxId,
      });
      if (!confirmEnvOk.ok) {
        if (confirmEnvOk.status === ENV_GUARD.STORE_UNAVAILABLE) {
          return respondRetryable(res, 'environment_check_unavailable', confirmEnvOk.error);
        }
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'environment_mismatch' }));
      }

      // 자동 confirm
      const result = await confirmBookingAsPaid({
        db: adminDb,
        bookingRef,
        paypalTransactionId: paypalTxId,
        source: 'webhook',
      });
      if (!result.ok) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'confirm_failed',
          detail: { reason: result.code, error: result.error, bookingRef, paypalTxId },
        });
        await alertAdmin(`🚨 <b>PayPal Webhook confirm 실패 (재전송 대기)</b>\n\n예약: ${bookingRef}\n사유: ${result.error}`);
        // 🔴 2026-07-29: 이전엔 200 이었다. 예약 확정 저장이 실패했는데 PayPal 이 재전송하지
        //   않으면 **결제는 됐고 예약은 확정 안 된 상태**가 영구히 남는다.
        return respondRetryable(res, 'confirm_booking_failed', result.error);
      }

      // 🔴 확정은 됐는데 processed 기록이 실패하면 재전송 때 다시 확정을 시도한다.
      //   confirmBookingAsPaid 는 이미 CONFIRMED 면 부수효과를 스킵하므로 재실행이 안전하다.
      //   → 로그 실패를 조용히 삼키지 않고 5xx 로 재전송을 받는다.
      try {
        await logWebhookEventStrict({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'processed',
          detail: {
            bookingRef, paypalTxId,
            bookingId: result.bookingId,
            amountUSD,
            alreadyConfirmed: !!result.alreadyConfirmed,
          },
        });
      } catch (e) {
        return respondRetryable(res, 'processed_log_write_failed', e.message);
      }

      console.log('[paypal-webhook] auto-confirmed:', bookingRef, '→', result.bookingId);
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, status: 'confirmed', bookingRef }));
    }

    // ─── PAYMENT.CAPTURE.REFUNDED / PAYMENT.SALE.REFUNDED ───────────
    if (eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType === 'PAYMENT.SALE.REFUNDED') {
      const captureId = extractRefundedCaptureId(event);
      const { value: refundedUSD } = extractAmountUSD(event);

      if (!captureId) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'no_capture_id_in_links' },
        });
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // PR #438 (Audit Y-H7 — 2026-05-16): match across all three storage
      // shapes so PayPal-direct refunds stop being silent-unmatched:
      //   (1) bookings/{captureId}  — legacy ID-as-captureId shape
      //   (2) bookings where captureID==captureId — PR #425 shape (doc id=orderID)
      //   (3) pending_bookings where paypalTransactionId==captureId — admin-matched manual QR
      // Capture the actual bookings doc ID (could be captureId OR orderID) so
      // the subsequent update writes to the RIGHT doc rather than creating an
      // orphan at bookings/{captureId} (the Y-H7 silent bug).
      // 🔴 2026-07-29 (원자화): 여기서는 **어느 문서인지** 만 찾는다.
      //   금액(원결제·이미 환불된 누계)은 transaction 안에서 다시 읽는다 —
      //   여기서 읽어 두면 읽기와 쓰기 사이에 다른 환불이 끼어들어 누계가 유실된다.
      //   capturedExchangeRate 만 예외: 표시용 KRW 환산에만 쓰고 판정에는 안 쓴다.
      let bookingsDocId = null;
      let bookingRef = null;
      let capturedRate = 0;
      // 좌석 해제 게이트가 쓰는 필드만 본다: orderID(스냅샷 키) / parentOrderID(cart 자식 판별).
      // 슬롯 자체는 여기서 읽지 않는다 — 근거는 서버 스냅샷뿐이다.
      let bookingData = null;

      let bookingDoc = await adminDb.collection('bookings').doc(captureId).get();
      if (bookingDoc.exists) {
        bookingsDocId = captureId;
        bookingData = bookingDoc.data();
        bookingRef = bookingDoc.data().bookingRef || captureId;
        capturedRate = Number(bookingDoc.data().capturedExchangeRate) || 0;
      } else {
        // PR #438: try captureID field — PayPal-direct flow's doc id is orderID.
        // 🔴 F6 (2026-07-16): .limit(1) 제거. cart 형제 예약 N개가 하나의 captureID 를 공유하므로
        //   (cart-capture.js) limit(1) 은 임의 1건이 아니라 Firestore equality 쿼리의 암묵
        //   __name__ ASC 정렬 때문에 **항상 첫 라인(__L0)**만 골라 REFUNDED 로 마킹한다 → 실제
        //   환불된 라인은 CONFIRMED 로 남고 엉뚱한 라인이 환불처리된다(기록 오류). size>1 이면
        //   captureID 만으로 어느 라인 환불인지 특정 불가 → 자동 마킹 금지, 운영자 수동 확인.
        const captureFieldMatch = await adminDb.collection('bookings')
          .where('captureID', '==', captureId)
          .get();
        if (captureFieldMatch.size > 1) {
          await logWebhookEvent({
            db: adminDb, environment: verifiedEnvironment, eventId, eventType,
            status: 'ambiguous',
            detail: {
              reason: 'captureID_shared_by_cart_siblings',
              captureId,
              candidates: captureFieldMatch.docs.map((d) => d.id),
              refundedUSD,
            },
          });
          await alertAdmin(`⚠️ <b>cart 환불 webhook — 형제 ${captureFieldMatch.size}건이 captureID 공유</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}\n→ 어느 라인 환불인지 수동 확인 필요`);
          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: true, status: 'ambiguous' }));
        }
        if (!captureFieldMatch.empty) {
          bookingDoc = captureFieldMatch.docs[0];
          bookingsDocId = bookingDoc.id;
          bookingData = bookingDoc.data();
          bookingRef = bookingDoc.data().bookingRef || bookingDoc.id;
          capturedRate = Number(bookingDoc.data().capturedExchangeRate) || 0;
        } else {
          // Manual QR path — admin-matched paypalTransactionId on pending_bookings.
          const pendingMatch = await adminDb.collection('pending_bookings')
            .where('paypalTransactionId', '==', captureId)
            .limit(1).get();
          if (!pendingMatch.empty) {
            bookingRef = pendingMatch.docs[0].id;
            // bookingsDocId stays null — pending_bookings update only.
          }
        }
      }

      if (!bookingRef) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'capture_not_in_bookings', captureId },
        });
        await alertAdmin(`⚠️ <b>PayPal 환불 webhook — booking 미매칭</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}`);
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // 🔴 2026-07-29 (#4): 표시용 KRW 환산은 **원결제 당시 환율**로 한다.
      //   이전에는 지금 시점의 env 환율(없으면 1430)로 환산했다. 결제 환율과 다르면
      //   같은 금액이 다른 KRW 로 찍히고, 아래 부분/전액 판정까지 뒤집혔다.
      //   capturedExchangeRate 가 없는 레거시 문서만 env/기본값으로 폴백한다.
      const usdToKrw = capturedRate
        || Number(process.env.KRW_USD_RATE)
        || Number(process.env.VITE_USD_KRW_RATE)
        || 1430;
      const refundedKRW = Math.round(refundedUSD * usdToKrw);
      // 🔴 2026-07-29 (원자화): 판정·누적·두 저장소 갱신·이벤트 완료 기록을
      //   **하나의 transaction** 으로 묶는다. 자세한 이유는 _shared/refund-ledger.js 머리말.
      //   여기서는 transaction 밖에서만 해도 되는 것(권위 상태 조회)만 미리 한다.
      //
      //   부분/전액 판정에서 환율을 쓰지 않는 이유: PayPal 은 USD 로 결제·환불한다.
      //     ₩13,300 을 환율 1,468 로 $9.06 청구 → 전액 환불 $9.06 을 env 1,430 으로
      //     환산하면 ₩12,956 < ₩13,167(99%) → 전액인데 부분으로 오기록.
      //   누적으로 판정하는 이유: $5 + $4.90 처럼 나눠 전액을 돌려주면, 이번 이벤트
      //     금액만 보고는 영원히 PARTIALLY_REFUNDED 로 남는다.
      const refundId = event?.resource?.id || null;

      // PayPal 이 아는 capture 상태가 최종 진실이다(우리 누계는 이벤트 유실에 취약).
      // 실패하면 null → 누적 계산으로 판정한다. 조회 실패로 환불 기록이 멈추면 안 된다.
      const authoritativeCaptureStatus = await fetchAuthoritativeCaptureStatus(captureId, {
        getPaypalAccessToken,
        isSandbox: resolveIsSandbox(),
      });

      let refundOutcome;
      try {
        refundOutcome = await applyRefundEvent({
          db: adminDb,
          FieldValue,
          eventId,
          eventType,
          refundId,
          captureId,
          refundedUSD,
          refundedKRW,
          usdToKrw,
          bookingsDocId,
          bookingRef,
          authoritativeCaptureStatus,
          // 🔴 검증에 실제로 통과한 PayPal 환경. 예약 문서의 환경과 다르면 원장이 격리한다.
          webhookEnvironment: verifiedEnvironment,
        });
      } catch (e) {
        // 🔴 실패는 processed 로 기록하지 않는다 — PayPal 재전송으로 다시 처리돼야 한다.
        console.error('[paypal-webhook] 환불 원장 transaction 실패 (재시도 가능):', e.message);
        captureError(e, { tag: 'paypal-webhook-refund-tx', eventId, captureId });
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'retryable_error',
          detail: { reason: e.message, captureId, refundId },
        });
        await alertAdmin(`🚨 <b>환불 웹훅 처리 실패 (재시도 대기)</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}\n사유: ${e.message}`);
        res.writeHead(503, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, status: 'retryable', error: 'refund ledger unavailable' }));
      }

      if (!refundOutcome.applied) {
        if (refundOutcome.reason === 'environment_mismatch') {
          // 샌드박스 웹훅이 운영 예약을(또는 그 반대) 건드리려 한 것. 데이터는 손대지 않았다.
          console.error('[paypal-webhook] 환경 불일치로 격리:', verifiedEnvironment, '→', refundOutcome.bookingEnvironment);
          await alertAdmin(`🚨 <b>환불 웹훅 환경 불일치 — 격리</b>\n\n웹훅: ${verifiedEnvironment}\n예약: ${refundOutcome.bookingEnvironment || '표시없음'}\nCapture: <code>${captureId}</code>\n→ 데이터를 갱신하지 않았습니다.`);
        }
        if (refundOutcome.reason === 'unmatched') {
          await logWebhookEvent({
            db: adminDb, environment: verifiedEnvironment, eventId, eventType,
            status: 'unmatched',
            detail: { reason: 'booking_docs_missing', captureId, refundId },
          });
          await alertAdmin(`⚠️ <b>PayPal 환불 webhook — booking 미매칭</b>\n\nCapture: <code>${captureId}</code>\n환불액: $${refundedUSD}`);
        }
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: refundOutcome.reason, bookingRef }));
      }

      // 🔴 좌석 해제는 환불 원장이 **커밋된 뒤에만**. duplicate_event / partial / 환경불일치는
      //   위 !applied 게이트에서 이미 return 했으므로 여기 도달하지 않는다(재전송 2회 차감 차단).
      const slotReleased = await releaseSeatsAfterRefundWebhook({
        adminDb,
        eventType,
        refundStatus: event?.resource?.status,
        resultStatus: refundOutcome.status,
        bookingsDocId,
        bookingData,
        bookingRef,
        captureId,
      });

      const telText = [
        '💸 <b>환불 자동 처리 (PayPal Webhook)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>이번 환불:</b> $${refundedUSD} (≈ ₩${refundedKRW.toLocaleString('ko-KR')})`,
        `<b>누적 환불:</b> $${refundOutcome.cumulativeRefundedUSD}`,
        `<b>상태:</b> ${refundOutcome.status}`,
        `<b>Capture:</b> <code>${captureId}</code>`,
      ].join('\n');
      notify('booking', telText).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        status: 'refunded',
        bookingRef,
        bookingStatus: refundOutcome.status,
        cumulativeRefundedUSD: refundOutcome.cumulativeRefundedUSD,
        slotReleased,
      }));
    }

    // ─── PAYMENT.REFUND.FAILED / PAYMENT.REFUND.PENDING ─────────────
    // 🔴 F4 (2026-07-16): 이전엔 이 두 이벤트에 핸들러가 없어 'unsupported' 로 폐기 + 200 ack 로
    //   PayPal 재시도까지 차단됐다. PENDING 환불(eCheck)이 FAILED 로 뒤집혀도 DB 는 CANCELED/REFUNDED
    //   그대로 = 고객은 "환불됨" 메일을 받았는데 돈은 안 감(미환불 은폐). 성공(CAPTURE.REFUNDED)만
    //   처리되고 실패만 버려지는 비대칭이 핵심이었다.
    //   ⚠️ PAYMENT.REFUND.COMPLETED 는 존재하지 않는다 — 완료는 PAYMENT.CAPTURE.REFUNDED 로 온다.
    //   🔑 운영자: PayPal Developer Dashboard → Webhooks 에 두 이벤트 구독을 추가해야 실제로 도착한다.
    if (eventType === 'PAYMENT.REFUND.FAILED' || eventType === 'PAYMENT.REFUND.PENDING') {
      const refundId = event?.resource?.id || null;
      const captureId = extractRefundedCaptureId(event); // refund 이벤트도 links.up 이 capture 를 가리킴
      const isFailed = eventType === 'PAYMENT.REFUND.FAILED';

      // 매칭 1순위 = refundID (cancelBooking·admin 이 저장, 환불 1건당 유일 → 형제 모호성 없음).
      let matched = null;
      if (refundId) {
        const byRefund = await adminDb.collection('bookings').where('refundID', '==', refundId).get();
        if (byRefund.size === 1) matched = byRefund.docs[0];
      }
      // 폴백 = captureID. cart 형제가 공유하므로 F6 과 동일한 모호성 가드.
      if (!matched && captureId) {
        const byCapture = await adminDb.collection('bookings').where('captureID', '==', captureId).get();
        if (byCapture.size > 1) {
          await logWebhookEvent({
            db: adminDb, environment: verifiedEnvironment, eventId, eventType,
            status: 'ambiguous',
            detail: { reason: 'captureID_shared_by_cart_siblings', refundId, captureId, candidates: byCapture.docs.map((d) => d.id) },
          });
          await alertAdmin(`⚠️ <b>환불 ${isFailed ? '실패' : 'PENDING'} webhook — cart 형제 공유로 특정 불가</b>\n\nRefund: <code>${refundId}</code>\nCapture: <code>${captureId}</code>\n→ 수동 확인 필요`);
          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: true, status: 'ambiguous' }));
        }
        if (byCapture.size === 1) matched = byCapture.docs[0];
      }

      if (!matched) {
        await logWebhookEvent({
          db: adminDb, environment: verifiedEnvironment, eventId, eventType,
          status: 'unmatched',
          detail: { reason: 'refund_not_in_bookings', refundId, captureId },
        });
        // FAILED 는 돈 문제 — 매칭 실패도 조용히 버리지 않는다.
        if (isFailed) await alertAdmin(`🚨 <b>환불 실패 webhook — booking 미매칭</b>\n\nRefund: <code>${refundId}</code>\nCapture: <code>${captureId}</code>\n→ PayPal 거래내역에서 수동 대조 필요`);
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'unmatched' }));
      }

      // 🔴 상태를 바꾸기 직전 환경 검사 — PENDING 기록도 FAILED 되돌리기도 상태 변경이다.
      const refundEnvOk = await guardWebhookEnvironment({
        db: adminDb, eventId, eventType, environment: verifiedEnvironment,
        bookingsDocId: matched.id, bookingRef: matched.data().bookingRef || null, captureId,
      });
      if (!refundEnvOk.ok) {
        if (refundEnvOk.status === ENV_GUARD.STORE_UNAVAILABLE) {
          return respondRetryable(res, 'environment_check_unavailable', refundEnvOk.error);
        }
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'environment_mismatch' }));
      }

      // 🔴 2026-07-29: 예약 2벌 + processed 기록을 **하나의 transaction** 으로 묶는다.
      //   이전에는 저장 실패를 catch 로 숨기고 processed 만 남겼다 → 돈이 안 갔는데
      //   예약은 그대로고 PayPal 재전송까지 차단돼 영구히 은폐됐다.
      const failBookingRef = matched.data().bookingRef || matched.id;
      const statusUpdates = isFailed
        // FAILED — 돈이 고객에게 안 갔다. 종단 상태를 되돌려 은폐를 끊고 운영자를 부른다.
        //   자동 재환불은 하지 않는다(운영자가 원인 확인 후 수동 — 재시도 폭주 방지).
        ? {
          status: 'REFUND_FAILED',
          refundStatus: 'FAILED',
          refundFailedAt: FieldValue.serverTimestamp(),
          refundFailedSource: 'webhook',
          updatedAt: FieldValue.serverTimestamp(),
        }
        // PENDING = 관측 기록만. 종단 status 는 건드리지 않는다 (정상 eCheck 흐름일 수 있음 —
        //   완료되면 PAYMENT.CAPTURE.REFUNDED 가 온다).
        : { refundStatus: 'PENDING', updatedAt: FieldValue.serverTimestamp() };

      let statusOutcome;
      try {
        statusOutcome = await applyRefundStatusEvent({
          db: adminDb, FieldValue, eventId, eventType,
          bookingsDocId: matched.id, bookingRef: failBookingRef,
          refundId, captureId, updates: statusUpdates,
          webhookEnvironment: verifiedEnvironment,
        });
      } catch (e) {
        captureError(e, { tag: 'paypal-webhook-refund-status-tx', eventId, captureId });
        return respondRetryable(res, 'refund_status_tx_failed', e.message);
      }

      if (!statusOutcome.applied) {
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: statusOutcome.reason }));
      }

      if (!isFailed) {
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, status: 'refund_pending_recorded' }));
      }

      // processed 기록은 위 transaction 이 이미 원자적으로 남겼다.
      await alertAdmin([
        '🚨 <b>환불 실패 (PayPal Webhook) — 고객에게 돈이 안 갔음</b>',
        '',
        `<b>예약번호:</b> <code>${failBookingRef}</code>`,
        `<b>Refund:</b> <code>${refundId}</code>`,
        `<b>Capture:</b> <code>${captureId}</code>`,
        '→ status=REFUND_FAILED 로 전환됨. PayPal 에서 원인 확인 후 수동 재환불 필요',
      ].join('\n'));

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, status: 'refund_failed', bookingRef: failBookingRef }));
    }

    // ─── 그 외 이벤트 ────────────────────────────────────────────────
    await logWebhookEvent({
      db: adminDb, environment: verifiedEnvironment, eventId, eventType,
      status: 'unsupported',
      detail: { resource_type: event?.resource_type },
    });
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, status: 'unsupported', eventType }));
  } catch (err) {
    console.error('[paypal-webhook] failed:', err.message, err.stack);
    await captureError(err, { route: '/api/paypal-webhook', eventId });
    // 500 응답 → PayPal 재시도. 단, 같은 eventId 면 위 멱등 체크가 차단.
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message || 'internal error' }));
  }
}
