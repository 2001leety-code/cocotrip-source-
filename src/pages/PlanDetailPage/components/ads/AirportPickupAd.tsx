// Airport pickup card.
// Extracted from PlanDetailPage/index.tsx L351-383 (zero behavior change).
import { Plane } from 'lucide-react';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

interface AirportPickupAdProps {
  arrivalAirport: string;
}

export function AirportPickupAd({ arrivalAirport }: AirportPickupAdProps) {
  const airportCode = (arrivalAirport || 'ICN').replace(/_T[12]$/, '');
  const prices = PICKUP_PRICES[airportCode] || PICKUP_PRICES['ICN'];
  if (!prices || !prices.length) return null;

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/25 p-5" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(10,16,32,0.95))' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Plane className="w-6 h-6 text-amber-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight mb-0.5">Airport Pickup Service</p>
          <p className="text-xs text-amber-300/80">English-speaking driver at arrivals</p>
        </div>
        <span className="shrink-0 text-[10px] text-amber-400 border border-amber-500/35 rounded-full px-2.5 py-1 font-semibold">{airportCode}</span>
      </div>
      <div className="space-y-2 mb-4">
        {prices.map((row: { destination: string; price: string }, i: number) => (
          <div key={i} className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3">
            <span className="text-sm text-white/60">{row.destination}</span>
            <span className="text-sm font-bold text-amber-300">{row.price}</span>
          </div>
        ))}
      </div>
      <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
        className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}>
        Book Airport Pickup {'\u2192'}
      </a>
    </div>
  );
}
