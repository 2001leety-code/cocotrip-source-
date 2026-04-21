// Enriching banner -- extracted verbatim from legacy PlannerPage.tsx L802-818.
import { UtensilsCrossed } from 'lucide-react';

export function EnrichingBanner({ visible, p }: { visible: boolean; p: PlannerDict }) {
  if (!visible) return null;
  return (
    <div className="rounded-2xl border border-[rgba(196,149,106,.25)] overflow-hidden mb-6"
      style={{ background: 'rgba(196,149,106,0.06)', opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease' }}>
      <div className="relative h-0.5 bg-white/8 overflow-hidden">
        <div className="absolute h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #C4956A, #D4915C)', animation: 'indeterminate 2.1s cubic-bezier(.65,.815,.735,.395) infinite' }} />
        <div className="absolute h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #C4956A, #D4915C)', animation: 'indeterminate2 2.1s cubic-bezier(.5,.3,.1,.7) infinite 1.15s' }} />
      </div>
      <p className="text-xs text-[#C4956A]/80 text-center py-3 font-medium">
        <UtensilsCrossed className="w-3.5 h-3.5 inline" /> {p.enriching_message}
      </p>
    </div>
  );
}
