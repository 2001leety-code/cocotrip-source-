import { toMinorUnits } from './paypal-capture-verify.js';

/**
 * 새 주문은 저장한 라인 USD를 사용한다. 이전 주문은 확정된 부모 USD를 원화 비율로
 * 센트 단위 배분하여 합계를 보존한다. 현재 환율로 이전 결제를 다시 계산하지 않는다.
 */
export function cartLineUsdAmounts(snapshot) {
  const lines = snapshot && snapshot.lines;
  const totalMinor = toMinorUnits(snapshot && snapshot.usdAmount, 'USD');
  if (!Array.isArray(lines) || lines.length === 0 || totalMinor === null) throw new Error('INVALID_CART_AMOUNTS');
  if (lines.some(line => line.amountUSD != null)) {
    const cents = lines.map(line => toMinorUnits(line.amountUSD, 'USD'));
    if (cents.some(value => value === null) || cents.reduce((sum, value) => sum + value, 0) !== totalMinor) {
      throw new Error('INVALID_CART_AMOUNTS');
    }
    return cents.map(value => (value / 100).toFixed(2));
  }
  const weights = lines.map(line => Number(line.amountKRW));
  if (weights.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('INVALID_CART_AMOUNTS');
  const totalWeight = weights.reduce((sum, value) => sum + BigInt(value), 0n);
  const shares = weights.map((value, index) => {
    const product = BigInt(totalMinor) * BigInt(value);
    return { index, cents: Number(product / totalWeight), remainder: product % totalWeight };
  });
  const remainder = totalMinor - shares.reduce((sum, share) => sum + share.cents, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remainder; index++) ranked[index].cents += 1;
  return shares.map(share => (share.cents / 100).toFixed(2));
}

/**
 * cart-capture — captureCartOrder 순수 코어 (firebase/paypal 무관 = 단위 테스트 용이).
 *
 * buildCartChildBookings: 스냅샷 lines → 라인별 child booking doc + fan-out payload.
 *   - childOrderID = `${orderID}__${lineId}` (부모 bookings/{orderID} doc 충돌 회피 = batch-fanout 결함#1 방지)
 *   - retryDocId = childOrderID (PR2a retryDocId 활용 — 라인별 독립 retry)
 *   - amountKRW = 주문 스냅샷 값. amountUSD = 저장된 라인 금액 또는 기존 부모 금액의 센트 배분.
 *
 * ⚠️ 캡처 금액 검증은 여기 있던 verifyCartCaptureAmount(parseFloat 비교 + currency 미검증)에서
 *    `_shared/paypal-capture-verify.js` 로 이전됐다 — 부동소수점 대신 통화 최소단위 정수 비교 +
 *    currency + 개별 capture status + cardinality 를 단건/cart 공통으로 검증한다.
 *    약한 float 비교로 되돌리지 말 것.
 */

/**
 * 스냅샷 lines → 라인별 child booking doc + booking-processor fan-out payload.
 * @param {string} orderID  cart 부모 orderID
 * @param {object} snapshot  cart_orders 문서 {usdRate, lines:[{lineId, productType, amountKRW, booking}]}
 * @param {object} base  {payerEmail, payerName, userEmail, captureID}
 * @returns {Array<{lineId, childOrderID, retryDocId, amountKRW, bookingDoc, processorPayload}>}
 */
export function buildCartChildBookings(orderID, snapshot, base = {}) {
  if (!orderID || !snapshot || !Array.isArray(snapshot.lines)) return [];
  const rate = (snapshot.usdRate && snapshot.usdRate > 0) ? snapshot.usdRate : 1350;
  const amountsUSD = cartLineUsdAmounts(snapshot);
  return snapshot.lines.map((line, i) => {
    const lineId = line.lineId || `L${i}`;
    const childOrderID = `${orderID}__${lineId}`;
    const b = line.booking || {};
    const amountKRW = Number(line.amountKRW) || 0;
    const amountUSD = amountsUSD[i];

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
    // parent/line 식별). amountKRW = 주문 스냅샷 값 — 현재 환율로 재계산하지 않는다.
    // ⚠️🔴 userEmail 을 여기 추가하지 말 것 (2026-07-16, F7/F8). 이 doc 에 userEmail 이 없어서
    //   cancelBooking 의 소유자 가드가 cart 자식의 개별 취소를 막고 있다. userEmail 한 줄을 추가하면
    //   그 가드가 풀리고 → refundRatio=1.0 → refundUSD=null → **capture 전액환불**(카트 전체)이 무장된다.
    //   cancelBooking 에 parentOrderID 명시 거부 가드를 넣어 이중 방어했지만(그 가드가 진짜 방어벽),
    //   cart 라인별 환불이 필요하면 capture 단위 환불 원장부터 설계할 것 — userEmail 추가가 먼저가 아니다.
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
