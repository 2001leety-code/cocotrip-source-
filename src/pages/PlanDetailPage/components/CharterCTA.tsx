// Charter CTA card -- shown on days with complex transit (3+ subway/bus, or downgraded routes).
// Reuses detectCharterRecommendation from charterPricing.ts (no duplicate logic).
import { Car } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { formatKRW } from '../constants';

interface CharterCTAProps {
  day: any;
}

function shouldShowCharterCTA(day: any): boolean {
  const stops = day.stops || [];
  const transitCount = stops.filter((s: any) =>
    s.transit_from_prev && (s.transit_from_prev.method === 'subway' || s.transit_from_prev.method === 'bus')
  ).length;
  const downgradedCount = stops.filter((s: any) =>
    s.transit_from_prev && s.transit_from_prev._downgraded_from
  ).length;
  const totalTransitMin = stops.reduce((sum: number, s: any) =>
    sum + ((s.transit_from_prev && s.transit_from_prev.est_min) || 0), 0
  );
  return transitCount >= 3 || downgradedCount >= 1 || totalTransitMin >= 120;
}

export function CharterCTA({ day }: CharterCTAProps) {
  const { t } = useLanguage();
  const pd = (t as any).planDetail || {};
  const ch = pd.charter || {};

  if (!shouldShowCharterCTA(day)) return null;

  const stops = (day.stops || []).map((s: any) => ({
    name: s.name || s.display_name || '',
    nameEn: s.display_name || s.name || '',
  }));
  const detection = detectCharterRecommendation(stops);
  const pricing = detection.pricing;

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
          <p className="text-white/40 text-xs mt-1">
            {ch.suggestBody || 'Skip the hassle -- ride in comfort with a private driver'}
          </p>
          {pricing && (
            <p className="text-[#7C5CFC] text-xs mt-2 font-medium">
              {pricing.en} {'\u00B7'} {pricing.hours}{ch.hoursLabel || 'hours'} {'\u00B7'} {formatKRW(pricing.priceKRW)}
            </p>
          )}
        </div>
      </div>
      <a
        href={`/charter?from=planDetail&day=${day.day || 1}`}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] hover:border-[#7C5CFC]/50"
        style={{ background: 'linear-gradient(135deg,#7C5CFC,#a855f7)' }}
      >
        {ch.viewCharterCTA || 'View Charter Options'} {'\u2192'}
      </a>
    </div>
  );
}
