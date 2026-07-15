/**
 * PayPal capture refund helper.
 *
 * Shared between user-initiated cancelBooking and admin-initiated
 * mark-refunded (PR #425, Audit CY5). Pre-PR-#425 the admin path skipped
 * the PayPal API entirely — it set Firestore status='REFUNDED' and sent
 * the customer an email saying "refunded", but the money stayed in the
 * merchant account. Customers chased their money for days.
 *
 * Caller passes a captureID + optional `refundUSD` (defaults to full
 * capture refund). Returns the PayPal refund payload on success, or
 * `{ ok: false, code, error, status }` on failure so the caller can
 * keep a meaningful HTTP status / log line.
 *
 * ## 🔴 멱등성 (2026-07-15, P1)
 *
 * 이전엔 `PayPal-Request-Id` 가 없어 **재시도가 이중환불**이었다. 가상의 위험이 아니다:
 *   1. 이 함수엔 타임아웃이 없었다 → PayPal 이 환불을 처리했는데 우리만 네트워크 에러로 보는 창.
 *   2. cancelBooking 은 환불 실패 시 예약을 CONFIRMED 로 되돌려 **사용자 재시도를 허용**한다.
 *   3. admin mark-refunded 는 PayPal 실패 시 Firestore 를 안 건드려 status 가 CONFIRMED 로 남는다
 *      → 운영자 재클릭.
 * → 1번 창에서 2·3번 재시도가 일어나면 고객에게 두 번 환불된다(직접 자금 손실).
 *
 * 이제 `idempotencyKey` 가 **필수**다. 같은 키로 재시도하면 PayPal 이 최초 환불을 그대로 돌려준다.
 *
 * ### 키를 무엇으로 잡을 것인가 — captureID 는 답이 아니다
 * cart 결제는 자식 예약 N개가 **하나의 captureID 를 공유**한다(_shared/cart-capture.js 의
 * `captureID: base.captureID`). 각 자식은 `${orderID}__${lineId}` 로 **자기 문서·자기 status** 를
 * 가지므로, 사용자가 라인 A 와 라인 B 를 따로 취소하면 **같은 capture 에 서로 다른 금액의 정당한
 * 환불 2회**가 발생한다. captureID 를 키로 쓰면 두 번째가 첫 번째 응답으로 캐시 반환돼
 * **돈은 안 나갔는데 refundID 가 기록되고 status='CANCELED' 로 확정된다 = 미환불 은폐.**
 * → 키는 **논리적 환불 1건**을 식별해야 한다(예약 문서 id 기준). 호출자가 정한다.
 *
 * ⚠️ PayPal 은 `PayPal-Request-Id` 보존 기간을 공식 문서화하지 않는다. 이 키는 **짧은 창의
 *    재시도**를 막는 장치이지 영구 중복 방지가 아니다. 영구 방어는 호출자의 status 가드
 *    (cancelBooking 의 CONFIRMED→CANCELING CAS, admin 의 status!=='CONFIRMED' 차단)가 담당한다.
 * ⚠️ 키는 **API 호출 종류별로 고유**해야 한다(PayPal 명시) — capture 에 쓴 키를 refund 에 재사용
 *    하면 안 된다. 그래서 이 함수가 `refund:` prefix 를 강제로 붙인다. 호출자는 붙이지 말 것.
 */
import { getPaypalAccessToken } from './paypal.js';

/**
 * PayPal 이 환불을 처리했는데 우리가 응답을 못 받는 창을 유한하게 만든다.
 * 이 창이 바로 멱등키가 필요한 이유다 — 타임아웃 후 재시도해도 같은 키면 이중환불이 아니다.
 */
const REFUND_TIMEOUT_MS = 20_000;

