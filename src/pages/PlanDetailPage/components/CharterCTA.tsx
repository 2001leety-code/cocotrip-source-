// Charter CTA card -- shown on days with complex transit (3+ subway/bus, or downgraded routes).
// Reuses detectCharterRecommendation from charterPricing.ts (no duplicate logic).
// PR-C2 (2026-06-01): when VITE_FEATURE_CHARTER_CTA_REALROUTE=true,
//   prefills destinationKey from the day's actual region/city (not hardcoded Seoul).
//   Flag OFF (unset) -> current hardcoded URL byte-identical.
import { Car } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { formatKRW } from '../constants';
import type { PlanDay, PlanStop, PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';
import { buildCharterCTAUrl } from '../lib/charterCtaPrefill';

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

  return (
    <div className="mb-4 rounded-2xl p-4 border border-white/[0.08] backdrop-blur-sm"
      style={{ background: 'rgba(255,255,255,0.04)' }}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[#7C5CFC]/20 border border-[#7C5CFC]/30">
          <Car className="w-5 h-5 text-[#7C5CFC]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold leading-tight">
            {ch.suggestHeader || 'This day has many transit transfers'}
          </p>
          <p className="text-white/55 text-xs mt-1">
            {ch.suggestBody || 'Skip the hassle -- ride in comfort with a private driver'}
          </p>
          {pricing && (
            <p className="text-[#7C5CFC] text-xs mt-2 font-medium">
              {pricing.en} {'·'} {pricing.hours}{ch.hoursLabel || 'hours'} {'·'} {formatKRW(pricing.priceKRW)}
            </p>
          )}
        </div>
      </div>
      <a
        href={charterHref}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] hover:border-[#7C5CFC]/50"
        style={{ background: 'linear-gradient(135deg,#7C5CFC,#a855f7)' }}
      >
        {ch.viewCharterCTA || 'View Charter Options'} {'→'}
      </a>
    </div>
  );
}
