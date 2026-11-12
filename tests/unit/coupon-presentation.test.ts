import { describe, expect, it } from 'vitest';
import { formatCouponLabel, formatCouponValue } from '../../src/lib/couponPresentation';

const percent = { source: 'onboarding', productScope: 'charter', type: 'percent' as const, value: 5, currency: 'USD' as const, label: 'Saved label' };

describe('coupon presentation in all four languages', () => {
  it.each([
    ['ko', '무료', '가입 환영 — 차터 5% 할인', '가입 환영 — 투어 5% 할인', 'AI 일정 구매 혜택 — 차터 5% 할인', 'AI 일정 구매 혜택 — 투어 5% 할인'],
    ['en', 'FREE', 'Welcome 5% off Charter', 'Welcome 5% off Tour', 'Charter 5% off (AI plan purchase)', 'Tour 5% off (AI plan purchase)'],
    ['ja', '無料', '新規登録特典 — チャーター5%割引', '新規登録特典 — ツアー5%割引', 'AIプラン購入特典 — チャーター5%割引', 'AIプラン購入特典 — ツアー5%割引'],
    ['zh', '免费', '新用户礼遇 — 包车优惠5%', '新用户礼遇 — 旅游优惠5%', 'AI行程购买礼遇 — 包车优惠5%', 'AI行程购买礼遇 — 旅游优惠5%'],
  ])('formats welcome/purchase labels and coupon values (%s)', (language, free, welcomeCharter, welcomeTour, purchaseCharter, purchaseTour) => {
    expect(formatCouponValue({ ...percent, type: 'free', value: 100 }, language)).toBe(free);
    expect(formatCouponValue(percent, language)).toBe('5%');
    expect(formatCouponValue({ ...percent, type: 'fixed', value: 10 }, language)).toBe('$10');
    expect(formatCouponValue({ ...percent, type: 'fixed', value: 5000, currency: 'KRW' }, language)).toBe('₩5,000');
    expect(formatCouponLabel(percent, language)).toBe(welcomeCharter);
    expect(formatCouponLabel({ ...percent, productScope: 'tour-package' }, language)).toBe(welcomeTour);
    expect(formatCouponLabel({ ...percent, source: 'ai-plan-purchase' }, language)).toBe(purchaseCharter);
    expect(formatCouponLabel({ ...percent, source: 'ai-plan-purchase', productScope: 'tour-package' }, language)).toBe(purchaseTour);
  });

  it.each([
    { source: undefined }, { source: 'custom' }, { productScope: 'unknown' }, { type: 'fixed' as const },
    { source: 'ai-plan-purchase', productScope: 'ai-plan', type: 'free' as const },
    { productScope: 'ai-plan', type: 'free' as const },
    { productScope: 'ai-plan', type: 'free' as const, maxDays: 0 },
  ])('keeps the saved label for an unknown or incomplete combination: %j', fields => {
    expect(formatCouponLabel({ ...percent, ...fields }, 'ko')).toBe('Saved label');
  });

  it('uses the issued value/day limit and defaults unsupported languages to English', () => {
    expect(formatCouponLabel({ ...percent, value: 7 }, 'ko')).toContain('7%');
    expect(formatCouponLabel({ ...percent, productScope: 'ai-plan', type: 'free', maxDays: 5 }, 'en')).toBe('Welcome — Free AI Plan (1~5 days)');
    expect(formatCouponValue({ ...percent, type: 'free' }, 'fr')).toBe('FREE');
    expect(formatCouponLabel(percent, 'fr')).toBe('Welcome 5% off Charter');
  });
});
