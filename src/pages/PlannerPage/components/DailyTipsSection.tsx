import type { PlannerDict } from '../types';
// Daily tips section -- extracted verbatim from legacy PlannerPage.tsx L752-766.
import { Lightbulb } from 'lucide-react';

export function DailyTipsSection({ tips, p }: { tips?: string[]; p: PlannerDict }) {
  if (!tips?.length) return null;
  return (
    <div className="bg-yellow-500/[0.08] border border-yellow-500/20 rounded-2xl px-4 py-3 mb-4">
      <p className="text-xs font-semibold text-yellow-400/70 uppercase tracking-widest mb-2 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> {p.dailyTipsLabel}</p>
      <ul className="space-y-1">
        {tips.map((tip, i) => (
          <li key={i} className="text-xs text-yellow-100/70 flex items-start gap-1.5">
            <span className="text-yellow-400/60 shrink-0 mt-0.5">·</span>{tip}
          </li>
        ))}
      </ul>
    </div>
  );
}
