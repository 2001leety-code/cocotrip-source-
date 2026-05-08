// Revision / Regenerate card.
// Extracted from PlanDetailPage/index.tsx L424-456 (zero behavior change).
// 2026-05-04 (Tier 1-B): 클릭 시 RevisionReasonModal 을 띄워 사유 수집 후 redirect.
// 2026-05-08 (W4): revisionCredits=0 안내 카드 + 7개 사유 + plan_complaints 저장 + avoidList.
import { useState } from 'react';
import { RefreshCw, Sparkles, Lock } from 'lucide-react';
import { doc, updateDoc, arrayUnion, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';
import { RevisionReasonModal, type RevisionReasonPayload } from './RevisionReasonModal';

interface RevisionCardProps {
  plan: PlanDocument;
  planId: string;
  token: string | null;
}

// 4-lang i18n for exhausted state
const EXHAUSTED_LABELS: Record<'ko' | 'en' | 'ja' | 'zh', { title: string; desc: string; wa: string }> = {
  ko: {
    title: '무료 재생성 모두 사용됨',
    desc: '추가 재생성은 WhatsApp으로 문의해주세요.',
    wa: 'WhatsApp 문의',
  },
  en: {
    title: 'Free Revisions Used Up',
    desc: 'All free regenerations have been used. Contact us via WhatsApp for more.',
    wa: 'Contact via WhatsApp',
  },
  ja: {
    title: '無料再生成回数を使い切りました',
    desc: '追加の再生成はWhatsAppでお問い合わせください。',
    wa: 'WhatsAppで問い合わせ',
  },
  zh: {
    title: '免费重新生成次数已用完',
    desc: '如需额外重新生成，请通过WhatsApp联系我们。',
    wa: 'WhatsApp联系',
  },
};

export function RevisionCard({ plan, planId, token }: RevisionCardProps) {
  // `?? 0` instead of `|| 0`: revisionCredits=0 is falsy, but 0 is a valid exhausted state.
  // Old `|| 0` caused: plan with credits=0 → treated same as credits=undefined → card hidden
  // with no explanation. Now we show the exhausted-state card when credits===0 explicitly.
  const credits = (plan.revisionCredits as number) ?? 0;
  const { language } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);

  if (!plan) return null;

  // Exhausted state — revisionCredits is exactly 0 (not undefined/null which would also be 0 via ??)
  // Only show exhausted card if plan.revisionCredits was explicitly set (i.e. plan paid & used up)
  const creditsExplicitlySet = typeof plan.revisionCredits === 'number';
  if (credits <= 0) {
    // If revisionCredits was never set (undefined), don't show anything (legacy plans)
    if (!creditsExplicitlySet) return null;
    // Show exhausted-state card
    const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
    const L = EXHAUSTED_LABELS[lang];
    return (
      <div className="mt-8 rounded-2xl overflow-hidden border border-white/10"
        style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="px-5 py-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-white/40" />
            <h3 className="text-sm font-semibold text-white/60">{L.title}</h3>
          </div>
          <p className="text-white/40 text-xs mb-3">{L.desc}</p>
          <a
            href="https://wa.me/821087140611"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white/70 border border-white/10 hover:bg-white/[0.06] transition-all"
          >
            {L.wa}
          </a>
        </div>
      </div>
    );
  }

  const handleSubmit = (payload: RevisionReasonPayload | null) => {
    setModalOpen(false);

    const hasContent = payload && (
      (payload.reasons && payload.reasons.length > 0) ||
      (payload.customNote && payload.customNote.length > 0)
    );

    // Best-effort fire-and-forget: log reasons to Firestore. Never block the regenerate flow.
    if (hasContent && planId) {
      const { reasons, customNote } = payload!;
      const stamped = JSON.stringify({ reasons, customNote, ts: new Date().toISOString() });
      updateDoc(doc(db, 'plans', planId), {
        revisionReasons: arrayUnion(stamped),
      }).catch((err) => {
        console.warn('[RevisionCard] revisionReasons log failed (non-fatal):', err?.message || err);
      });

      // Also write to plan_complaints for operator-todo cron + admin visibility.
      // type='revision' distinguishes from quality reports (type='quality_report').
      addDoc(collection(db, 'plan_complaints'), {
        planId,
        type: 'revision',
        reasons,
        customNote: (customNote || '').slice(0, 300),
        uid: (plan as { uid?: string }).uid || null,
        userEmail: (plan as { guestEmail?: string }).guestEmail || null,
        status: 'open',
        createdAt: serverTimestamp(),
      }).catch((err) => {
        console.warn('[RevisionCard] plan_complaints write failed (non-fatal):', err?.message || err);
      });
    }

    // Build URL params — collect all previous stop names for server-side avoid logic.
    const allStopNames: string[] = [];
    for (const day of (plan.itinerary?.days || [])) {
      for (const stop of (day.stops || [])) {
        if (stop.name) allStopNames.push(stop.name);
      }
    }
    const avoidListStr = allStopNames.slice(0, 30).join(',');

    const reasonParam = payload?.reasons?.join(',') || '';
    const noteParam = payload?.customNote || '';
    const params = new URLSearchParams({
      revision: 'true',
      planId: planId || '',
      ...(token ? { token } : {}),
      ...(reasonParam ? { revisionReason: reasonParam } : {}),
      ...(noteParam ? { revisionNote: noteParam } : {}),
      ...(avoidListStr ? { avoidList: avoidListStr } : {}),
    });
    window.location.href = `/planner?${params.toString()}`;
  };

  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  const CARD_LABELS: Record<typeof lang, { title: string; desc: string; cta: string; remaining: (n: number) => string }> = {
    ko: {
      title: '다른 분위기로 바꿔볼까요?',
      desc: '100% 만족하지 못하셨나요? 이유를 알려주시면 완전히 새로운 일정을 만들어드려요.',
      cta: '다시 만들기',
      remaining: (n) => `무료 재생성 ${n}회 남음`,
    },
    en: {
      title: 'Want a different vibe?',
      desc: "Not 100% satisfied? Tell us why and we'll create a brand new itinerary.",
      cta: 'Edit & Regenerate',
      remaining: (n) => `${n} Free Revision${n > 1 ? 's' : ''} remaining`,
    },
    ja: {
      title: '違うプランを試しますか？',
      desc: '100%満足できませんでしたか？理由を教えていただければ、全く新しいプランを作ります。',
      cta: '再生成する',
      remaining: (n) => `無料再生成 残り${n}回`,
    },
    zh: {
      title: '想要不同风格的行程吗？',
      desc: '不完全满意？告诉我们原因，我们将为您创建全新行程。',
      cta: '重新生成',
      remaining: (n) => `剩余 ${n} 次免费重新生成`,
    },
  };
  const lbl = CARD_LABELS[lang];

  return (
    <>
      <div className="mt-8 rounded-2xl overflow-hidden border border-amber-500/20"
        style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(182,104,252,0.04))' }}>
        <div className="px-5 py-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">{lbl.title}</h3>
          </div>
          <p className="text-white/50 text-sm mb-1">{lbl.desc}</p>
          <p className="text-amber-400/80 text-xs font-semibold mb-4">
            {lbl.remaining(credits)}
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}
          >
            <RefreshCw className="w-4 h-4" />
            {lbl.cta}
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
