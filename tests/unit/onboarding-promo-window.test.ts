/**
 * 가입 쿠폰 — 1년 만료 + 3주 오픈 프로모 가입창 (운영자 2026-06-07).
 * 마감 후 가입자는 WELCOME 쿠폰 미발급. 어떤 경우든 발급 로직은 멱등(onboarding-coupons).
 */
import { describe, it, expect } from 'vitest';
import { isOnboardingPromoOpen, COUPON_VALIDITY_MS } from '../../api/onboarding-coupons.js';

describe('가입 쿠폰 정책', () => {
  it('쿠폰 만료 = 1년 (365일)', () => {
    expect(COUPON_VALIDITY_MS).toBe(365 * 24 * 3600 * 1000);
  });
  it('마감일 전(과거) 가입 → 발급 가능', () => {
    expect(isOnboardingPromoOpen(new Date('2020-01-01T00:00:00+09:00').getTime())).toBe(true);
  });
  it('마감일 후(미래) 가입 → 발급 안 함', () => {
    expect(isOnboardingPromoOpen(new Date('2030-01-01T00:00:00+09:00').getTime())).toBe(false);
  });
});
