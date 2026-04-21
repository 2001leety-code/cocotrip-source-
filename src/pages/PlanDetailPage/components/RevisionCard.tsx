// Revision / Regenerate card.
// Extracted from PlanDetailPage/index.tsx L424-456 (zero behavior change).
import { RefreshCw, Sparkles } from 'lucide-react';
import type { PlanDocument } from '../types';

interface RevisionCardProps {
  plan: PlanDocument;
  planId: string;
  token: string | null;
}

export function RevisionCard({ plan, planId, token }: RevisionCardProps) {
  if (!plan || (plan.revisionCredits || 0) <= 0) return null;

  return (
    <div className="mt-8 rounded-2xl overflow-hidden border border-amber-500/20"
      style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(182,104,252,0.04))' }}>
      <div className="px-5 py-5 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-bold text-white">Want a different vibe?</h3>
        </div>
        <p className="text-white/50 text-sm mb-1">
          Not 100% satisfied? Tweak your preferences and get a brand new itinerary.
        </p>
        <p className="text-amber-400/80 text-xs font-semibold mb-4">
          {plan.revisionCredits} Free Revision{plan.revisionCredits > 1 ? 's' : ''} remaining
        </p>
        <button
          onClick={() => {
            const params = new URLSearchParams({
              revision: 'true',
              planId: planId || '',
              ...(token ? { token } : {}),
            });
            window.location.href = `/planner?${params.toString()}`;
          }}
          className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
        >
          <RefreshCw className="w-4 h-4" />
          Edit Preferences & Regenerate
        </button>
      </div>
    </div>
  );
}
