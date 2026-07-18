/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore mockDb 스캐폴딩. */
/**
 * coupon-charge — 결제 시점 개인 쿠폰 검증 (FEATURE_DISCOUNT_V2, 운영자 2026-06-07).
 * createPaypalOrder 가 v2 에서 WELCOME 쿠폰을 실제 청구가에 적용하기 위한 서버측 검증.
 * 어떤 실패든 { valid:false } (= 정가, 절대 과할인 금지) 가 핵심 안전 속성.
 */
import { describe, it, expect } from 'vitest';
import { couponMatchesProduct, verifyCouponForCharge } from '../../api/_shared/coupon-charge.js';

// mock Firestore: users/{uid}/coupons/{docId}.get() -> { exists, data() }
function mockDb(couponData: any): any {
  const get = async () => (couponData === null
    ? { exists: false, data: () => null }
    : { exists: true, data: () => couponData });
  return { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get }) }) }) }) };
}

describe('couponMatchesProduct — scope (applyPromoCode mirror)', () => {
  it('charter scope → charter/airport/combo/kpop 허용, tour 거부', () => {
    expect(couponMatchesProduct('charter', 'charter_busan')).toBe(true);
    expect(couponMatchesProduct('charter', 'airport_seoul_central')).toBe(true);
    expect(couponMatchesProduct('charter', 'combo_airport_seoul')).toBe(true);
    expect(couponMatchesProduct('charter', 'kpop_shuttle_oneway')).toBe(true);
    expect(couponMatchesProduct('charter', 'tour_package_seoul')).toBe(false);
  });
  it('tour-package scope → tour 만', () => {
    expect(couponMatchesProduct('tour-package', 'tour_package_seoul')).toBe(true);
    expect(couponMatchesProduct('tour-package', 'charter_busan')).toBe(false);
  });
  it('legacy(scope 없음) → 모두 허용 / 알수없는 scope → 거부', () => {
    expect(couponMatchesProduct('', 'charter_busan')).toBe(true);
    expect(couponMatchesProduct('weird', 'charter_busan')).toBe(false);
  });
});

describe('verifyCouponForCharge — docId 기준 결제 검증', () => {
  const FUTURE = Date.now() + 1_000_000;
  const PAST = Date.now() - 1_000_000;

  it('유효 쿠폰(미사용·미만료·scope 일치) → valid + discountPct', async () => {
    const db = mockDb({ value: 5, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'percent', discountPct: 5, minOrderUSD: 0 });
  });
  it('isUsed=true → invalid (이중 소진 방지)', async () => {
    const db = mockDb({ value: 5, isUsed: true, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
  });
  it('만료 → invalid', async () => {
    const db = mockDb({ value: 5, isUsed: false, expiresAt: PAST, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
  });
  it('scope mismatch (tour 쿠폰 → charter 결제) → invalid', async () => {
    const db = mockDb({ value: 5, isUsed: false, expiresAt: FUTURE, productScope: 'tour-package' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
  });
  it('문서 없음 / db·uid·docId 누락 → invalid', async () => {
    expect(await verifyCouponForCharge(mockDb(null), 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
    expect(await verifyCouponForCharge(null, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
    expect(await verifyCouponForCharge(mockDb({ value: 5 }), '', 'doc1', 'charter_busan')).toEqual({ valid: false });
  });
  it('value 안전 상한 10% (변조/이상치 방어)', async () => {
    const db = mockDb({ value: 50, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'percent', discountPct: 10, minOrderUSD: 0 });
  });
  // 2026-07-18 fix: fixed(정액) 쿠폰 — 이전엔 청구 경로에서 거부(표시 할인 + capture 소진 +
  // 청구 정가 = 고객 피해형 반쪽 구현). 이제 kind:'fixed' 로 반환해 createPaypalOrder 가 차감.
  it('fixed USD 쿠폰 → valid + kind:fixed + currency/amount', async () => {
    const db = mockDb({ type: 'fixed', currency: 'USD', value: 8, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'USD', amount: 8, minOrderUSD: 0 });
  });
  it('fixed KRW 쿠폰(₩50,000 preset) → valid + kind:fixed', async () => {
    const db = mockDb({ type: 'fixed', currency: 'KRW', value: 50000, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'KRW', amount: 50000, minOrderUSD: 0 });
  });
  it('fixed 이상치 상한 — KRW 1,000,000 / USD 700 클램프 (변조 방어)', async () => {
    const dbK = mockDb({ type: 'fixed', currency: 'KRW', value: 99_999_999, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(dbK, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'KRW', amount: 1_000_000, minOrderUSD: 0 });
    const dbU = mockDb({ type: 'fixed', currency: 'USD', value: 99_999, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(dbU, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'USD', amount: 700, minOrderUSD: 0 });
  });
  it('레거시 fixed(currency 미기록) → USD 간주 — 표시단(applyPromoCode `currency||USD`)과 동형', async () => {
    const db = mockDb({ type: 'fixed', value: 8, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'USD', amount: 8, minOrderUSD: 0 });
  });
  it('minOrderUSD 발급 조건 → 반환에 포함 (createPaypalOrder 가 주문액 미달 시 미적용)', async () => {
    const db = mockDb({ type: 'fixed', currency: 'KRW', value: 50000, minOrderUSD: 100, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'fixed', currency: 'KRW', amount: 50000, minOrderUSD: 100 });
  });
  it('fixed 인데 currency 불명/value≤0 → invalid (정가 안전)', async () => {
    const db1 = mockDb({ type: 'fixed', currency: 'EUR', value: 8, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db1, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
    const db2 = mockDb({ type: 'fixed', currency: 'KRW', value: 0, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db2, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: false });
  });
  it('type:"percent" 명시 쿠폰 → 정상 valid (게이트 무영향)', async () => {
    const db = mockDb({ type: 'percent', value: 5, isUsed: false, expiresAt: FUTURE, productScope: 'charter' });
    expect(await verifyCouponForCharge(db, 'uid1', 'doc1', 'charter_busan')).toEqual({ valid: true, kind: 'percent', discountPct: 5, minOrderUSD: 0 });
  });
});
