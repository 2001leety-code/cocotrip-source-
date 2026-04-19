// Tour recommendations -- extracted verbatim from legacy PlannerPage.tsx L889-935.
import { MapPin, Palette } from 'lucide-react';
import { buildTourLinks } from '@/config/affiliateLinks';
import { CAT_ICON, TOUR_CATS } from '../constants';
import type { PlannerResponse } from '../types';

export function TourRecommendationsSection({ result, p }: { result: PlannerResponse; p: any }) {
  const region = result.meta.regions[0] ?? '';
  const tourPlaces = result.itinerary
    .flatMap(d => d.places)
    .filter(pl => TOUR_CATS.has(pl.category ?? ''))
    .slice(0, 6);

  if (!tourPlaces.length) return null;
  const firstLinks = buildTourLinks(tourPlaces[0].name, region);
  if (!firstLinks.length) return null;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Palette className="w-3.5 h-3.5" /> {p.tour_section_title}</p>
      <p className="text-[11px] text-white/35 mb-4">{p.tour_section_desc}</p>
      <div className="space-y-3">
        {tourPlaces.map((pl, i) => {
          const links = buildTourLinks(pl.name, region);
          if (!links.length) return null;
          return (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.06] last:border-0">
              <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0 text-sm">
                {CAT_ICON[pl.category ?? ''] ?? <MapPin className="w-3.5 h-3.5" />}
              </div>
              <span className="flex-1 text-sm text-white/65 font-medium truncate">{pl.name}</span>
              <div className="flex gap-1.5 shrink-0">
                {links.map((lk: any) => (
                  <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:opacity-90 ${
                      lk.provider === 'klook'
                        ? 'bg-[#FF5722] text-white'
                        : 'bg-[#1A3C6E] text-white'
                    }`}>
                    {lk.label}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-white/20 mt-3 leading-relaxed">{p.affiliate_note}</p>
    </div>
  );
}
