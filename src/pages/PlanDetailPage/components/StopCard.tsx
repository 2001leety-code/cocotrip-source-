// Per-stop card: collapsed header + expandable details (address, tip, reservation,
// ODsay public-transit route, Naver Map link). Largest leaf of PlanDetailPage.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L879-1046) during P2 Lock release.
import { useRef, useState } from 'react';
import {
  MapPin, Clock, ChevronDown, Train, Bus, Footprints,
  ExternalLink, Accessibility, AlertTriangle,
} from 'lucide-react';
import { CAT_ICON, formatKRW } from '../constants';
import type { PlanStop } from '../types';
import { getPlanDetailUI } from '../types';
import { useLanguage } from '@/hooks/useLanguage';

export function StopCard({ stop }: { stop: PlanStop }) {
  const { t } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [expanded, setExpanded] = useState(true);
  const CatIcon = CAT_ICON[stop.category || ''] || MapPin;
  const cardRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && cardRef.current) {
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  };

  // ODsay public-transit data (if available from RouteAgent)
  const publicTransit = stop.travelFromPrev?.transitOptions?.publicTransit;

  // Show an "Unverified" warning only for food stops that the DB matcher
  // explicitly failed to match. Non-food stops leave `verified` undefined
  // and must not display the badge.
  const isUnverifiedFood = stop.category === 'food' && stop.verified === false;

  return (
    <div
      ref={cardRef}
      className="relative bg-white/[0.04] border border-white/[0.08] rounded-xl hover:border-[#7C5CFC]/35 hover:bg-white/[0.06] transition-all cursor-pointer overflow-hidden"
      onClick={toggle}
    >
      {/* Left accent bar — visual anchor that ties the time to the card */}
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
        style={{ background: 'linear-gradient(180deg,#7C5CFC,#EA537E)' }} />

      {/* Collapsed header */}
      <div className="flex items-start gap-3 sm:gap-3.5 p-3.5 sm:p-4 pl-4 sm:pl-5">
        {/* Time + category — clearer hierarchy, time is the anchor */}
        <div className="text-center shrink-0">
          <p className="text-[14px] sm:text-[15px] font-extrabold text-[#B9A4FF] leading-none">{stop.start_time}</p>
          <div className="mt-1.5 w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto">
            <CatIcon className="w-3.5 h-3.5 text-white/55" />
          </div>
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[15px] sm:text-base font-bold text-white leading-snug">{stop.display_name || stop.name_en || stop.name || stop.name_ko}</p>
            {stop.local_tag && (() => {
              const tagConfig: Record<string, { bg: string; text: string; emoji: string }> = {
                'Local Pick': { bg: 'bg-purple-500/20 border-purple-500/30', text: 'text-purple-300', emoji: '\u{1F4CD}' },
                'Hidden Gem': { bg: 'bg-emerald-500/20 border-emerald-500/30', text: 'text-emerald-300', emoji: '\u{1F48E}' },
                'Bakery Pilgrimage': { bg: 'bg-amber-500/20 border-amber-500/30', text: 'text-amber-300', emoji: '\u{1F950}' },
                'Blue Ribbon': { bg: 'bg-blue-500/20 border-blue-500/30', text: 'text-blue-300', emoji: '\u{1F3C5}' },
              };
              const cfg = tagConfig[stop.local_tag] || { bg: 'bg-white/10 border-white/20', text: 'text-white/60', emoji: '\u2B50' };
              return <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${cfg.bg} ${cfg.text}`}>{cfg.emoji} {stop.local_tag}</span>;
            })()}
            {isUnverifiedFood && (
              <span
                title={ui.unverifiedHint || 'Not in our verified DB — double-check before visiting.'}
                className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border bg-amber-500/15 border-amber-500/35 text-amber-300"
              >
                <AlertTriangle className="w-2.5 h-2.5" /> {ui.unverifiedBadge || 'Unverified'}
              </span>
            )}
          </div>
          {/* Korean name as subtle subtitle (when display_name is in another language) */}
          {(stop.name || stop.name_ko) && (stop.display_name || stop.name_en) && (stop.name || stop.name_ko) !== (stop.display_name || stop.name_en) && (
            <p className="text-[11px] text-white/40 mt-0.5">{stop.name || stop.name_ko}</p>
          )}
          {/* Meta chips — pill-style for scannability */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1 bg-white/[0.05] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[10px] text-white/65">
              <Clock className="w-2.5 h-2.5" /> {stop.stay_min}{ui.minUnit || 'min'}
            </span>
            {(stop.entry_fee_krw || 0) > 0 ? (
              <span className="inline-flex items-center gap-1 bg-yellow-400/10 border border-yellow-400/25 rounded-md px-1.5 py-0.5 text-[10px] text-yellow-200 font-semibold">
                {formatKRW(stop.entry_fee_krw || 0)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-emerald-400/10 border border-emerald-400/25 rounded-md px-1.5 py-0.5 text-[10px] text-emerald-200 font-semibold">
                {ui.free || 'Free'}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 shrink-0 mt-1 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded details */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-3.5 pb-3.5 pt-3 sm:px-5 sm:pb-4 sm:pt-3.5 border-t border-white/[0.06] space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* Korean subtitle moved to collapsed header to avoid duplication */}
          {stop.address && (
            <p className="text-[12px] text-white/55 flex items-start gap-1.5 leading-relaxed">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-[#7C5CFC]/70 mt-0.5" />
              <span>{stop.address}</span>
            </p>
          )}
          {stop.personalization_reasoning && (
            <div className="bg-[#7C5CFC]/[0.08] border border-[#7C5CFC]/25 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-bold text-[#B668FC] uppercase tracking-wider mb-1">{ui.whyChose || 'Why this for you'}</p>
              <p className="text-[12px] text-white/85 leading-relaxed">{stop.personalization_reasoning}</p>
            </div>
          )}
          {(stop.tip || stop.tip_en) && (
            <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-bold text-amber-300 uppercase tracking-wider mb-1">{ui.tip || 'Tip'}</p>
              <p className="text-[12px] text-white/85 leading-relaxed">{stop.tip || stop.tip_en}</p>
            </div>
          )}
          {isUnverifiedFood && (
            <p className="text-[10px] text-amber-300/80 flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{ui.unverifiedHint || 'Not in our verified DB — double-check the address before visiting.'}</span>
            </p>
          )}
          {stop.entry_fee_note && <p className="text-[10px] text-yellow-400/60">{stop.entry_fee_note}</p>}

          {/* Reservation info */}
          {stop.reservation_required && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <p className="text-[11px] text-orange-400/80 font-semibold">Reservation required</p>
              {stop.reservation_note && <p className="text-[10px] text-orange-400/60 mt-0.5">{stop.reservation_note}</p>}
              <div className="flex gap-3 mt-1">
                {stop.reservation_phone && (
                  <a href={`tel:${stop.reservation_phone}`} className="text-[10px] text-orange-400/70 underline">{stop.reservation_phone}</a>
                )}
                {stop.reservation_url && (
                  <a href={stop.reservation_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-400/70 underline flex items-center gap-0.5">
                    <ExternalLink className="w-2.5 h-2.5" /> Book online
                  </a>
                )}
              </div>
            </div>
          )}

          {stop.accessibility_note && (
            <p className="text-[10px] text-blue-400/70 flex items-center gap-1">
              <Accessibility className="w-3 h-3" /> {stop.accessibility_note}
            </p>
          )}

          {/* Recommended items */}
          {(stop.recommended_items?.length || 0) > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Recommended</p>
              <div className="space-y-1">
                {stop.recommended_items!.map((item: { name: string; price_krw?: number; note?: string }, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-white/70">{item.name}</span>
                      {item.note && <span className="text-[9px] text-white/30 ml-1.5">{'\u00B7'} {item.note}</span>}
                    </div>
                    {(item.price_krw || 0) > 0 && <span className="text-[11px] text-[#7C5CFC] font-bold shrink-0 ml-2">{formatKRW(item.price_krw || 0)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ODsay public-transit route (real transit data) */}
          {publicTransit && publicTransit.method !== 'walk' && (
            <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Train className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-[11px] font-bold text-blue-400">Public Transit Route</p>
                <span className="ml-auto text-[10px] text-white/40">{publicTransit.duration}min {'\u00B7'} {formatKRW(publicTransit.fare)}</span>
              </div>
              {publicTransit.steps?.length > 0 && (
                <div className="space-y-1">
                  {publicTransit.steps.map((step: { mode?: string; description?: string }, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      {step.mode === 'subway' && <Train className="w-3 h-3 text-blue-400/70 shrink-0" />}
                      {step.mode === 'bus' && <Bus className="w-3 h-3 text-green-400/70 shrink-0" />}
                      {step.mode === 'walk' && <Footprints className="w-3 h-3 text-white/30 shrink-0" />}
                      <span className={step.mode === 'walk' ? 'text-white/30' : 'text-white/60'}>{step.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {publicTransit.transfers > 0 && (
                <p className="text-[9px] text-white/25 mt-1.5">Transfers: {publicTransit.transfers}</p>
              )}
            </div>
          )}

          {/* Naver Map link - coordinate-based URL preferred for accuracy */}
          {(() => {
            // 1. RouteAgent-provided URL (most accurate)
            if (stop.naverMapUrl) {
              return (
                <a href={stop.naverMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
                </a>
              );
            }
            // 2. lat/lng available -> build coordinate URL
            if (stop.lat && stop.lng) {
              const coordUrl = `https://map.naver.com/v5/search/${encodeURIComponent(stop.name || stop.name_ko || stop.display_name || stop.name_en || '')}?c=${stop.lng},${stop.lat},15,0,0,0,dh`;
              return (
                <a href={coordUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
                </a>
              );
            }
            // 3. Fallback: district-prefixed name search (higher accuracy than name alone)
            const nameKo = (stop.name || stop.name_ko || '').replace(/\s*\(.*\)\s*/g, '').trim();
            // Extract district ("gu") from address, e.g. "Jongno-gu"
            const addrMatch = (stop.address || '').match(/([\uAC00-\uD7A3]+\uAD6C)/);
            const district = addrMatch ? addrMatch[1] : '';
            const searchQuery = district ? `${district} ${nameKo}` : (nameKo || stop.display_name || stop.name_en || '');
            const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(searchQuery)}`;
            return (
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
                <ExternalLink className="w-3 h-3" /> {ui.openNaverMap || 'Open in Naver Map'}
              </a>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
