// Slide progress indicator.
// <=8 slides: dots with active scale (ad slides shown smaller / dimmer
//             so users can distinguish "content" vs "ad" before swiping)
// >8 slides: compact "{current+1} / {total}" + thin progress bar
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';
import { BRAND } from '@/lib/design-tokens';
import type { Slide } from '../lib/buildSlides';

interface SlideProgressProps {
  current: number;
  total: number;
  onDotClick: (idx: number) => void;
  /** Optional — when provided, ad slides render as smaller / dimmer dots. */
  slides?: Slide[];
}

export function SlideProgress({ current, total, onDotClick, slides }: SlideProgressProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};
  const compact = total > 8;

  if (compact) {
    const pct = total > 1 ? ((current + 1) / total) * 100 : 100;
    const label = (sw.slideCounter || 'Slide {n} of {total}')
      .replace('{n}', String(current + 1))
      .replace('{total}', String(total));

    return (
      <div className="flex items-center gap-3 px-4 py-2">
        <p className="text-[11px] text-white/55 font-medium shrink-0">{label}</p>
        <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background: BRAND.gradient.primaryHorizontal,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-3">
      {Array.from({ length: total }).map((_, i) => {
        const isActive = current === i;
        const isAd = slides?.[i]?.type === 'ad';
        // Ad slides: 4px square (vs 6px for content) + dimmer so users can
        // see at a glance "this slot is sponsored" before tapping into it.
        const dotWidth = isActive ? 20 : isAd ? 4 : 6;
        const dotHeight = isActive ? 6 : isAd ? 4 : 6;
        const dotBg = isActive
          ? BRAND.gradient.primaryHorizontal
          : isAd
            ? 'rgba(255,255,255,0.20)'
            : 'rgba(255,255,255,0.35)';
        return (
          <button
            key={i}
            onClick={() => onDotClick(i)}
            className="transition-all duration-200"
            style={{
              width: dotWidth,
              height: dotHeight,
              borderRadius: 3,
              background: dotBg,
              transform: isActive ? 'scale(1)' : 'scale(0.85)',
            }}
            aria-label={`${t.a11y?.goToSlide ||'Go to slide'} ${i + 1}${isAd ? ' (sponsored)' : ''}`}
          />
        );
      })}
    </div>
  );
}
