// Airport arrival guide — Klook/Trip.com pattern.
//   - Vertical timeline of pre-hotel steps (immigration → SIM → T-money → cash → hotel)
//   - Hero "How to get to your hotel" card with the actually-recommended option
//     (badge + reason) + ODsay step-by-step rendered via the same TransitArrow
//     component used between stops, so the visual is consistent.
//   - Side-by-side comparison grid for the alternative transport options.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plane, ChevronDown, Wallet, Sparkles, Train, Bus, Car, Smartphone, ShieldCheck, ArrowRight } from 'lucide-react';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailUI } from '../types';
import { TransitArrow } from './TransitArrow';
import type { TransitFromPrev } from '@/types/plan';
import { BRAND } from '@/lib/design-tokens';

interface ArrivalOption {
  name: string;
  price_krw: number;
}

interface TransportOption {
  price_krw?: number;
  est_price_krw?: number;
  duration_min?: number;
  instruction?: string;
}

interface RecommendedOption {
  key: string;
  reason_ko?: string;
  reason_en?: string;
  reason_ja?: string;
  reason_zh?: string;
  cta_link?: string;
}

interface RouteToHotel extends TransitFromPrev {
  recommended_option?: RecommendedOption;
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
  route_to_hotel?: RouteToHotel;
}

const TRANSPORT_META: Record<string, { icon: typeof Train; color: string; label: string }> = {
  arex_express:     { icon: Train, color: '#7C5CFC', label: 'AREX Express' },
  arex_all_stop:    { icon: Train, color: '#60a5fa', label: 'AREX All Stop' },
  limousine_bus:    { icon: Bus,   color: '#34d399', label: 'Limousine Bus' },
  taxi:             { icon: Car,   color: '#fb923c', label: 'Taxi' },
  cocotrip_charter: { icon: Car,   color: '#EA537E', label: 'CocoTrip Charter' },
  // P-launch (2026-05-31): AREX 직통 합성 실패 시 중립 추천(라벨↔데이터 모순 방지).
  public_transit:   { icon: Train, color: '#7C5CFC', label: 'Public Transit' },
};

const STEP_ICON: Record<number, typeof Plane> = {
  1: ShieldCheck,
  2: Smartphone,
  3: Wallet,
  4: Wallet,
  5: Train,
};

