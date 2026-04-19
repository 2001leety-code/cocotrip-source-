// Transport method badge between timeline places.
// Extracted verbatim from legacy PlannerPage.tsx L266-300.
import { Car, Briefcase } from 'lucide-react';
import { TRANSPORT_ICON_MAP } from '../constants';
import type { TransportToNext } from '../types';

export function TransportBadge({ transport, p }: { transport: TransportToNext; p: any }) {
  const icon = TRANSPORT_ICON_MAP[transport.method] ?? TRANSPORT_ICON_MAP.default;
  const isCharter = transport.charterRecommended === 'yes';
  return (
    <div className="flex items-start gap-3 pl-[22px] py-1.5">
      <div className="flex flex-col items-center shrink-0 mt-1">
        {[0,1,2,3].map(i => <div key={i} className="w-px h-1.5 bg-white/15 my-px" />)}
      </div>
      <div className="flex flex-col gap-1.5 flex-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-white/45 bg-white/[0.04] border border-white/[0.08] px-3 py-1.5 rounded-full w-fit">
          {icon}
          <span>{transport.detail}</span>
          <span className="text-white/25">·</span>
          <span className="text-[#C4956A]/80 font-medium">{transport.costKRW}</span>
          {transport.durationMin > 0 && <>
            <span className="text-white/25">·</span>
            <span className="text-white/40">{transport.durationMin}{p.minuteUnit}</span>
          </>}
        </span>
        {transport.fatigueComment && (
          <div className="flex items-start gap-1.5 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2 max-w-sm">
            <Briefcase className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/65 leading-relaxed">{transport.fatigueComment}</p>
          </div>
        )}
        {isCharter && transport.charterReason && (
          <div className="flex items-start gap-1.5 bg-blue-500/8 border border-blue-500/15 rounded-lg px-3 py-2 max-w-sm">
            <Car className="w-3.5 h-3.5 text-blue-400/80 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-200/65 leading-relaxed">{transport.charterReason}</p>
          </div>
        )}
      </div>
    </div>
  );
}
