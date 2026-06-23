// Day-1 free-preview stop card (B3b). The pre-purchase quick preview only has a
// markdown table (Time | Spot | Tip) — NO coordinates, photos, transit or
// addresses (that data is generated only after purchase). So this card reuses
// the FULL-plan StopCard's expandable look-and-feel (collapsed chevron → expand
// to tip + map buttons) but renders ONLY the fields the preview genuinely has.
// Missing fields degrade gracefully — never fabricated.
//
// Map buttons are buildable from the spot name alone (Naver/Google search), so
// they work even without coordinates.
import { useState } from 'react';
import { ChevronDown, MapPin, ExternalLink, Navigation, Lightbulb } from 'lucide-react';
import { buildMapLinks } from '@/pages/PlanDetailPage/lib/mapLinks';
import type { PlannerDict } from '../types';
import type { PreviewStop } from '../lib/previewTable';

export function PreviewStopCard({ stop, p, isMobile }: { stop: PreviewStop; p: PlannerDict; isMobile: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const pp = p as unknown as Record<string, string>;
  // Map links from the spot name (search-based; no coords needed).
  const links = buildMapLinks({ name: stop.name, display_name: stop.name });
  const accent = isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); }
      }}
      className="relative bg-white/[0.04] border border-white/[0.08] rounded-xl hover:border-[#7C5CFC]/50 hover:bg-white/[0.07] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] transition-[border-color,background-color,transform] duration-200 cursor-pointer overflow-hidden"
    >
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r" style={{ background: isMobile ? '#B668FC' : '#7C5CFC' }} />

      {/* Collapsed header */}
      <div className="flex items-start gap-3 p-3.5 pl-4">
        {stop.time && (
          <div className="text-center shrink-0">
            <p className="text-[14px] font-extrabold text-[#B9A4FF] leading-none">{stop.time}</p>
            <div className="mt-1.5 w-7 h-7 rounded-full bg-[#7C5CFC]/12 border border-[#7C5CFC]/25 flex items-center justify-center mx-auto">
              <MapPin className={`w-3.5 h-3.5 ${accent}`} />
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-white leading-snug">{stop.name}</p>
          {stop.tip && !expanded && (
            <p className="text-[12px] text-white/55 mt-1 line-clamp-1">{stop.tip}</p>
          )}
        </div>
        {/* B5: 펼침 안내 — 카드가 확장된다는 affordance. */}
        <div className="flex items-center gap-1 shrink-0 mt-1">
          {!expanded && (
            <span className="text-[10px] sm:text-[11px] text-white/40 font-medium whitespace-nowrap">
              {pp.viewDetails || '상세정보 보기'}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-white/55 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expanded details */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-3.5 pb-3.5 pt-3 border-t border-white/[0.06] space-y-3" onClick={(e) => e.stopPropagation()}>
          {stop.tip && (
            <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-lg px-3 py-2.5">
              <p className="text-[13px] font-bold text-amber-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Lightbulb className="w-3 h-3" /> {pp.previewTipLabel || '팁'}
              </p>
              <p className="text-[14px] text-white/85 leading-relaxed">{stop.tip}</p>
            </div>
          )}
          {/* Map buttons — work from the spot name alone. */}
          <div className="flex flex-wrap gap-2">
            <a
              href={links.google}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-blue-300/80 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 rounded-lg px-3 py-2 transition-colors"
            >
              <Navigation className="w-3 h-3" /> {pp.openGoogleMap || 'Google 지도'}
            </a>
            <a
              href={links.naver}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center min-h-[44px] gap-1.5 text-[13px] text-green-400/70 hover:text-green-400 bg-green-500/10 rounded-lg px-3 py-2"
            >
              <ExternalLink className="w-3 h-3" /> {pp.openNaverMap || '네이버 지도 열기'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
