// Charter CTA card -- shown on days with complex transit (3+ subway/bus, or downgraded routes).
// Reuses detectCharterRecommendation from charterPricing.ts (no duplicate logic).
// PR-C2 (2026-06-01): when VITE_FEATURE_CHARTER_CTA_REALROUTE=true,
//   prefills destinationKey from the day's actual region/city (not hardcoded Seoul).
//   Flag OFF (unset) -> current hardcoded URL byte-identical.
// PR-C3 (2026-06-01): TransitVsCharterCard 비교 카드 (flag: VITE_FEATURE_TRANSIT_VS_CHARTER).
import { Car, Footprints, Timer, DoorOpen, Sparkles } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { formatKRW } from '../constants';
import type { PlanDay, PlanStop, PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';
import { buildCharterCTAUrl } from '../lib/charterCtaPrefill';
import { TransitVsCharterCard } from './TransitVsCharterCard';

interface CharterCTAProps {
  day: PlanDay;
  /** PR-C2: plan.input (area/adults) -> region extraction + pax prefill. undefined -> fallback. */
  plan?: PlanDocument;
}

function shouldShowCharterCTA(day: PlanDay): boolean {
  const stops = day.stops || [];
  const transitCount = stops.filter((s: PlanStop) =>
    s.transit_from_prev && (s.transit_from_prev.method === 'subway' || s.transit_from_prev.method === 'bus')
  ).length;
  const downgradedCount = stops.filter((s: PlanStop) =>
    s.transit_from_prev && s.transit_from_prev._downgraded_from
  ).length;
  const totalTransitMin = stops.reduce((sum: number, s: PlanStop) =>
    sum + ((s.transit_from_prev && s.transit_from_prev.est_min) || 0), 0
  );
  return transitCount >= 3 || downgradedCount >= 1 || totalTransitMin >= 120;
}

export function CharterCTA({ day, plan }: CharterCTAProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ch = pd.charter || {};

  if (!shouldShowCharterCTA(day)) return null;

  const stops = (day.stops || []).map((s: PlanStop) => ({
    name: s.name || s.display_name || '',
    nameEn: s.display_name || s.name || '',
  }));
  const detection = detectCharterRecommendation(stops);
  const pricing = detection.pricing;

  // PR-C2: flag ON/OFF delegated to pure module (no firebase dependency)
  const { url: charterHref } = buildCharterCTAUrl({
    day,
    planInput: plan?.input as { area?: string; adults?: number; pax?: number } | undefined,
    detectedTourType: detection.tourType,
    pricingHours: pricing?.hours,
  });

  // PR-C3: pax from plan.input (adults || pax)
  const planInput = plan?.input as { adults?: number; pax?: number } | undefined;
  const pax = (typeof planInput?.adults === 'number' && planInput.adults > 0 ? planInput.adults : 0)
    || (typeof planInput?.pax === 'number' && planInput.pax > 0 ? planInput.pax : 0)
    || 1;

  return (
    <>
    {/* PR-C3: 비교 카드 (flag ON 시만 노출, OFF = 현재 동작 byte-identical) */}
    <TransitVsCharterCard day={day} pax={pax} />
    <aside className="mb-4 rounded-ec-md border border-ec-line bg-ec-raised p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ec-brand-wash">
          <Car className="h-5 w-5 text-ec-brand" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight text-ec-ink">
            {ch.suggestHeader || 'This day has many transit transfers'}
          </p>
          <p className="mt-1 text-[14px] text-ec-ink-2">
            {ch.suggestBody || 'Skip the hassle -- ride in comfort with a private driver'}
          </p>
          {pricing && (
            <p className="mt-2 flex flex-wrap gap-1 text-[14px] font-medium text-ec-brand">
              {pricing.en} {'·'} {pricing.hours}{ch.hoursLabel || 'hours'} {'·'} {formatKRW(pricing.priceKRW)}
            </p>
          )}
        </div>
      </div>
      {/* UIUX P5 (2026-07-13): 가치 4배지 — 차터 장점(진실 static). */}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {[
          { icon: Footprints, label: ch.badgeLessWalk || 'Less walking' },
          { icon: Timer, label: ch.badgeSaveTime || 'Save time' },
          { icon: DoorOpen, label: ch.badgeDoorToDoor || 'Door to door' },
          { icon: Sparkles, label: ch.badgeAddWhenNeeded || 'Add only when needed' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-1.5 rounded-ec-sm border border-ec-line bg-ec-sunken px-2.5 py-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ec-brand" aria-hidden />
            <span className="text-[12px] font-semibold leading-tight text-ec-ink-2">{label}</span>
          </div>
        ))}
      </div>
      <a
        href={charterHref}
        className="ec-btn ec-btn-primary mt-3 min-h-[44px] w-full"
      >
        {ch.viewCharterCTA || 'View Charter Options'} {'→'}
      </a>
    </aside>
    </>
  );
}
