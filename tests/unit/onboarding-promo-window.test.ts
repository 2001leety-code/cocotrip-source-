/**
 * 가입 쿠폰 — 1년 만료 + 상시 발급 (2026-06-19 운영자 "자율진행" — 광고 재개 시 가입→웰컴쿠폰
 * funnel 유지를 위해 ONBOARDING_PROMO_END='' 상시화). 마감일 미설정 = 항상 발급.
 * 발급 로직은 멱등(onboarding-coupons). 나중에 종료하려면 ONBOARDING_PROMO_END='YYYY-MM-DD'.
 */
import { describe, it, expect } from 'vitest';
import { isOnboardingPromoOpen, COUPON_VALIDITY_MS } from '../../api/onboarding-coupons.js';

describe('가입 쿠폰 정책', () => {
  it('쿠폰 만료 = 1년 (365일)', () => {
    expect(COUPON_VALIDITY_MS).toBe(365 * 24 * 3600 * 1000);
  });
  it('상시 발급 — 과거 날짜 가입 → 발급 가능', () => {
    expect(isOnboardingPromoOpen(new Date('2020-01-01T00:00:00+09:00').getTime())).toBe(true);
  });
  it('상시 발급 — 미래 날짜 가입도 발급 가능(마감일 미설정)', () => {
    expect(isOnboardingPromoOpen(new Date('2030-01-01T00:00:00+09:00').getTime())).toBe(true);
  });
});
