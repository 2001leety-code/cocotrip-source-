/**
 * PromoBanner — 오픈기념 할인 다국어 배너 (페이지 최상단, 닫기 가능).
 *
 * 운영자 2026-06-07: 오픈기념 50%(선착순) + 첫 예약 10%(WELCOME 5% + 다일/왕복 5%) 광고.
 * 4언어(영/한/일/중) — 현재 언어로 표시(기본 영어). 닫으면 localStorage 로 유지.
 * ⚠️ 문구는 COPY 만 바꾸면 됨 (운영자 조정 용이). 실제 할인은 EARLY50/WELCOME 쿠폰이 적용.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { BRAND } from '@/lib/design-tokens';

const DISMISS_KEY = 'coco_promo_banner_dismissed_v1';

// 문구 — 운영자가 여기만 바꾸면 됨. (현재: 오픈 50% 선착순 + 첫 예약 10%)
const COPY: Record<string, string> = {
  en: '🎉 Grand Opening — up to 50% OFF (limited) · 10% off your first booking',
  ko: '🎉 오픈 기념 — 최대 50% 할인 (선착순) · 첫 예약 10% 할인',
  ja: '🎉 オープン記念 — 最大50%OFF（先着順）· 初回ご予約10%OFF',
  zh: '🎉 开业纪念 — 最高50%折扣（限量）· 首次预订享10%折扣',
};

export function PromoBanner() {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  if (dismissed) return null;

  const text = COPY[language] || COPY.en;
  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div
      className="relative w-full text-center text-white text-[12px] sm:text-sm font-semibold py-2 px-9 leading-snug"
      style={{ background: BRAND.gradient.primary }}
      role="region"
      aria-label="Promotion"
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={close}
        aria-label="Close promotion"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/15 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}
