// "예시 (Example)" showcase — 3 pre-made, real-quality Day-1 sample plans
// (Seoul / Busan / Jeju) shown on the planner landing so visitors see the
// quality of a finished plan for FREE ($0, zero API calls — pure static).
//
// Each example is unmistakably badged "예시) Example" so nobody confuses it
// with their own generated plan. Selecting a city opens the rich Day-1 view,
// REUSING the real StopCard + TransitArrow + LodgingBookend components (no new
// render path) — same door-to-door transit detail a paid plan shows.
import { useMemo, useState } from 'react';
import { Sparkles, ArrowRight, MapPin } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { StopCard } from '@/pages/PlanDetailPage/components/StopCard';
import { TransitArrow } from '@/pages/PlanDetailPage/components/TransitArrow';
import { LodgingBookend } from '@/pages/PlanDetailPage/components/LodgingBookend';
import { TransitFallback } from '@/pages/PlanDetailPage/components/TransitFallback';
import type { PlanStop, TransitSegment } from '@/pages/PlanDetailPage/types';
import type { TransitFromPrev } from '@/types/plan';
import { getSamplePlans, type Lang } from '@/data/sample-plans';
import type { PlannerDict } from '../types';

interface SampleLabels {
  sectionTitle?: string;
  sectionSubtitle?: string;
  badge?: string;
  exampleItinerary?: string;
  day1Label?: string;
  ctaMakePlan?: string;
  disclaimer?: string;
}

export function SampleShowcase({ p, isMobile, onMakePlan }: { p: PlannerDict; isMobile: boolean; onMakePlan?: () => void }) {
  const { language } = useLanguage();
  const lang = (language as Lang) || 'en';
  const samples = useMemo(() => getSamplePlans(lang), [lang]);
  const [activeId, setActiveId] = useState<string>(samples[0]?.id || '');
  const active = samples.find((s) => s.id === activeId) || samples[0];

  const L = ((p as Record<string, unknown>).sample || {}) as SampleLabels;
  const sectionTitle = L.sectionTitle || '실제 예시 플랜 (무료 미리보기)';
  const sectionSubtitle = L.sectionSubtitle || '결제 전, 완성된 플랜의 품질을 직접 확인하세요.';
  const badge = L.badge || '예시) Example';
  const exampleItinerary = L.exampleItinerary || '예시 일정';
  const day1Label = L.day1Label || 'Day 1';
  const ctaMakePlan = L.ctaMakePlan || '내 플랜 만들기';
  const disclaimer = L.disclaimer || '※ 이 일정은 품질을 보여주기 위한 예시입니다. 내 플랜은 입력한 조건에 맞춰 새로 생성됩니다.';

  const accent = isMobile ? '#B668FC' : '#7C5CFC';

  if (!active) return null;
  const stops = active.day.stops;

  return (
    <section
      className={isMobile
        ? 'm-card m-appear p-4'
        : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 sm:p-7'}
      aria-label={exampleItinerary}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-1">
        <Sparkles className="w-5 h-5 shrink-0 mt-0.5" style={{ color: accent }} />
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-white leading-snug">{sectionTitle}</h2>
          <p className="text-[13px] text-white/55 mt-0.5">{sectionSubtitle}</p>
        </div>
      </div>

      {/* City selector tabs */}
      <div className="flex gap-2 mt-4 mb-4 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
        {samples.map((s) => {
          const on = s.id === active.id;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(s.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-[13px] font-bold border transition-colors ${
                on
                  ? 'text-white border-transparent'
                  : 'text-white/60 border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:text-white/80'
              }`}
              style={on ? { background: `linear-gradient(135deg, ${accent}, #EA537E)` } : undefined}
            >
              <MapPin className="w-3.5 h-3.5" />
              {s.cityLabel}
            </button>
          );
        })}
      </div>

      {/* "예시" banner — unmistakable so users don't think it's their own plan */}
      <div
        className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-3 border"
        style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.14), rgba(234,83,126,0.10))', borderColor: 'rgba(124,92,252,0.35)' }}
      >
        <span
          className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold text-white uppercase tracking-wide"
          style={{ background: `linear-gradient(135deg, ${accent}, #EA537E)` }}
        >
          {badge}
        </span>
        <p className="text-[13px] font-bold text-white/90 truncate">
          {active.tour_title} · <span className="text-white/60 font-semibold">{day1Label} — {active.day.theme}</span>
        </p>
      </div>

      {/* Rich Day-1 view — reuses the real plan-detail components */}
      <div className="space-y-1">
        {/* lodging → first stop (real ODsay/transit leg) */}
        {active.day.lodging_to_first && stops.length > 0 && (
          <LodgingBookend
            transit={active.day.lodging_to_first as TransitFromPrev}
            variant="depart"
            lodgingLabel={active.day.lodgingLabel}
            otherLabel={stops[0].display_name || stops[0].name || ''}
          />
        )}
        {stops.map((stop: PlanStop, si: number) => {
          const destName = stop.display_name || stop.name || '';
          const skipFirstTransit = si === 0 && !!active.day.lodging_to_first;
          const prevStop = si > 0 ? stops[si - 1] : null;
          const prevName = prevStop ? (prevStop.display_name || prevStop.name || '') : '';
          return (
            <div key={si}>
              {!skipFirstTransit && stop.transit_from_prev && (
                <TransitArrow transit={stop.transit_from_prev as TransitSegment & TransitFromPrev & Record<string, unknown>} destinationName={destName} />
              )}
              {!skipFirstTransit && !stop.transit_from_prev && si > 0 && (
                <TransitFallback
                  prevLat={prevStop?.lat}
                  prevLng={prevStop?.lng}
                  prevName={prevName}
                  currLat={stop.lat}
                  currLng={stop.lng}
                  currName={destName}
                />
              )}
              {/* isOwner omitted → favorite/share hidden (read-only example). */}
              <StopCard stop={stop} />
            </div>
          );
        })}
      </div>

      {/* disclaimer + CTA */}
      <p className="text-[12px] text-white/45 mt-4 leading-relaxed">{disclaimer}</p>
      <button
        type="button"
        onClick={() => {
          if (onMakePlan) { onMakePlan(); return; }
          const el = document.querySelector('form') || document.getElementById('planner-quick-result');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className="mt-3 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold text-white transition-transform active:scale-[0.99]"
        style={{ background: `linear-gradient(135deg, ${accent}, #EA537E)` }}
      >
        {ctaMakePlan}
        <ArrowRight className="w-4 h-4" />
      </button>
    </section>
  );
}
