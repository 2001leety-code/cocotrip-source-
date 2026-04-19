// Transit segment between two stops (method, duration, fare, optional step-by-step).
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L854-877) during P2 Lock release.
import { useState } from 'react';
import { Car, ChevronDown } from 'lucide-react';
import { TRANSIT_ICON, formatKRW } from '../constants';

export function TransitArrow({ transit }: { transit: any }) {
  const Icon = TRANSIT_ICON[transit.method] || Car;
  const [showSteps, setShowSteps] = useState(false);
  return (
    <div className="ml-4 my-1">
      <button onClick={() => transit.step_by_step?.length && setShowSteps(!showSteps)} className="flex items-center gap-2 text-[11px] text-white/40 hover:text-white/60 transition-colors">
        <div className="w-0.5 h-4 bg-[#7C5CFC]/30" />
        <Icon className="w-3.5 h-3.5 text-[#7C5CFC]" />
        {transit.from_label && <span className="text-[#7C5CFC] font-semibold">{transit.from_label} {'\u2192'}</span>}
        <span>{transit.method} - {transit.est_min}min</span>
        {transit.est_fare_krw > 0 && <span className="text-[#7C5CFC]">{formatKRW(transit.est_fare_krw)}</span>}
        {transit.step_by_step?.length > 0 && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>
      {(transit.instruction_en || transit.instruction) && <p className="text-[10px] text-white/25 ml-6 mt-0.5">{transit.instruction_en || transit.instruction}</p>}
      {showSteps && transit.step_by_step && (
        <div className="ml-6 mt-1 space-y-0.5">
          {transit.step_by_step.map((s: string, i: number) => (
            <p key={i} className="text-[10px] text-white/35">{i + 1}. {s}</p>
          ))}
        </div>
      )}
    </div>
  );
}
