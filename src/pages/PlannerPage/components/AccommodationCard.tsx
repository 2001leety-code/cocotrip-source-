import type { PlannerDict } from '../types';
// Accommodation recommendation card -- extracted verbatim from legacy PlannerPage.tsx L448-483.
import { Hotel, MapPin, CreditCard } from 'lucide-react';
import { buildAccommodationLinks } from '@/config/affiliateLinks';
import type { Accommodation } from '../types';

export function AccommodationCard({ acc, p, region }: { acc: Accommodation; p: PlannerDict; region?: string }) {
  const links = buildAccommodationLinks(acc.name, region ?? acc.area ?? '');
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3 sm:rounded-2xl sm:p-5 sm:mb-6">
      <p className="text-xs font-semibold text-white/55 uppercase tracking-widest mb-3 flex items-center gap-1"><Hotel className="w-3.5 h-3.5" /> {p.accommodationLabel}</p>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Hotel className="w-5 h-5 text-emerald-300" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base mb-0.5">{acc.name}</p>
          <p className="text-xs text-white/55 mb-2 flex items-center gap-0.5"><MapPin className="w-3 h-3 shrink-0" /> {acc.area} · {acc.address}</p>
          <div className="bg-emerald-500/10 border-l-2 border-emerald-400/50 rounded-r-xl px-3 py-2 mb-2">
            <p className="text-xs text-emerald-200/80 leading-relaxed">{acc.reason}</p>
          </div>
          <p className="text-xs text-white/50 mb-3 flex items-center gap-0.5"><CreditCard className="w-3 h-3" /> {acc.priceRange}</p>
          {links.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/55 font-semibold">{p.online_booking}</p>
              <div className="flex flex-wrap gap-2">
                {links.map((lk: { provider: string; label: string; url: string; color?: string }) => (
                  <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-95"
                    style={{ background: lk.color || '#0073E6', color: '#fff' }}>
                    {lk.label} →
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-white/55 leading-relaxed">{p.affiliate_note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
