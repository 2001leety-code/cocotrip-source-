// Transit segment between two stops (method, duration, fare, optional step-by-step).
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L854-877) during P2 Lock release.
// Layer 5: step_by_step default open for subway/bus, _downgraded_from badge, _stale badge.
import { useState } from 'react';
import { Car, ChevronDown, Bus, Train, AlertTriangle } from 'lucide-react';
import { TRANSIT_ICON, formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { TransitFromPrev } from '@/types/plan';

export function TransitArrow({ transit }: { transit: TransitFromPrev & Record<string, unknown> }) {
  const { t } = useLanguage();
  const pd = (t as any).planDetail || {};
  const trKeys = pd.transit || {};
  const Icon = TRANSIT_ICON[transit.method] || Car;
  const isPublicTransit = transit.method === 'subway' || transit.method === 'bus';
  const [showSteps, setShowSteps] = useState(isPublicTransit);
  const hasSteps = Array.isArray(transit.step_by_step) && transit.step_by_step.length > 0;
  const isDowngraded = !!transit._downgraded_from;
  const isStale = !!transit._stale;

  return (
    <div className="ml-4 my-1">
      <button onClick={() => hasSteps && setShowSteps(!showSteps)} className="flex items-center gap-2 text-[11px] text-white/40 hover:text-white/60 transition-colors">
        <div className="w-0.5 h-4 bg-[#7C5CFC]/30" />
        <Icon className="w-3.5 h-3.5 text-[#7C5CFC]" />
        {transit.from_label && <span className="text-[#7C5CFC] font-semibold">{transit.from_label} {'\u2192'}</span>}
        <span>{transit.method} - {transit.est_min}min</span>
        {transit.est_fare_krw > 0 && <span className="text-[#7C5CFC]">{formatKRW(transit.est_fare_krw)}</span>}
        {hasSteps && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>

      {isDowngraded && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.publicTransitUnavailable || 'Public transit unavailable'}</span>
        </div>
      )}

      {isStale && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.routeStale || (pd.editor && pd.editor.routeStale) || 'Route may have changed'}</span>
        </div>
      )}

      {(transit.instruction_en || transit.instruction) && <p className="text-[10px] text-white/25 ml-6 mt-0.5 whitespace-pre-line">{transit.instruction_en || transit.instruction}</p>}
      {showSteps && hasSteps && (
        <div className="ml-6 mt-1 space-y-0.5">
          {transit.step_by_step.map((s: string, i: number) => {
            const StepIcon = transit.method === 'bus' ? Bus : Train;
            return (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-white/35">
                <StepIcon className="w-3 h-3 mt-0.5 text-[#7C5CFC]/60 flex-shrink-0" />
                <span>{i + 1}. {s}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
