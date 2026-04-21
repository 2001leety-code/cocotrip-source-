// Per-stop card: collapsed header + expandable details (address, tip, reservation,
// ODsay public-transit route, Naver Map link). Largest leaf of PlanDetailPage.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L879-1046) during P2 Lock release.
import { useRef, useState } from 'react';
import {
  MapPin, Clock, ChevronDown, Train, Bus, Footprints,
  ExternalLink, Accessibility,
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

  return (
    <div
      ref={cardRef}
      className="bg-white/[0.04] border border-white/[0.08] rounded-xl hover:border-white/[0.15] transition-colors cursor-pointer"
      onClick={toggle}
    >
      {/* Collapsed header (always visible) */}
      <div className="flex items-center gap-3 p-4">
        <div className="text-center shrink-0">
          <p className="text-xs font-bold text-[#7C5CFC]">{stop.start_time}</p>
          <CatIcon className="w-4 h-4 text-white/30 mx-auto mt-1" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold truncate">{stop.display_name || stop.name_en || stop.name || stop.name_ko}</p>
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
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-white/40">
            <span><Clock className="w-3 h-3 inline -mt-0.5" /> {stop.stay_min}min</span>
            {(stop.entry_fee_krw ?? 0) > 0 ? <span className="text-yellow-400/70">{formatKRW(stop.entry_fee_krw ?? 0)}</span> : <span className="text-green-400/70">Free</span>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/20 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded details */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-3 border-t border-white/[0.06] space-y-3" onClick={(e) => e.stopPropagation()}>
          {(stop.name || stop.name_ko) && (stop.display_name || stop.name_en) && (stop.name || stop.name_ko) !== (stop.display_name || stop.name_en) && <p className="text-[10px] text-white/30">{stop.name || stop.name_ko}</p>}
          {stop.address && (
            <p className="text-[11px] text-white/40 flex items-center gap-1.5">
              <MapPin className="w-3 h-3 shrink-0 text-white/25" />
              {stop.address}
            </p>
          )}
          {(stop.tip || stop.tip_en) && <p className="text-xs text-white/60 leading-relaxed">{stop.tip || stop.tip_en}</p>}
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
          {(stop.recommended_items?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1.5 uppercase tracking-wider">Recommended</p>
              <div className="space-y-1">
                {stop.recommended_items!.map((item: { name: string; price_krw?: number; note?: string }, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-white/70">{item.name}</span>
                      {item.note && <span className="text-[9px] text-white/30 ml-1.5">{'\u00B7'} {item.note}</span>}
                    </div>
                    {(item.price_krw ?? 0) > 0 && <span className="text-[11px] text-[#7C5CFC] font-bold shrink-0 ml-2">{formatKRW(item.price_krw ?? 0)}</span>}
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
