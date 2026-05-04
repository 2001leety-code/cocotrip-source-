// RevisionReasonModal — 무료 재생성 직전 사용자에게 사유 입력 요청 (Tier 1-B 학습 루프).
// 2026-05-04: RevisionCard "Edit Preferences & Regenerate" 클릭 → 본 모달 → reason 선택 또는 skip
//   → /planner?revision=true 로 이동.
// reason 은 best-effort 로 Firestore plans/{id}.revisionReasons 에 arrayUnion (실패해도 재생성은 진행).
// 4-lang inline labels — ReportPlanModal (Tier 1-A) 패턴과 동일.
import { useState } from 'react';
import { X, RefreshCw } from 'lucide-react';

type ReasonChip = 'restaurant_bad' | 'route_far' | 'too_packed' | 'language_issue' | 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Submit & regenerate (reason=null when skipped). */
  onSubmit: (reason: string | null) => void;
  language: 'ko' | 'en' | 'ja' | 'zh';
}

interface LabelSet {
  title: string;
  subtitle: string;
  chips: Record<ReasonChip, string>;
  otherPlaceholder: string;
  skipBtn: string;
  regenerateBtn: string;
}

const LABELS: Record<'ko' | 'en' | 'ja' | 'zh', LabelSet> = {
  ko: {
    title: '왜 다시 생성하시나요? (선택)',
    subtitle: '이유를 알려주시면 더 좋은 플랜을 만들 수 있어요. 건너뛰셔도 됩니다.',
    chips: {
      restaurant_bad: '식당 별로',
      route_far: '동선 멀어요',
      too_packed: '일정 빡빡',
      language_issue: '언어 문제',
      other: '기타',
    },
    otherPlaceholder: '한 단어로 적어주세요',
    skipBtn: '건너뛰기',
    regenerateBtn: '재생성',
  },
  en: {
    title: 'Why regenerate? (optional)',
    subtitle: 'Telling us why helps improve future plans. Skipping is fine.',
    chips: {
      restaurant_bad: 'Restaurants',
      route_far: 'Route too far',
      too_packed: 'Too packed',
      language_issue: 'Language',
      other: 'Other',
    },
    otherPlaceholder: 'One word, please',
    skipBtn: 'Skip',
    regenerateBtn: 'Regenerate',
  },
  ja: {
    title: 'なぜ再生成しますか？（任意）',
    subtitle: '理由を教えてくださると今後のプラン改善に役立ちます。スキップも可能です。',
    chips: {
      restaurant_bad: 'レストラン',
      route_far: '動線が遠い',
      too_packed: '詰め込み過ぎ',
      language_issue: '言語の問題',
      other: 'その他',
    },
    otherPlaceholder: '一言でお願いします',
    skipBtn: 'スキップ',
    regenerateBtn: '再生成',
  },
  zh: {
    title: '为什么要重新生成？(可选)',
    subtitle: '告诉我们原因有助于改进行程。跳过也可以。',
    chips: {
      restaurant_bad: '餐厅不满意',
      route_far: '路线太远',
      too_packed: '行程紧凑',
      language_issue: '语言问题',
      other: '其他',
    },
    otherPlaceholder: '请用一个词',
    skipBtn: '跳过',
    regenerateBtn: '重新生成',
  },
};

export function RevisionReasonModal({ open, onClose, onSubmit, language }: Props) {
  const labels = LABELS[language] || LABELS.en;

  const [selected, setSelected] = useState<ReasonChip | null>(null);
  const [otherText, setOtherText] = useState('');

  if (!open) return null;

  const reset = () => {
    setSelected(null);
    setOtherText('');
  };

  const handleSkip = () => {
    reset();
    onSubmit(null);
  };

  const handleRegenerate = () => {
    let reason: string | null = null;
    if (selected === 'other') {
      const trimmed = otherText.trim().slice(0, 50);
      reason = trimmed.length > 0 ? trimmed : 'other';
    } else if (selected) {
      reason = selected;
    }
    reset();
    onSubmit(reason);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">{labels.title}</h2>
          </div>
          <button type="button" onClick={handleClose} className="text-white/40 hover:text-white/80" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-white/55 mb-4 leading-relaxed">{labels.subtitle}</p>

        {/* Quick-select chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(Object.keys(labels.chips) as ReasonChip[]).map((chip) => {
            const active = selected === chip;
            return (
              <button
                key={chip}
                type="button"
                onClick={() => setSelected(chip)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active
                    ? 'bg-[#7C5CFC]/25 border border-[#7C5CFC]/60 text-white'
                    : 'bg-white/[0.04] border border-white/10 text-white/70 hover:bg-white/[0.08]'
                }`}
              >
                {labels.chips[chip]}
              </button>
            );
          })}
        </div>

        {/* "Other" inline input */}
        {selected === 'other' && (
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder={labels.otherPlaceholder}
            maxLength={50}
            className="w-full px-3 py-2 mb-4 rounded-lg bg-white/[0.04] border border-white/10 focus:border-[#7C5CFC]/40 text-sm text-white/85 placeholder:text-white/30 outline-none"
          />
        )}

        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={handleSkip}
            className="flex-1 py-3 rounded-xl text-white/70 font-semibold text-sm border border-white/10 hover:bg-white/[0.05]"
          >
            {labels.skipBtn}
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            className="flex-[2] py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)' }}
          >
            <RefreshCw className="w-4 h-4" />
            {labels.regenerateBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
