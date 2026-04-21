// Departure guide: to-airport transit, luggage storage, tax refund, last-minute shopping.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L1095-1143) during P2 Lock release.
// Note: L1136 "Last-Minute Shopping" had pre-existing mojibake ("\uFFFD\uFFFD"); replaced
// with an ASCII label here. Do not re-introduce emoji/mojibake.
import { useState } from 'react';
import { Plane, ChevronDown } from 'lucide-react';
import { formatKRW } from '../constants';
import type { DepartureGuideBlock } from '../types';
import { getPlanDetailUI } from '../types';
import { useLanguage } from '@/hooks/useLanguage';

export function DepartureGuide({ guide }: { guide: DepartureGuideBlock }) {
  const { t } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Plane className="w-5 h-5 text-pink-400 rotate-45" />
          <div className="text-left">
            <p className="text-sm font-bold">{ui.departureGuide || 'Departure Guide'}</p>
            <p className="text-xs text-white/40">{guide.airport}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-3 pl-2">
          {guide.to_airport && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">{ui.toAirport || 'To Airport'}</p>
              <p className="text-xs text-white/50">{guide.to_airport.method} - {guide.to_airport.instruction}</p>
              <div className="flex gap-4 mt-2 text-[10px] text-white/40">
                <span>{guide.to_airport.duration_min} {ui.minUnit || 'min'}</span>
                <span className="text-[#7C5CFC] font-bold">{formatKRW(guide.to_airport.cost_krw)}</span>
              </div>
            </div>
          )}
          {guide.luggage_storage?.available && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">{ui.luggageStorage || 'Luggage Storage'}</p>
              <p className="text-xs text-white/50">{guide.luggage_storage.location}</p>
            </div>
          )}
          {guide.tax_refund && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">{ui.taxRefund || 'Tax Refund'}</p>
              <p className="text-xs text-white/50">{guide.tax_refund.location}</p>
              <p className="text-[10px] text-[#7C5CFC] mt-1">{ui.minPurchase || 'Min. purchase:'} {formatKRW(guide.tax_refund.threshold_krw)}</p>
            </div>
          )}
          {guide.last_minute_shopping && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold mb-1">{ui.lastMinuteShopping || 'Last-Minute Shopping'}</p>
              <p className="text-xs text-white/50">{guide.last_minute_shopping}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
