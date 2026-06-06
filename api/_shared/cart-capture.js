/**
 * cart-capture — captureCartOrder 순수 코어 (firebase/paypal 무관 = 단위 테스트 용이).
 *
 * (1) verifyCartCaptureAmount: 캡처된 USD == cart_orders 스냅샷 합계 검증
 *     (capturePaypalOrder L260 은 amount 무검증 → cart 는 변조/불일치 감지 강화).
 * (2) buildCartChildBookings: 스냅샷 lines → 라인별 child booking doc + fan-out payload.
 *     - childOrderID = `${orderID}__${lineId}` (부모 bookings/{orderID} doc 충돌 회피 = batch-fanout 결함#1 방지)
 *     - retryDocId = childOrderID (PR2a retryDocId 활용 — 라인별 독립 retry)
 *     - amountKRW = 스냅샷 값(고정 1400 기준 authoritative). amount(USD)=KRW/rate.
 */

/**
 * @param {string} expectedUsd  cart_orders 스냅샷 usdAmount
 * @param {string|number} capturedUsd  PayPal capture amount.value
 * @returns {{ok:boolean, expected:number, captured:number, diff:number, code?:string}}
 */
export function verifyCartCaptureAmount(expectedUsd, capturedUsd) {
  const exp = parseFloat(expectedUsd || '0');
  const got = parseFloat(String(capturedUsd == null ? '' : capturedUsd) || '0');
  if (!(exp > 0)) return { ok: false, expected: exp, captured: got, diff: 0, code: 'NO_EXPECTED' };
  const diff = Math.abs(exp - got);
  // 센트 미만 = 일치 (round 오차 허용). 그 이상 = 불일치(변조/snapshot stale 의심).
  return { ok: diff < 0.01, expected: exp, captured: got, diff };
}

/**
 * 스냅샷 lines → 라인별 child booking doc + booking-processor fan-out payload.
 * @param {string} orderID  cart 부모 orderID
 * @param {object} snapshot  cart_orders 문서 {usdRate, lines:[{lineId, productType, amountKRW, booking}]}
 * @param {object} base  {payerEmail, payerName, userEmail, captureID}
 * @returns {Array<{lineId, childOrderID, retryDocId, amountKRW, bookingDoc, processorPayload}>}
 */
export function buildCartChildBookings(orderID, snapshot, base = {}) {
  if (!orderID || !snapshot || !Array.isArray(snapshot.lines)) return [];
  const rate = (snapshot.usdRate && snapshot.usdRate > 0) ? snapshot.usdRate : 1400;
  return snapshot.lines.map((line, i) => {
    const lineId = line.lineId || `L${i}`;
    const childOrderID = `${orderID}__${lineId}`;
    const b = line.booking || {};
    const amountKRW = Number(line.amountKRW) || 0;
    const amountUSD = (amountKRW / rate).toFixed(2);

    // booking-processor 로 보낼 payload (capturePaypalOrder processorPayload 와 동형).
    const processorPayload = {
      orderID: childOrderID,
      payerEmail: base.payerEmail || '',
      payerName: base.payerName || '',
      amount: amountUSD,
      product: line.productType,
      tourDate: b.dateStart || '',
      paxCount: b.passengers || 1,
      pickupLocation: b.pickupLocation || '',
      vehicleType: b.vehicleType || '',
      memo: b.memo || '',
      userEmail: base.userEmail || '',
      bookingRef: childOrderID,
    };

    // bookings/{childOrderID} child doc (capturePaypalOrder bookingDocPayload 와 동형 +
    // parent/line 식별). amountKRW = 스냅샷(고정 1400) authoritative — 라인별 환불(결정#5) 기준.
    const bookingDoc = {
      bookingRef: childOrderID,
      orderID: childOrderID,
      parentOrderID: orderID,
      lineId,
      captureID: base.captureID || '',
      status: 'CONFIRMED',
      productType: line.productType,
      amountUSD,
      amountKRW,
      capturedExchangeRate: rate,
      currency: 'USD',
      tourDate: b.dateStart || '',
      paxCount: b.passengers || 1,
      pickupLocation: b.pickupLocation || '',
      vehicleType: b.vehicleType || '',
      memo: b.memo || '',
    };

    return { lineId, childOrderID, retryDocId: childOrderID, amountKRW, bookingDoc, processorPayload };
  });
}