/**
 * @param {object} args
 * @param {string} args.captureID — PayPal v2 capture id (booking.captureID).
 * @param {string} args.idempotencyKey — **필수**. 논리적 환불 1건을 식별하는 안정 문자열.
 *   재시도 시 반드시 같은 값이어야 한다(그래야 멱등). 예약 문서 id 등 서버가 아는 안정값을 쓸 것.
 *   captureID 단독 금지(위 주석 참조). `refund:` prefix 는 이 함수가 붙인다.
 * @param {string} [args.refundUSD] — numeric string. Omit for full refund.
 * @param {string} [args.currency='USD'] — capture 통화. booking.currency 가 있으면 넘길 것.
 * @param {string} [args.note] — PayPal note_to_payer (shown on PayPal receipt).
 * @param {boolean} [args.isSandbox=false]
 * @returns {Promise<{ok: true, refund: object} | {ok: false, code: string, error: string, status: number}>}
 */
export async function refundPaypalCapture({ captureID, idempotencyKey, refundUSD, currency, note, isSandbox = false }) {
  if (!captureID) {
    return { ok: false, code: 'NO_CAPTURE_ID', error: 'captureID required', status: 400 };
  }
  // fail-closed — 키 없이 환불을 쏘면 재시도가 이중환불이 된다. 조용히 넘어가지 않는다.
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return { ok: false, code: 'NO_IDEMPOTENCY_KEY', error: 'idempotencyKey required (double-refund guard)', status: 500 };
  }
  let token;
  let baseUrl;
  try {
    ({ accessToken: token, baseUrl } = await getPaypalAccessToken(isSandbox));
  } catch (e) {
    return { ok: false, code: 'PAYPAL_AUTH_FAILED', error: e.message, status: 502 };
  }

  // 통화는 capture 통화를 따라야 한다. 이전엔 'USD' 하드코딩이었다 — 시스템이 사실상 USD 단일이라
  // 지금은 무해하지만, 다통화가 생기면 조용히 틀린 통화로 환불된다. 호출자가 모르면 USD 폴백.
  // (nullish 금지 규약 — OR 사용. currency 는 빈 문자열도 무효값이라 OR 이 의미상 맞다.)
  const refundCurrency = currency || 'USD';

  const body = refundUSD
    ? {
        amount: { value: String(refundUSD), currency_code: refundCurrency },
        note_to_payer: note || `CocoTrip partial refund: $${refundUSD}`,
      }
    : {
        note_to_payer: note || 'CocoTrip full refund',
      };

  let refundData;
  try {
    const res = await fetch(`${baseUrl}/v2/payments/captures/${captureID}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // 🔴 이중환불 방어. 같은 키 재시도 = PayPal 이 최초 환불을 그대로 반환.
        'PayPal-Request-Id': `refund:${idempotencyKey}`,
      },
      body: JSON.stringify(body),
      // 무한 대기 금지 — 서버리스가 먼저 죽으면 우리는 결과를 영영 모르고 사용자는 재시도한다.
      signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
    });
    refundData = await res.json().catch(() => ({}));
    if (refundData.status === 'COMPLETED' || refundData.status === 'PENDING') {
      return { ok: true, refund: refundData };
    }
    // 이전엔 HTTP status 를 아예 보지 않고 body 의 status 필드만 봤다. 4xx/5xx 로 body 가 비어도
    // 'unknown' 만 남아 진단이 불가능했다 → HTTP status 를 에러에 포함한다(동작은 동일: ok:false).
    return {
      ok: false,
      code: 'PAYPAL_REFUND_FAILED',
      error: `PayPal refund ${refundData.status || `HTTP ${res.status}`}: ${refundData.message || refundData.name || ''}`,
      status: 502,
    };
  } catch (e) {
    // TimeoutError 포함. ⚠️ 이 분기는 "환불 안 됨" 을 뜻하지 않는다 — PayPal 이 처리했을 수 있다.
    //   호출자가 재시도할 때 **같은 idempotencyKey** 를 쓰면 이중환불이 되지 않는다.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      ok: false,
      code: timedOut ? 'PAYPAL_REFUND_TIMEOUT' : 'PAYPAL_NETWORK_ERROR',
      error: timedOut ? `PayPal refund timed out after ${REFUND_TIMEOUT_MS}ms (outcome unknown — retry with same key)` : e.message,
      status: 502,
    };
  }
}

export default refundPaypalCapture;
