// Flight search section -- extracted verbatim from legacy PlannerPage.tsx L940-955.
import { Plane, Search } from 'lucide-react';
import { buildFlightLink } from '@/config/affiliateLinks';

export function FlightSearchSection({ arrivalAirport, p, lang }: { arrivalAirport?: string; p: PlannerDict; lang?: string }) {
  const link = buildFlightLink(arrivalAirport ?? 'ICN', lang);
  if (!link) return null;
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> {p.flight_section_title}</p>
      <p className="text-[11px] text-white/35 mb-4">{p.flight_section_desc}</p>
      <a href={link.url} target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
        style={{ background: '#FBCE04', color: '#000' }}>
        <Search className="w-4 h-4" /> {link.label}
      </a>
      <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
    </div>
  );
}
