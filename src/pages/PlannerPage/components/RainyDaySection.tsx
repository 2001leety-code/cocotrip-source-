// Rainy day alternative accordion -- extracted verbatim from legacy PlannerPage.tsx L771-797.
import { useState } from 'react';
import { CloudRain } from 'lucide-react';
import type { Place } from '../types';

export function RainyDaySection({ places, p }: { places: Place[]; p: any }) {
  const [open, setOpen] = useState(false);
  const alts = places.filter(pl => pl.rainyAlternative);
  if (!alts.length) return null;
  return (
    <div className="mt-4 rounded-2xl border border-blue-500/15 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-blue-500/[0.06] hover:bg-blue-500/[0.10] transition-colors">
        <span className="text-sm text-blue-300/65 font-medium flex items-center gap-1"><CloudRain className="w-4 h-4" /> {p.result_rainy}</span>
        <span className="text-white/25 text-xs">{open ? '\u25B2' : '\u25B6'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-blue-500/10">
          {alts.map((place, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-blue-400/50 shrink-0 mt-0.5 text-sm">·</span>
              <div>
                <p className="text-xs font-semibold text-blue-200/60">{place.name}</p>
                <p className="text-xs text-blue-200/40 mt-0.5 leading-relaxed">{place.rainyAlternative}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
