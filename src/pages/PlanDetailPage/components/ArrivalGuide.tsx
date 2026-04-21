// Airport arrival guide: expandable steps + transit options + T-money load suggestion.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L769-828) during P2 Lock release.
import { useState } from 'react';
import { Plane, ChevronDown, Wallet } from 'lucide-react';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailUI } from '../types';

interface ArrivalOption {
  name: string;
  price_krw: number;
}

interface TransportOption {
  price_krw?: number;
  est_price_krw?: number;
  duration_min?: number;
}

interface ArrivalStep {
  step: number;
  title: string;
  description: string;
  est_min: number;
  options?: ArrivalOption[];
  transport_to_hotel?: Record<string, TransportOption | null>;
  t_money_recommended_load_krw?: number;
}

interface ArrivalGuideData {
  airport: string;
  steps?: ArrivalStep[];
}

export function ArrivalGuide({ guide }: { guide: ArrivalGuideData }) {
  const { t } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Plane className="w-5 h-5 text-[#7C5CFC]" />
          <div className="text-left">
            <p className="text-sm font-bold">{ui.arrivalGuide || 'Airport Arrival Guide'}</p>
            <p className="text-xs text-white/40">{guide.airport}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-3 pl-2">
          {(guide.steps || []).map((step: ArrivalStep, i: number) => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{step.step}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs text-white/50 mt-1">{step.description}</p>
                  {step.est_min > 0 && <p className="text-[10px] text-[#7C5CFC] mt-1">~{step.est_min} {ui.minUnit || 'min'}</p>}
                  {step.options && (
                    <div className="mt-2 space-y-1">
                      {step.options.map((opt: ArrivalOption, j: number) => (
                        <div key={j} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                          <span className="text-xs text-white/70">{opt.name}</span>
                          <span className="text-xs font-bold text-[#7C5CFC]">{formatKRW(opt.price_krw)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.transport_to_hotel && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {Object.entries(step.transport_to_hotel).filter(([, val]) => val != null).map(([key, val]: [string, TransportOption | null]) => (
                        <div key={key} className="bg-white/[0.04] rounded-lg px-3 py-2">
                          <p className="text-[10px] text-white/40 uppercase">{key.replace(/_/g, ' ')}</p>
                          <p className="text-xs font-bold">{formatKRW(val?.price_krw || val?.est_price_krw || 0)}</p>
                          <p className="text-[10px] text-white/30">{val?.duration_min || '?'} {ui.minUnit || 'min'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {(step.t_money_recommended_load_krw ?? 0) > 0 && (
                    <div className="mt-2 inline-flex items-center gap-1 bg-[#7C5CFC]/15 rounded-full px-3 py-1">
                      <Wallet className="w-3 h-3 text-[#7C5CFC]" />
                      <span className="text-xs font-bold text-[#7C5CFC]">{ui.tmoneyLoad || 'Load'} {formatKRW(step.t_money_recommended_load_krw ?? 0)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
