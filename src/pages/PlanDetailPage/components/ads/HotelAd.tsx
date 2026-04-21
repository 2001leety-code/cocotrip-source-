// Hotel booking affiliate banner.
// Extracted from PlanDetailPage/index.tsx L208-236 (zero behavior change).
import { MapPin } from 'lucide-react';
import { buildAccommodationLinks } from '@/config/affiliateLinks';

interface HotelAdProps {
  region: string;
}

export function HotelAd({ region }: HotelAdProps) {
  const links = buildAccommodationLinks(region + ' Hotel', region);
  if (!links.length) return null;

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-blue-500/20" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(6,182,212,0.05))' }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-blue-500/20 border border-blue-500/30">
          <MapPin className="w-5 h-5 text-blue-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">Find Your Perfect Hotel</p>
          <p className="text-xs text-white/50 mt-0.5">Best rates for {region} hotels</p>
        </div>
      </div>
      <div className="px-5 pb-4">
        {links.map((lk: { provider: string; url: string; label: string; color?: string }) => (
          <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ background: lk.color || '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
            {lk.label} {'\u2192'}
          </a>
        ))}
      </div>
      <p className="text-[10px] text-white/20 text-center pb-3 px-5">Affiliate link {'\u2014'} helps support CocoTrip.</p>
    </div>
  );
}
