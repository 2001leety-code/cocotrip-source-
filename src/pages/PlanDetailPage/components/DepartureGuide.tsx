// Departure guide — Klook/Trip.com pattern.
//   - Hero "How to get to the airport" card with ODsay step-by-step (reuses TransitArrow).
//   - Tax refund / luggage storage / last-minute shopping shown as compact tip cards.
//   - Pink accent (vs Arrival's purple) so users instantly tell them apart.
import { useState } from 'react';
import { Plane, ChevronDown, Wallet, ShoppingBag, Briefcase } from 'lucide-react';
import { formatKRW } from '../constants';
import type { DepartureGuideBlock } from '../types';
import { getPlanDetailUI } from '../types';
import { useLanguage } from '@/hooks/useLanguage';
import { TransitArrow } from './TransitArrow';
import type { TransitFromPrev } from '@/types/plan';

export function DepartureGuide({ guide }: { guide: DepartureGuideBlock }) {
  const { t } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(false);

  const route = guide.route_to_airport as (TransitFromPrev & Record<string, unknown>) | undefined;
  const routeMin = (route?.est_min as number | undefined) || guide.to_airport?.duration_min;

  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-2xl px-5 py-4 transition-all hover:scale-[1.005]"
        style={{
          background: 'linear-gradient(135deg, rgba(234,83,126,0.15), rgba(251,146,60,0.08))',
          border: '1px solid rgba(234,83,126,0.30)',
        }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#EA537E,#FB923C)' }}>
            <Plane className="w-5 h-5 text-white rotate-45" />
          </div>
          <div className="text-left">
            <p className="text-[15px] font-bold text-white">{ui.departureGuide || 'Departure Guide'}</p>
            <p className="text-[11px] text-white/55 mt-0.5">
              {guide.airport}{routeMin ? ` · ${routeMin}${ui.minUnit || 'min'}` : ''}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/40 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[3000px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
        {/* HERO: ODsay route hotel→airport */}
        {route && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.10), rgba(251,146,60,0.06))', border: '1px solid rgba(234,83,126,0.25)' }}>
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-pink-400/25">
                  <Plane className="w-5 h-5 text-pink-300 rotate-45" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white">{ui.toAirport || 'To Airport'}</p>
                  <p className="text-[11px] text-white/60">
                    {route.est_min as number}{ui.minUnit || 'min'}
                    {((route.est_fare_krw as number) || 0) > 0 ? ` · ${formatKRW((route.est_fare_krw as number) || 0)}` : ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-2 pb-3">
              <TransitArrow transit={route} />
            </div>
          </div>
        )}

        {/* Fallback: simple to_airport card if no ODsay route */}
        {!route && guide.to_airport && (
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <Plane className="w-4 h-4 text-pink-400 rotate-45" />
              <p className="text-sm font-semibold">{ui.toAirport || 'To Airport'}</p>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">{guide.to_airport.method} {guide.to_airport.instruction ? `· ${guide.to_airport.instruction}` : ''}</p>
            <div className="flex gap-3 mt-2 text-[11px]">
              <span className="text-white/40">{guide.to_airport.duration_min} {ui.minUnit || 'min'}</span>
              <span className="text-pink-300 font-bold">{formatKRW(guide.to_airport.cost_krw ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Tip cards row */}
        <div className="space-y-2.5 pl-2">
          {guide.luggage_storage?.available && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-400/20 flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4 text-blue-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.luggageStorage || 'Luggage Storage'}</p>
                  <p className="text-[11px] text-white/55 mt-0.5">{guide.luggage_storage.location}</p>
                </div>
              </div>
            </div>
          )}
          {guide.tax_refund && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-400/20 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.taxRefund || 'Tax Refund'}</p>
                  <p className="text-[11px] text-white/55 mt-0.5">{guide.tax_refund.location}</p>
                  <p className="text-[10px] text-emerald-300 mt-1 font-semibold">{ui.minPurchase || 'Min. purchase:'} {formatKRW(guide.tax_refund.threshold_krw ?? 0)}</p>
                </div>
              </div>
            </div>
          )}
          {guide.last_minute_shopping && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-4 h-4 text-amber-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.lastMinuteShopping || 'Last-Minute Shopping'}</p>
                  <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">{guide.last_minute_shopping}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