export function ArrivalGuide({ guide }: { guide: ArrivalGuideData }) {
  const { t, language } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(true);  // Default open — user paid for this guide

  const route = guide.route_to_hotel;
  const rec = route?.recommended_option;
  const recReason = rec
    ? ((language === 'ko' && rec.reason_ko) || (language === 'ja' && rec.reason_ja) || (language === 'zh' && rec.reason_zh) || rec.reason_en || '')
    : '';
  const recMeta = rec ? TRANSPORT_META[rec.key] : undefined;
  const RecIcon = recMeta?.icon || Train;

  return (
    <section className="mb-6">
      {/* Header — bold gradient bar */}
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-2xl px-5 py-4 transition-all hover:scale-[1.005]"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,252,0.18), rgba(96,165,250,0.10))',
          border: '1px solid rgba(124,92,252,0.30)',
        }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: BRAND.gradient.primary }}>
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-[15px] font-bold text-white">{ui.arrivalGuide || 'Airport Arrival Guide'}</p>
            <p className="text-[11px] text-white/55 mt-0.5">{guide.airport} {route ? `· ${route.est_min}${ui.minUnit || 'min'} → ${ui.toHotel || 'Hotel'}` : ''}</p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/55 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[5000px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
        {/* HERO: Charter cross-sell takes precedence (heavy luggage = Korean taxis can't fit) */}
        {rec?.key === 'cocotrip_charter' && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.18), rgba(124,92,252,0.12))', border: '1px solid rgba(234,83,126,0.40)' }}>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FBBC05]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#FBBC05]">{ui.recommended || 'Recommended'}</span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
                  style={{ background: BRAND.gradient.primary }}>
                  <Car className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-bold text-white">{ui.charterRecTitle || 'CocoTrip Private Charter'}</p>
                  <p className="text-[11px] text-white/60">{ui.charterRecSub || 'Door-to-door · driver loads all luggage · English-speaking'}</p>
                </div>
              </div>
              {recReason && (
                <div className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 mb-3">
                  <p className="text-[12px] text-white/85 leading-relaxed">⚠️ {recReason}</p>
                </div>
              )}
              <Link
                to={rec.cta_link || '/charter'}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:scale-[1.01] min-h-[44px]"
                style={{ background: BRAND.gradient.primary, boxShadow: '0 4px 16px rgba(124,92,252,0.35)' }}
              >
                {ui.bookCharter || 'Book Charter'} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}

        {/* HERO: Public transit route — only shown if RouteAgent provided ODsay data AND charter wasn't recommended */}
        {route && rec?.key !== 'cocotrip_charter' && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.12), rgba(234,83,126,0.08))', border: '1px solid rgba(124,92,252,0.30)' }}>
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-[#FBBC05]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#FBBC05]">{ui.recommended || 'Recommended'}</span>
              </div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${recMeta?.color || '#7C5CFC'}33` }}>
                  <RecIcon className="w-5 h-5" style={{ color: recMeta?.color || '#7C5CFC' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white">{recMeta?.label || ui.toHotel || 'To Hotel'}</p>
                  <p className="text-[11px] text-white/60">
                    {route.est_min}{ui.minUnit || 'min'}
                    {(route.est_fare_krw || 0) > 0 ? ` · ${formatKRW(route.est_fare_krw || 0)}` : ''}
                    {(route.transfers || 0) > 0 ? ` · ${route.transfers} ${ui.transfer || 'transfer'}` : ''}
                  </p>
                </div>
              </div>
              {recReason && (
                <p className="text-[12px] text-white/70 leading-snug mt-1.5">💡 {recReason}</p>
              )}
            </div>
            <div className="px-2 pb-3">
              <TransitArrow transit={route as TransitFromPrev & Record<string, unknown>} />
            </div>
          </div>
        )}

        {/* Vertical timeline of arrival steps */}
        <div className="relative pl-2">
          {/* Vertical connector line */}
          <div className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-[#7C5CFC]/40 via-[#7C5CFC]/15 to-transparent" />

          <div className="space-y-2.5">
            {(guide.steps || []).map((step: ArrivalStep, i: number) => {
              const Icon = STEP_ICON[step.step] || Plane;
              const isHotelStep = step.step === 5;
              return (
                <div key={i} className="relative bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-lg"
                      style={{ background: BRAND.gradient.primary }}>
                      <Icon className="w-[18px] h-[18px] text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-bold text-[#7C5CFC]/80 tracking-wider">STEP {step.step}</span>
                        {step.est_min > 0 && (
                          <span className="text-[10px] text-white/55">~{step.est_min}{ui.minUnit || 'min'}</span>
                        )}
                      </div>
                      <p className="text-[14px] font-bold text-white mt-0.5">{step.title}</p>
                      <p className="text-[12px] text-white/55 mt-1 leading-relaxed">{step.description}</p>

                      {/* Sub-options (SIM/Wi-Fi etc.) */}
                      {step.options && step.options.length > 0 && (
                        <div className="mt-2.5 space-y-1.5">
                          {step.options.map((opt: ArrivalOption, j: number) => (
                            <div key={j} className="flex items-center justify-between bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2">
                              <span className="text-[12px] text-white/75">{opt.name}</span>
                              <span className="text-[12px] font-bold text-[#7C5CFC]">{formatKRW(opt.price_krw)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Transport-to-hotel comparison grid (Step 5 — only as a comparison; actual route is in HERO above) */}
                      {isHotelStep && step.transport_to_hotel && (
                        <div className="mt-3">
                          <p className="text-[10px] text-white/55 uppercase tracking-wider mb-1.5">{ui.allOptions || 'All options'}</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(step.transport_to_hotel)
                              .filter(([, val]) => val != null)
                              .map(([key, val]: [string, TransportOption | null]) => {
                                const meta = TRANSPORT_META[key];
                                const TIcon = meta?.icon || Train;
                                const isRec = rec?.key === key;
                                return (
                                  <div key={key}
                                    className={`relative rounded-lg px-2.5 py-2 border ${isRec ? 'border-[#FBBC05]/50 bg-[#FBBC05]/[0.08]' : 'border-white/[0.06] bg-white/[0.04]'}`}>
                                    {isRec && (
                                      <span className="absolute -top-1.5 right-1.5 px-1 py-0.5 rounded text-[8px] font-bold text-black" style={{ background: '#FBBC05' }}>
                                        ★
                                      </span>
                                    )}
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <TIcon className="w-3 h-3" style={{ color: meta?.color || '#7C5CFC' }} />
                                      <p className="text-[10px] font-semibold text-white/70 uppercase">{meta?.label || key.replace(/_/g, ' ')}</p>
                                    </div>
                                    <p className="text-[13px] font-bold text-white">{formatKRW(val?.price_krw || val?.est_price_krw || 0)}</p>
                                    <p className="text-[10px] text-white/55">{val?.duration_min || '?'}{ui.minUnit || 'min'}</p>
                                    {/* P153 (2026-05-22): instruction 텍스트 표시 — 데이터엔 있는데 UI 미노출 회귀 */}
                                    {val?.instruction && (
                                      <p className="text-[10px] text-white/65 mt-1 leading-snug line-clamp-3">{val.instruction}</p>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {/* T-money load chip */}
                      {(step.t_money_recommended_load_krw || 0) > 0 && (
                        <div className="mt-2.5 inline-flex items-center gap-1.5 bg-[#7C5CFC]/15 border border-[#7C5CFC]/25 rounded-full px-3 py-1.5">
                          <Wallet className="w-3 h-3 text-[#7C5CFC]" />
                          <span className="text-[11px] font-bold text-[#7C5CFC]">{ui.tmoneyLoad || 'Load'} {formatKRW(step.t_money_recommended_load_krw || 0)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
