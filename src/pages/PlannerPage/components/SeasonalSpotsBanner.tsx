import type { PlannerDict } from '../types';
// Seasonal spots banner -- extracted verbatim from legacy PlannerPage.tsx L488-558.
import { MapPin, Clock, Lightbulb } from 'lucide-react';
import { SEASONAL_SPOTS } from '@/data/seasonalSpots';
import { REGION_KEYWORDS } from '../constants';
import type { PlannerResponse } from '../types';

export function SeasonalSpotsBanner({ result, lang, p }: { result: PlannerResponse; lang: string; p: PlannerDict }) {
  const season = result.currentSeason ?? 'spring';
  const data = SEASONAL_SPOTS[season];
  const title = data.title[lang as keyof typeof data.title] ?? data.title.en;
  const subtitle = data.subtitle[lang as keyof typeof data.subtitle] ?? data.subtitle.en;
  const urgency = data.urgency[lang as keyof typeof data.urgency] ?? data.urgency.en;

  const userRegions = result.meta?.regions ?? [];
  const filteredSpots = data.spots.filter(spot => {
    if (userRegions.length === 0) return true;
    return userRegions.some(region => {
      const keywords = REGION_KEYWORDS[region] ?? [region];
      return keywords.some(kw => spot.location.includes(kw) || spot.locationEn.toLowerCase().includes(kw.toLowerCase()));
    });
  });

  if (filteredSpots.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-emerald-500/25"
      style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(6,182,212,0.07))' }}>
      <div className="px-5 py-4 border-b border-emerald-500/20">
        <p className="font-bold text-white text-base mb-0.5">{title}</p>
        <p className="text-xs text-emerald-300/70">{subtitle}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/25 rounded-full px-3 py-1">
          <span className="text-xs text-amber-200/90 font-medium">{urgency}</span>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto px-5 py-4 pb-5 -mb-1" style={{ scrollbarWidth: 'none' }}>
        {filteredSpots.map((spot, i) => {
          // ja/zh fall back to Korean original (hanja-recognizable + useful at the venue), only en uses the English transliteration.
          const name = lang === 'en' ? spot.nameEn : spot.name;
          const location = lang === 'en' ? spot.locationEn : spot.location;
          const highlight = lang === 'en' ? spot.highlightEn : spot.highlight;
          const period = lang === 'en' ? spot.periodEn : spot.period;
          const tip = lang === 'en' ? spot.tipEn : spot.tip;
          return (
            <div key={i} className="shrink-0 w-64 bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2">
              <div>
                <p className="font-semibold text-white text-sm leading-snug">{name}</p>
                <p className="text-[11px] text-white/40 mt-0.5 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5 shrink-0" /> {location}</p>
              </div>
              <p className="text-xs text-emerald-200/80 leading-relaxed flex-1">{highlight}</p>
              <div className="space-y-1">
                <p className="text-[11px] text-white/40 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {p.seasonalSpotsPeriod}: <span className="text-white/60">{period}</span></p>
                <p className="text-[11px] text-amber-200/70 flex items-center gap-0.5"><Lightbulb className="w-2.5 h-2.5" /> {p.seasonalSpotsTip}: {tip}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
