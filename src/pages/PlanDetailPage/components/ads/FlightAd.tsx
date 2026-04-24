// Flight search affiliate banner (Trip.com).
// Extracted from PlanDetailPage/index.tsx L542-568 (zero behavior change).
import { Plane } from 'lucide-react';
import { buildFlightLink } from '@/config/affiliateLinks';
import { useLanguage } from '@/hooks/useLanguage';

interface FlightAdProps {
  arrivalAirport: string;
}

export function FlightAd({ arrivalAirport }: FlightAdProps) {
  const { t } = useLanguage();
  const p = (t.planner as unknown as Record<string, string | undefined>) || {};
  const link = buildFlightLink(arrivalAirport || 'ICN');
  if (!link) return null;

  return (
    <div className="rounded-2xl overflow-hidden border border-indigo-500/20 mt-6" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))' }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-indigo-500/20 border border-indigo-500/30">
          <Plane className="w-5 h-5 text-indigo-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{p.adFlightTitle || 'Search Flights to Korea'}</p>
          <p className="text-xs text-white/50 mt-0.5">{p.adFlightSub || 'Compare prices across airlines'}</p>
        </div>
      </div>
      <div className="px-5 pb-4">
        <a href={link.url} target="_blank" rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
          style={{ background: '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
          {link.label} {'\u2192'}
        </a>
      </div>
      <p className="text-[10px] text-white/20 text-center pb-3 px-5">{p.adAffiliateNote || 'Affiliate link \u2014 helps support CocoTrip.'}</p>
    </div>
  );
}
