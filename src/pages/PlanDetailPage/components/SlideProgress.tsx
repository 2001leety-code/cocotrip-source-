// Slide progress indicator.
// <=8 slides: dots with active scale
// >8 slides: compact "{current+1} / {total}" + thin progress bar
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';

interface SlideProgressProps {
  current: number;
  total: number;
  onDotClick: (idx: number) => void;
}

export function SlideProgress({ current, total, onDotClick }: SlideProgressProps) {
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
        <p className="text-[11px] text-white/40 font-medium shrink-0">{label}</p>
        <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #7C5CFC, #EA537E)',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-3">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onDotClick(i)}
          className="transition-all duration-200"
          style={{
            width: current === i ? 20 : 6,
            height: 6,
            borderRadius: 3,
            background: current === i
              ? 'linear-gradient(90deg, #7C5CFC, #EA537E)'
              : 'rgba(255,255,255,0.15)',
            transform: current === i ? 'scale(1)' : 'scale(0.85)',
          }}
          aria-label={`${t.a11y?.goToSlide ||'Go to slide'} ${i + 1}`}
        />
      ))}
    </div>
  );
}
