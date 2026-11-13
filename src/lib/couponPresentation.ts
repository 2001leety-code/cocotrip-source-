import type { Coupon } from '@/hooks/useLoyalty';

const COPY: Record<string, {
  free: string; welcomeCharter: string; welcomeTour: string; welcomeAi: string;
  purchaseCharter: string; purchaseTour: string;
}> = {
  ko: {
    free: '무료', welcomeCharter: '가입 환영 — 차터 {value}% 할인', welcomeTour: '가입 환영 — 투어 {value}% 할인',
    welcomeAi: '가입 환영 — 무료 AI 일정 (1~{maxDays}일)',
    purchaseCharter: 'AI 일정 구매 혜택 — 차터 {value}% 할인', purchaseTour: 'AI 일정 구매 혜택 — 투어 {value}% 할인',
  },
  en: {
    free: 'FREE', welcomeCharter: 'Welcome {value}% off Charter', welcomeTour: 'Welcome {value}% off Tour',
    welcomeAi: 'Welcome — Free AI Plan (1~{maxDays} days)',
    purchaseCharter: 'Charter {value}% off (AI plan purchase)', purchaseTour: 'Tour {value}% off (AI plan purchase)',
  },
  ja: {
    free: '無料', welcomeCharter: '新規登録特典 — チャーター{value}%割引', welcomeTour: '新規登録特典 — ツアー{value}%割引',
    welcomeAi: '新規登録特典 — 無料AIプラン（1〜{maxDays}日）',
    purchaseCharter: 'AIプラン購入特典 — チャーター{value}%割引', purchaseTour: 'AIプラン購入特典 — ツアー{value}%割引',
  },
  zh: {
    free: '免费', welcomeCharter: '新用户礼遇 — 包车优惠{value}%', welcomeTour: '新用户礼遇 — 旅游优惠{value}%',
    welcomeAi: '新用户礼遇 — 免费AI行程（1~{maxDays}天）',
    purchaseCharter: 'AI行程购买礼遇 — 包车优惠{value}%', purchaseTour: 'AI行程购买礼遇 — 旅游优惠{value}%',
  },
};

export function formatCouponValue(coupon: Pick<Coupon, 'type' | 'value' | 'currency'>, language: string): string {
  if (coupon.type === 'free') return (COPY[language] || COPY.en).free;
  if (coupon.type === 'percent') return `${coupon.value}%`;
  return coupon.currency === 'KRW' ? `₩${coupon.value.toLocaleString()}` : `$${coupon.value}`;
}

/** Translate known issued coupons; custom/legacy labels remain the issuer's text. */
export function formatCouponLabel(coupon: Pick<Coupon, 'source' | 'productScope' | 'type' | 'value' | 'maxDays' | 'label'>, language: string): string {
  const copy = COPY[language] || COPY.en;
  let template = '';
  if (coupon.source === 'onboarding' && coupon.productScope === 'ai-plan' && coupon.type === 'free'
    && Number.isSafeInteger(coupon.maxDays) && Number(coupon.maxDays) > 0) {
    template = copy.welcomeAi;
  } else if (coupon.type === 'percent') {
    if (coupon.source === 'onboarding') {
      if (coupon.productScope === 'charter') template = copy.welcomeCharter;
      if (coupon.productScope === 'tour-package') template = copy.welcomeTour;
    } else if (coupon.source === 'ai-plan-purchase') {
      if (coupon.productScope === 'charter') template = copy.purchaseCharter;
      if (coupon.productScope === 'tour-package') template = copy.purchaseTour;
    }
  }
  return template
    ? template.replace('{value}', String(coupon.value)).replace('{maxDays}', String(coupon.maxDays))
    : coupon.label;
}
