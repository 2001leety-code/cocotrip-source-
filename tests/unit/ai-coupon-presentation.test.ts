import { describe, expect, it } from 'vitest';
import { needsAiCouponReview } from '../../src/lib/aiCouponPresentation';

describe('AI coupon review presentation, not authorization', () => {
  const legacy = { productScope: 'ai-plan', isUsed: false, restoredAt: '2030-01-01', aiPlanBinding: null };
  it.each([0, '2030-01-01', false])('recognizes a non-null restore marker %s', restoredAt => {
    expect(needsAiCouponReview({ ...legacy, restoredAt })).toBe(true);
  });
  it.each([null, undefined])('does not invent a restore for %s', restoredAt => {
    expect(needsAiCouponReview({ ...legacy, restoredAt })).toBe(false);
  });
  it.each([true, undefined, null, 0])('requires explicitly unused, not %s', isUsed => {
    expect(needsAiCouponReview({ ...legacy, isUsed })).toBe(false);
  });
  it.each(['tour-package', 'charter', undefined])('leaves product %s alone', productScope => {
    expect(needsAiCouponReview({ ...legacy, productScope })).toBe(false);
  });
  it.each([{}, { version: 1 }, false, 'malformed'])('does not label retained binding metadata as legacy: %s', aiPlanBinding => {
    expect(needsAiCouponReview({ ...legacy, aiPlanBinding })).toBe(false);
  });
});
