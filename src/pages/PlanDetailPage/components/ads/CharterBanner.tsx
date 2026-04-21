// Charter vehicle full-page banner (distinct from per-day CharterCTA inside DayTimeline).
// Extracted from PlanDetailPage/index.tsx L310-347 (zero behavior change).
import { Car } from 'lucide-react';
import { detectCharterRecommendation } from '@/data/charterPricing';
import type { PlanDay } from '../../types';

interface CharterBannerProps {
  days: PlanDay[];
}

export function CharterBanner({ days }: CharterBannerProps) {
  const allStops = days.flatMap((d: PlanDay) => d.stops || []);
  const detection = detectCharterRecommendation(allStops);
  if (!detection.recommended || !detection.pricing) return null;
  const { pricing } = detection;

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-cyan-500/25" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))' }}>
      <div className="px-5 py-4 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="w-6 h-6 text-cyan-300" />
            <div>
              <p className="font-bold text-white text-base">Private Charter Vehicle</p>
              <p className="text-xs text-cyan-300/70 mt-0.5">Skip public transit {'\u2014'} ride in comfort</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-cyan-300">{'\u20A9'}{pricing.priceKRW.toLocaleString()}</p>
            <p className="text-xs text-white/40">{pricing.hours}hrs</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {['English driver', 'Door-to-door', 'Free WiFi', 'Luggage space'].map(f => (
            <span key={f} className="text-[11px] text-cyan-200/70 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">{'\u2713'} {f}</span>
          ))}
        </div>
        <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
          className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', boxShadow: '0 4px 20px rgba(6,182,212,0.3)' }}>
          Book via WhatsApp {'\u2192'}
        </a>
      </div>
    </div>
  );
}
