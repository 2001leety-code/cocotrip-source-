/**
 * 총 할인 상한 10% (운영자 정책 2026-07-07 "딜+쿠폰 합산 최대 10%") 불변식 가드.
 *
 * 🔴 SAFETY(money): FEATURE_DISCOUNT_V2 ON 시 다일/왕복 딜(5%)과 개인 쿠폰(5%)이 청구가에
 * 곱셈 누적된다. 실 쿠폰은 5% 라 9.75% 로 자연히 10% 이하지만, 5% 초과 쿠폰이 딜과 겹치면
 * 10% 를 넘을 수 있다. createPaypalOrder 의 applyTotalDiscountCap 이 정가 대비 총 할인을
 * 10% 로 floor 하는지 회귀 고정. 깨지면 과할인 → 금전 사고.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyTotalDiscountCap, TOTAL_DISCOUNT_CAP_PCT } from '../../api/_shared/total-discount-cap.js';
import {
  calcMultiDayCharterKrw, lookupMatrixKm, resolveMultiDayCheckoutKrw, multiDayListBaseKrw,
} from '../../api/_shared/charter-multiday-price.js';
import { calcTransferQuote } from '../../api/_shared/charter-transfer-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('applyTotalDiscountCap — 순수 함수 (총 할인 상한)', () => {
  it('상한 상수 = 10%', () => {
    expect(TOTAL_DISCOUNT_CAP_PCT).toBe(10);
  });

  it('딜5%+쿠폰5%(≈9.75%) → floor 미적용 (10% 이내)', () => {
    const listBase = 100_000;
    const dealApplied = Math.round(listBase * 0.95);            // 딜 5%
    const afterCoupon = Math.round(dealApplied * 0.95);          // 쿠폰 5% (곱셈 → 9.75%)
    expect(afterCoupon).toBe(90_250);
    expect(applyTotalDiscountCap(afterCoupon, listBase)).toBe(afterCoupon); // 90,250 그대로
  });

  it('딜5%+쿠폰10%(≈14.5%) → 정가×0.90 으로 floor (정확히 10%)', () => {
    const listBase = 100_000;
    const dealApplied = Math.round(listBase * 0.95);
    const afterCoupon = Math.round(dealApplied * 0.90);          // 쿠폰 10% → 14.5% 총
    expect(afterCoupon).toBe(85_500);
    expect(applyTotalDiscountCap(afterCoupon, listBase)).toBe(90_000); // floor = 정가×0.9
  });

  it('정확히 10% (경계) → 그대로 (floor 는 미만일 때만)', () => {
    expect(applyTotalDiscountCap(90_000, 100_000)).toBe(90_000);
  });

  it('쿠폰만 5% (딜 없음) → 그대로', () => {
    expect(applyTotalDiscountCap(95_000, 100_000)).toBe(95_000);
  });

  it('정가 무효(null/0/NaN) → 청구가 원본 (안전: 과할인보다 미적용)', () => {
    expect(applyTotalDiscountCap(85_500, null as never)).toBe(85_500);
    expect(applyTotalDiscountCap(85_500, 0)).toBe(85_500);
    expect(applyTotalDiscountCap(85_500, NaN)).toBe(85_500);
  });

  it('청구가 NaN → 그대로 (방어)', () => {
    expect(Number.isNaN(applyTotalDiscountCap(NaN, 100_000))).toBe(true);
  });

  it('불변식: 어떤 (정가, 할인) 조합도 결과 ≥ 정가×0.9', () => {
    const listBase = 137_000;
    for (const discPct of [0, 5, 7.5, 10, 12, 15, 20, 30]) {
      const charged = Math.round(listBase * (1 - discPct / 100));
      const capped = applyTotalDiscountCap(charged, listBase);
      expect(capped).toBeGreaterThanOrEqual(Math.round(listBase * 0.9));
    }
  });
});

describe('다일 차터 total-cap 통합 (실 헬퍼로 정가·딜·쿠폰·상한 검증)', () => {
  const body = { originKey: 'ICN', destKey: 'BUSAN', vehicle: 'staria', durationDays: 3 };

  it('multiDayListBaseKrw = 할인 전 정가 (discountPct=0)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const listBase = multiDayListBaseKrw(SPEC, body, true);
    expect(listBase).toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3, discountPct: 0 }));
    // v2 딜가(5%)는 정가보다 작다
    const dealV2 = resolveMultiDayCheckoutKrw(SPEC, body, true, { discountV2: true })!;
    expect(dealV2).toBe(Math.round(listBase! * 0.95));
  });

  it('딜5%+쿠폰5% → floor 안 걸림, 총 할인 ≤ 10%', () => {
    const listBase = multiDayListBaseKrw(SPEC, body, true)!;
    const dealV2 = resolveMultiDayCheckoutKrw(SPEC, body, true, { discountV2: true })!;
    const afterCoupon5 = Math.round(dealV2 * 0.95);
    const final = applyTotalDiscountCap(afterCoupon5, listBase);
    expect(final).toBe(afterCoupon5);                      // floor 미적용
    expect(final).toBeGreaterThanOrEqual(Math.round(listBase * 0.9)); // ≤10% off
  });

  it('딜5%+쿠폰10% → floor 로 정확히 10% off 로 clamp', () => {
    const listBase = multiDayListBaseKrw(SPEC, body, true)!;
    const dealV2 = resolveMultiDayCheckoutKrw(SPEC, body, true, { discountV2: true })!;
    const afterCoupon10 = Math.round(dealV2 * 0.90);       // 5%+10% ≈ 14.5%
    const final = applyTotalDiscountCap(afterCoupon10, listBase);
    expect(final).toBe(Math.round(listBase * 0.9));        // 정확히 10% off 로 floor
    expect(afterCoupon10).toBeLessThan(final);             // 원래 14.5% 였음을 확인
  });

  it('1~2일(딜 없음)은 정가=청구가, 쿠폰 5% 만 → ≤10%', () => {
    const body2 = { ...body, durationDays: 2 };
    const listBase = multiDayListBaseKrw(SPEC, body2, true)!;
    const dealApplied = resolveMultiDayCheckoutKrw(SPEC, body2, true, { discountV2: true })!;
    expect(dealApplied).toBe(listBase);                    // 2일 무할인
    const afterCoupon5 = Math.round(dealApplied * 0.95);
    expect(applyTotalDiscountCap(afterCoupon5, listBase)).toBe(afterCoupon5);
  });
});

describe('transfer total-cap 통합 (calcTransferQuote tripBase = 정가)', () => {
  it('왕복 v2 딜5% + 쿠폰10% → floor 로 10% off clamp', () => {
    const q = calcTransferQuote({ curatedKRW: 100_000, tripType: 'roundtrip', vehicle: 'staria' }, { discountV2: true });
    expect(q).not.toBeNull();
    const listBase = q!.tripBase;                          // 할인 전 정가 (왕복 ×2)
    const dealApplied = q!.total;                          // 딜 5% 적용
    expect(dealApplied).toBe(listBase - Math.round(listBase * 0.05));
    const afterCoupon10 = Math.round(dealApplied * 0.90);  // 딜5+쿠폰10 ≈ 14.5%
    expect(applyTotalDiscountCap(afterCoupon10, listBase)).toBe(Math.round(listBase * 0.9));
  });
});
