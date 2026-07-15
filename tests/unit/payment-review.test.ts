/**
 * payment-review — capture 불일치의 durable 격리 (money-critical).
 *
 * 왜: 불일치는 **돈이 캡처된 뒤** 발견된다.
 *   - 일반 실패(재시도 가능)로 버리면 사용자가 재결제 → 이중청구.
 *   - CONFIRMED 로 확정하면 결제와 다른 예약이 확정.
 *   → 결제 기록은 남기고 예약은 확정 안 하는 격리 상태 + retryable:false 응답.
 *
 * Telegram 은 알림일 뿐 SSOT 가 아니다 → Firestore payment_reviews 가 SSOT.
 * 두 capture 핸들러(단건/cart)가 실제로 이 격리를 쓰는지도 source 로 가드.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — ESM .js (backend SSOT)
import {
  buildPaymentReviewDoc, buildPaymentReviewResponse, summarizeCapture, recordPaymentReview, PAYMENT_REVIEW_STATUS,
} from '../../api/_shared/payment-review.js';

const singleSrc = readFileSync(resolve(process.cwd(), 'api/capturePaypalOrder.js'), 'utf8');
const cartSrc = readFileSync(resolve(process.cwd(), 'api/captureCartOrder.js'), 'utf8');

const CAPTURE = {
  status: 'COMPLETED',
  purchase_units: [{
    payments: { captures: [{ id: 'CAP-9', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' }, create_time: 'T' }] },
  }],
};
const VERDICT = { ok: false, code: 'AMOUNT_MISMATCH', detail: 'expected=9900 actual=5000', captureID: 'CAP-9', amountMinor: 5000, currency: 'USD' };

describe('summarizeCapture — 비민감 요약만', () => {
  it('금액/상태/cardinality 요약', () => {
    const s = summarizeCapture(CAPTURE);
    expect(s).toMatchObject({ orderStatus: 'COMPLETED', captureStatus: 'COMPLETED', captureID: 'CAP-9', purchaseUnitCount: 1, captureCount: 1 });
  });
  it('빈 응답도 throw 없이 요약', () => {
    expect(() => summarizeCapture(null)).not.toThrow();
    expect(summarizeCapture(null).captureID).toBe('');
  });
});

describe('buildPaymentReviewDoc — 격리 기록', () => {
  const doc = buildPaymentReviewDoc({
    flow: 'single', orderID: 'ORD1', verdict: VERDICT, capture: CAPTURE,
    expectedAmountMinor: 9900, expectedCurrency: 'USD', userEmail: 'A@B.com', payerEmail: 'p@q.com',
  });

  it('PAYMENT_REVIEW 상태 + 불일치 사유 보존', () => {
    expect(doc.status).toBe(PAYMENT_REVIEW_STATUS);
    expect(doc.mismatchCode).toBe('AMOUNT_MISMATCH');
    expect(doc.mismatchDetail).toContain('expected=9900');
  });

  it('기대 vs 실제를 최소단위 정수로 보존 (부동소수점 금지)', () => {
    expect(doc.expectedAmountMinor).toBe(9900);
    expect(doc.actualAmountMinor).toBe(5000);
    expect(doc.expectedCurrency).toBe('USD');
  });

  it('돈이 이미 나갔다는 사실 명시 (paymentCaptured + captureID)', () => {
    expect(doc.paymentCaptured).toBe(true);
    expect(doc.captureID).toBe('CAP-9');
  });

  it('운영자 해결 추적 필드는 미해결(null)로 시작', () => {
    expect(doc.resolvedAt).toBe(null);
    expect(doc.resolvedBy).toBe(null);
    expect(doc.resolution).toBe(null);
  });

  it('userEmail 소문자 정규화', () => {
    expect(doc.userEmail).toBe('a@b.com');
  });
});

function makeDb(exists = false) {
  const set = vi.fn(async () => {});
  const get = vi.fn(async () => ({ exists }));
  const doc = vi.fn(() => ({ set, get }));
  const collection = vi.fn(() => ({ doc }));
  return { db: { collection }, set, get, doc, collection };
}

describe('recordPaymentReview — Firestore 쓰기', () => {
  it('payment_reviews/{orderID} 에 기록', async () => {
    const m = makeDb(false);
    await recordPaymentReview({
      db: m.db, serverTimestamp: 'TS',
      flow: 'cart', orderID: 'ORD2', verdict: VERDICT, capture: CAPTURE,
      expectedAmountMinor: 9900, expectedCurrency: 'USD',
    });
    expect(m.collection).toHaveBeenCalledWith('payment_reviews');
    expect(m.doc).toHaveBeenCalledWith('ORD2');
    expect(m.set.mock.calls[0][0]).toMatchObject({ status: PAYMENT_REVIEW_STATUS, orderID: 'ORD2', flow: 'cart' });
  });

  it('신규 기록은 해결 필드를 미해결(null)로 초기화', async () => {
    const m = makeDb(false);
    await recordPaymentReview({ db: m.db, serverTimestamp: 'TS', flow: 'single', orderID: 'ORD2b', verdict: VERDICT, capture: CAPTURE });
    expect(m.set.mock.calls[0][0]).toMatchObject({ resolvedAt: null, resolution: null });
  });

  it('이미 존재하는 건 재기록 시 해결 필드를 덮어쓰지 않음 (해결된 건이 미해결로 되돌아가면 안 됨)', async () => {
    const m = makeDb(true);
    await recordPaymentReview({ db: m.db, serverTimestamp: 'TS', flow: 'single', orderID: 'ORD2c', verdict: VERDICT, capture: CAPTURE });
    const written = m.set.mock.calls[0][0];
    expect(written).not.toHaveProperty('resolvedAt');
    expect(written).not.toHaveProperty('resolution');
    expect(written).not.toHaveProperty('createdAt');
  });

  it('운영자 해결에 필요한 쿠폰/예약 정보를 함께 보존', async () => {
    const m = makeDb(false);
    await recordPaymentReview({
      db: m.db, serverTimestamp: 'TS', flow: 'single', orderID: 'ORD2d', verdict: VERDICT, capture: CAPTURE,
      coupon: { couponDocId: 'C1', couponUserId: 'U1', promoCode: null },
      bookingPayload: { productType: 'tour', paxCount: 2 },
    });
    expect(m.set.mock.calls[0][0]).toMatchObject({
      coupon: { couponDocId: 'C1', couponUserId: 'U1' },
      bookingPayload: { productType: 'tour', paxCount: 2 },
    });
  });

  it('쓰기 실패는 조용히 삼키지 않고 throw (캡처된 돈의 유일한 SSOT)', async () => {
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => { throw new Error('firestore down'); } }) }) };
    await expect(recordPaymentReview({
      db, serverTimestamp: 'TS', flow: 'single', orderID: 'ORD3', verdict: VERDICT, capture: CAPTURE,
    })).rejects.toThrow('firestore down');
  });
});

describe('buildPaymentReviewResponse — 재시도 금지 응답', () => {
  const r = buildPaymentReviewResponse({ orderID: 'ORD1', captureID: 'CAP-9', capture: CAPTURE });

  it('retryable:false — 재결제 시 이중청구라 절대 재시도 유도 금지', () => {
    expect(r.retryable).toBe(false);
  });

  it('실제 캡처된 경우: finalized:false + paymentCaptured:true (결제됨, 예약 미확정)', () => {
    expect(r.finalized).toBe(false);
    expect(r.paymentCaptured).toBe(true);
    expect(r.paymentStatus).toBe('CAPTURED');
    expect(r.bookingStatus).toBe(PAYMENT_REVIEW_STATUS);
  });

  // 🔴 돈이 안 움직인 verdict(DECLINED/capture node 없음)에 "결제 접수됨" 이라 하면
  //   사용자는 결제됐다고 믿는데 실제론 안 됐고, lock 때문에 재시도도 409 → 매출 손실.
  it('캡처 안 된 경우: paymentCaptured:false 로 정직하게 (거짓 "결제됨" 금지)', () => {
    const declined = {
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-X', status: 'DECLINED', amount: { value: '99.00', currency_code: 'USD' } }] } }],
    };
    const d = buildPaymentReviewResponse({ orderID: 'ORD1', captureID: 'CAP-X', capture: declined });
    expect(d.paymentCaptured).toBe(false);
    expect(d.paymentStatus).toBe('NOT_CAPTURED');
    expect(d.retryable).toBe(false); // 그래도 재시도 유도는 금지 (lock 이 이미 잡힘)
    expect(d.message).not.toMatch(/received/i);
  });

  it('capture 응답 자체가 없어도 paymentCaptured:false', () => {
    expect(buildPaymentReviewResponse({ orderID: 'ORD1' }).paymentCaptured).toBe(false);
  });
});

describe('capture 핸들러 — 불일치 시 후속처리 차단 (source 가드)', () => {
  it('단건: 검증 + 격리 + 202', () => {
    expect(singleSrc).toMatch(/verifyCaptureIntegrity\(/);
    expect(singleSrc).toMatch(/recordPaymentReview/);
    expect(singleSrc).toMatch(/writeHead\(202/);
  });

  it('단건: 스냅샷 expectedUSD 를 실제로 읽어 검증에 사용', () => {
    expect(singleSrc).toMatch(/_snapExpectedUSD\s*=\s*_s\.expectedUSD/);
    expect(singleSrc).toMatch(/toMinorUnits\(_snapExpectedUSD/);
  });

  it('단건: 불일치 분기가 booking 기록/슬롯/processor 이전에 return', () => {
    const mismatchIdx = singleSrc.indexOf('if (_verdict && !_verdict.ok)');
    const bookingIdx = singleSrc.indexOf('bookingDocPayload');
    const slotIdx = singleSrc.indexOf('confirmSlotLock({');
    const fanoutIdx = singleSrc.indexOf('triggerBookingProcessor({');
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(mismatchIdx).toBeLessThan(bookingIdx);
    expect(mismatchIdx).toBeLessThan(slotIdx);
    expect(mismatchIdx).toBeLessThan(fanoutIdx);
    expect(singleSrc.slice(mismatchIdx, bookingIdx)).toMatch(/return res\.end/);
  });

  it('단건: 스냅샷 없는 레거시 주문은 기본적으로 진행(배포 시 in-flight 주문 보호) + 플래그로 격리 승격', () => {
    expect(singleSrc).toMatch(/PAYMENT_STRICT_PROVENANCE/);
    expect(singleSrc).toMatch(/_strictProvenance/);
  });

  it('cart: 검증 + 격리 + 202', () => {
    expect(cartSrc).toMatch(/verifyCaptureIntegrity\(/);
    expect(cartSrc).toMatch(/recordPaymentReview/);
    expect(cartSrc).toMatch(/writeHead\(202/);
  });

  it('프론트: PAYMENT_REVIEW 를 성공으로 처리하지 않음 (허위 전환·확정 오인 방지)', () => {
    const btn = readFileSync(resolve(process.cwd(), 'src/components/PayPalBookingButton.tsx'), 'utf8');
    const cart = readFileSync(resolve(process.cwd(), 'src/components/CartCheckout.tsx'), 'utf8');
    // 두 소비부 모두 finalized/bookingStatus 를 ok 보다 **먼저** 확인해야 한다.
    for (const [name, src] of [['PayPalBookingButton', btn], ['CartCheckout', cart]] as const) {
      const reviewIdx = src.indexOf('PAYMENT_REVIEW');
      const okIdx = src.indexOf('json.ok');
      expect(reviewIdx, `${name}: PAYMENT_REVIEW 분기 없음`).toBeGreaterThan(-1);
      expect(okIdx, `${name}: json.ok 판정 없음`).toBeGreaterThan(-1);
      expect(reviewIdx, `${name}: review 분기가 json.ok 판정보다 앞서야 함`).toBeLessThan(okIdx);
      expect(src).toMatch(/finalized === false/);
    }
    // 단건: review 분기에서 전환(GA4/posthog)이 발화하면 안 됨 → 분기 안에서 early return.
    const rIdx = btn.indexOf('json.finalized === false');
    const okIdx = btn.indexOf('const isSuccess = json.ok === true');
    expect(btn.slice(rIdx, okIdx)).toMatch(/return;/);
    expect(btn.slice(rIdx, okIdx)).not.toMatch(/trackPaidConversion|posthogTrack/);
  });

  // 🔴 회귀 가드 — PENDING(리스크홀드/eCheck)을 격리하면 booking doc 이 안 생기고
  //   홀드 해제 webhook 이 예약을 못 찾아 "돈은 정산되고 예약은 영영 없음" 이 된다.
  it('양 경로: capture PENDING 은 격리하지 않고 예약을 진행', () => {
    for (const [name, src] of [['single', singleSrc], ['cart', cartSrc]] as const) {
      expect(src, `${name}: pending 분기 없음`).toMatch(/\.pending\b/);
      // pending 분기가 격리 분기보다 먼저 판정돼야 한다.
      // (import 줄이 아니라 실제 호출부 기준 — indexOf('recordPaymentReview') 는 import 에 먼저 걸림.)
      const pendIdx = src.indexOf('.pending');
      const quarantineIdx = src.indexOf('recordPaymentReview({');
      expect(pendIdx).toBeGreaterThan(-1);
      expect(quarantineIdx).toBeGreaterThan(-1);
      expect(pendIdx, `${name}: pending 을 격리보다 먼저 판정해야 함`).toBeLessThan(quarantineIdx);
    }
    // 단건은 정산 대기 사실을 booking 에 남긴다.
    expect(singleSrc).toMatch(/paymentPending/);
  });

  // 🔴 회귀 가드 — 서버리스는 res.end() 후 정지 가능. 알림이 fire-and-forget 이면
  //   review 기록까지 실패한 최악의 경우 돈만 나가고 기록·신호가 0 이 된다.
  it('양 경로: 불일치 알림을 await 하고, throttle key 는 주문별 (상수 key = 타 주문 억제)', () => {
    for (const [name, src] of [['single', singleSrc], ['cart', cartSrc]] as const) {
      expect(src, `${name}: 알림 await 안 함`).toMatch(/await throttledTelegramAlert\(/);
      expect(src, `${name}: throttle key 가 주문별이 아님`).toMatch(/key: `[a-z-]*capture-mismatch-\$\{orderID\}`/);
    }
  });

  it('프론트: 재결제 만류 문구가 4개 언어 모두 존재 (이중청구 방지)', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh']) {
      const j = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8'));
      expect(j.cart?.checkoutReview, `${lang}.cart.checkoutReview 누락`).toBeTruthy();
      expect(j.cart?.checkoutReviewWarn, `${lang}.cart.checkoutReviewWarn 누락`).toBeTruthy();
    }
  });

  it('양 경로 모두 자동환불 하지 않음 (운영자 판단)', () => {
    expect(cartSrc).not.toMatch(/refundPaypalCapture/);
    // 단건의 refundPaypalCapture 는 promo-cap race 전용 경로 — 불일치 격리 분기에는 없어야 함.
    const mismatchIdx = singleSrc.indexOf('if (_verdict && !_verdict.ok)');
    const bookingIdx = singleSrc.indexOf('bookingDocPayload');
    expect(singleSrc.slice(mismatchIdx, bookingIdx)).not.toMatch(/refundPaypalCapture/);
  });
});
