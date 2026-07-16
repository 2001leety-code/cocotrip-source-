/**
 * cart-capture 단위 테스트 — captureCartOrder 순수 코어 (PR2d, money-critical).
 * (1) 라인 child booking/fan-out 빌더 (2) 핸들러 머니 안전 가드(source).
 *
 * ⚠️ 캡처 금액 검증은 구 verifyCartCaptureAmount(float 비교, currency 미검증)에서
 *    _shared/paypal-capture-verify.js(정수 minor + currency + status + cardinality)로 이전됨.
 *    검증기 자체 테스트 = tests/unit/paypal-capture-verify.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCartChildBookings } from '../../api/_shared/cart-capture.js';

const captureSrc = readFileSync(resolve(process.cwd(), 'api/captureCartOrder.js'), 'utf8');

describe('buildCartChildBookings — 라인 child + fan-out', () => {
  const snapshot = {
    usdRate: 1400, totalKRW: 280000, usdAmount: '200.00',
    lines: [
      { lineId: 'L0', productType: 'charter_seoul_city', amountKRW: 140000, booking: { productType: 'charter_seoul_city', passengers: 2, dateStart: '2026-07-01', pickupLocation: '명동', vehicleType: 'staria', memo: 'x' } },
      { lineId: 'L1', productType: 'charter_busan', amountKRW: 140000, booking: { productType: 'charter_busan', passengers: 3, dateStart: '2026-07-03' } },
    ],
  };
  it('childOrderID = orderID__lineId (부모 doc 충돌 회피 = batch-fanout 결함#1)', () => {
    const out = buildCartChildBookings('ORD9', snapshot, {});
    expect(out.map(c => c.childOrderID)).toEqual(['ORD9__L0', 'ORD9__L1']);
    expect(out.map(c => c.retryDocId)).toEqual(['ORD9__L0', 'ORD9__L1']);
  });
  it('amountKRW = 스냅샷 authoritative (고정 1400 기준)', () => {
    const out = buildCartChildBookings('ORD9', snapshot, {});
    expect(out[0].amountKRW).toBe(140000);
    expect(out[0].bookingDoc.amountKRW).toBe(140000);
    expect(out[0].bookingDoc.amountUSD).toBe('100.00');
    expect(out[0].processorPayload.amount).toBe('100.00');
  });
  it('payload/bookingDoc = 부모·라인 식별 + fulfillment', () => {
    const out = buildCartChildBookings('ORD9', snapshot, { payerEmail: 'a@b.c', captureID: 'CAP1' });
    expect(out[0].processorPayload.orderID).toBe('ORD9__L0');
    expect(out[0].processorPayload.bookingRef).toBe('ORD9__L0');
    expect(out[0].processorPayload.tourDate).toBe('2026-07-01');
    expect(out[0].processorPayload.paxCount).toBe(2);
    expect(out[0].bookingDoc.parentOrderID).toBe('ORD9');
    expect(out[0].bookingDoc.captureID).toBe('CAP1');
    expect(out[0].bookingDoc.pickupLocation).toBe('명동');
  });
  it('빈/무효 입력 = []', () => {
    expect(buildCartChildBookings('', snapshot, {})).toEqual([]);
    expect(buildCartChildBookings('ORD9', null, {})).toEqual([]);
    expect(buildCartChildBookings('ORD9', { lines: 'x' }, {})).toEqual([]);
  });
});

describe('captureCartOrder 핸들러 — 머니 안전 가드 (source)', () => {
  it('FEATURE_CART flag-gated', () => {
    expect(captureSrc).toMatch(/featureEnabled\(process\.env\.FEATURE_CART\)/);
  });
  it('v1 쿠폰 거부 (global-promo cap PR#434 이슈 회피)', () => {
    expect(captureSrc).toMatch(/CART_PROMO_UNSUPPORTED/);
    expect(captureSrc).toMatch(/body\.promoCode\s*\|\|\s*body\.couponDocId/);
  });
  it('used_paypal_orders 트랜잭션 락 (이중청구 차단)', () => {
    expect(captureSrc).toMatch(/used_paypal_orders/);
    expect(captureSrc).toMatch(/DUPLICATE_ORDER/);
    expect(captureSrc).toMatch(/runTransaction/);
  });
  it('capture 무결성 검증 — 스냅샷 기준 amount(정수 minor) + currency + status', () => {
    expect(captureSrc).toMatch(/toMinorUnits\(snapshot\.usdAmount/);
    expect(captureSrc).toMatch(/verifyCaptureIntegrity\(/);
    expect(captureSrc).toMatch(/expectedCurrency:\s*'USD'/);
  });
  it('불일치 = 예약 미확정 + durable 격리 + 202 (구: alert 후 CONFIRMED 강행)', () => {
    expect(captureSrc).toMatch(/if\s*\(!verdict\.ok\)/);
    expect(captureSrc).toMatch(/recordPaymentReview/);
    expect(captureSrc).toMatch(/buildPaymentReviewResponse/);
    expect(captureSrc).toMatch(/writeHead\(202/);
    // 불일치 분기는 batch(CONFIRMED)/fan-out 호출부 이전에 return 해야 함.
    // (import 줄이 아니라 실제 호출부 기준 — indexOf('triggerBookingProcessor') 는 import 에 먼저 걸림.)
    const mismatchIdx = captureSrc.indexOf('if (!verdict.ok)');
    const confirmIdx = captureSrc.indexOf("status: 'CONFIRMED'");
    const fanoutCallIdx = captureSrc.indexOf('triggerBookingProcessor({');
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(fanoutCallIdx).toBeGreaterThan(-1);
    expect(mismatchIdx).toBeLessThan(confirmIdx);
    expect(mismatchIdx).toBeLessThan(fanoutCallIdx);
    // 불일치 분기 안에서 먼저 응답을 끝내고 빠져나감.
    expect(captureSrc.slice(mismatchIdx, confirmIdx)).toMatch(/return res\.end/);
  });
  it('구 float 비교(verifyCartCaptureAmount) 미사용 — 정수 minor 로 대체', () => {
    expect(captureSrc).not.toMatch(/verifyCartCaptureAmount/);
  });
  it('라인별 fan-out (retryDocId=childOrderID, PR2a 활용)', () => {
    expect(captureSrc).toMatch(/triggerBookingProcessor/);
    expect(captureSrc).toMatch(/retryDocId:\s*child\.retryDocId/);
  });
  it('자동환불 없음 (capture 후 롤백 금지 + promo 거부=환불경로 없음)', () => {
    expect(captureSrc).not.toMatch(/refundPaypalCapture/);
  });
});
