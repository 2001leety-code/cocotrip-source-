// Revision / Regenerate card.
// Extracted from PlanDetailPage/index.tsx L424-456 (zero behavior change).
// 2026-05-04 (Tier 1-B): 클릭 시 RevisionReasonModal 을 띄워 사유 수집 후 redirect.
import { useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';
import { RevisionReasonModal } from './RevisionReasonModal';

interface RevisionCardProps {
  plan: PlanDocument;
  planId: string;
  token: string | null;
}

export function RevisionCard({ plan, planId, token }: RevisionCardProps) {
  const credits = (plan.revisionCredits as number) || 0;
  const { language } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);

  if (!plan || credits <= 0) return null;

  const handleSubmit = (reason: string | null) => {
    setModalOpen(false);

    // Best-effort fire-and-forget: log reason to Firestore. Never block the regenerate flow.
    if (reason && planId) {
      const stamped = `${reason}|${new Date().toISOString()}`;
      updateDoc(doc(db, 'plans', planId), {
        revisionReasons: arrayUnion(stamped),
      }).catch((err) => {
        // Swallow — reason logging is best-effort. Regenerate must proceed regardless.
        console.warn('[RevisionCard] revisionReasons log failed (non-fatal):', err?.message || err);
      });
    }

    const params = new URLSearchParams({
      revision: 'true',
      planId: planId || '',
      ...(token ? { token } : {}),
      ...(reason ? { revisionReason: reason } : {}),
    });
    window.location.href = `/planner?${params.toString()}`;
  };

  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  return (
    <>
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
            {credits} Free Revision{credits > 1 ? 's' : ''} remaining
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
          >
            <RefreshCw className="w-4 h-4" />
            Edit Preferences & Regenerate
          </button>
        </div>
      </div>

      <RevisionReasonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        language={lang}
      />
    </>
  );
}
