// RevisionReasonModal — 무료 재생성 직전 사용자에게 사유 입력 요청 (Tier 1-B 학습 루프).
// 2026-05-04: RevisionCard "Edit Preferences & Regenerate" 클릭 → 본 모달 → reason 선택 또는 skip
//   → /planner?revision=true 로 이동.
// 2026-05-08 (W4): 7개 사유 체크박스 + 자유 입력 + plan_complaints 저장 강화.
// 2026-05-09 (B9-18): createPortal(document.body) 적용 — RevisionCard 가 SwipeContainer 의
//   framer-motion transform 컨테이너 내부에 있어서 position:fixed 가 viewport 가 아닌
//   transformed ancestor 기준으로 배치됨 (CSS 스펙). 그 결과 모달이 가끔 안 뜨거나 늦게 뜨거나
//   클릭이 안 받혀짐. AddStopModal/ReportPlanModal 은 SwipeContainer 형제로 렌더되어 무영향.
// reason 은 best-effort 로 Firestore plans/{id}.revisionReasons 에 arrayUnion (실패해도 재생성은 진행).
// 4-lang inline labels — ReportPlanModal (Tier 1-A) 패턴과 동일.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw } from 'lucide-react';

export type ReasonChip =
  | 'food_not_match'
  | 'too_packed'
  | 'too_loose'
  | 'places_dislike'
  | 'region_change'
  | 'budget_adjust'
  | 'other';

export interface RevisionReasonPayload {
  reasons: ReasonChip[];
  customNote: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Submit & regenerate (null when skipped). */
  onSubmit: (payload: RevisionReasonPayload | null) => void;
  language: 'ko' | 'en' | 'ja' | 'zh';
}

interface LabelSet {
  title: string;
  subtitle: string;
  chips: Record<ReasonChip, string>;
  customPlaceholder: string;
  skipBtn: string;
  regenerateBtn: string;
}

const LABELS: Record<'ko' | 'en' | 'ja' | 'zh', LabelSet> = {
  ko: {
    title: '왜 다시 만드시나요? (선택)',
    subtitle: '이유를 알려주시면 더 좋은 플랜을 만들 수 있어요. 건너뛰셔도 됩니다.',
    chips: {
      food_not_match: '음식이 맞지 않아요',
      too_packed:     '일정이 너무 빡빡해요',
      too_loose:      '일정이 너무 여유로워요',
      places_dislike: '활동·장소가 마음에 안 들어요',
      region_change:  '지역을 변경하고 싶어요',
      budget_adjust:  '가격대 조정 필요',
      other:          '기타',
    },
    customPlaceholder: '추가로 알려주실 내용을 적어주세요',
    skipBtn: '건너뛰기',
    regenerateBtn: '재생성',
  },
  en: {
    title: 'Why regenerate? (optional)',
    subtitle: 'Telling us why helps improve future plans. Skipping is fine.',
    chips: {
      food_not_match: 'Food doesn\'t match',
      too_packed:     'Too packed',
      too_loose:      'Too loose',
      places_dislike: 'Don\'t like the places',
      region_change:  'Want a different region',
      budget_adjust:  'Budget adjustment needed',
      other:          'Other',
    },
    customPlaceholder: 'Anything else to tell us?',
    skipBtn: 'Skip',
    regenerateBtn: 'Regenerate',
  },
  ja: {
    title: 'なぜ再生成しますか？（任意）',
    subtitle: '理由を教えてくださると今後のプラン改善に役立ちます。スキップも可能です。',
    chips: {
      food_not_match: '食事が合わない',
      too_packed:     '詰め込み過ぎ',
      too_loose:      '余裕がありすぎる',
      places_dislike: '場所・アクティビティが気に入らない',
      region_change:  '地域を変えたい',
      budget_adjust:  '予算の調整が必要',
      other:          'その他',
    },
    customPlaceholder: '他にご要望があればお書きください',
    skipBtn: 'スキップ',
    regenerateBtn: '再生成',
  },
  zh: {
    title: '为什么要重新生成？(可选)',
    subtitle: '告诉我们原因有助于改进行程。跳过也可以。',
    chips: {
      food_not_match: '餐饮不符合口味',
      too_packed:     '行程太紧凑',
      too_loose:      '行程太松散',
      places_dislike: '不喜欢这些地点',
      region_change:  '想换个地区',
      budget_adjust:  '需要调整预算',
      other:          '其他',
    },
    customPlaceholder: '还有什么想告诉我们的？',
    skipBtn: '跳过',
    regenerateBtn: '重新生成',
  },
};

const ALL_REASONS: ReasonChip[] = [
  'food_not_match',
  'too_packed',
  'too_loose',
  'places_dislike',
  'region_change',
  'budget_adjust',
  'other',
];

export function RevisionReasonModal({ open, onClose, onSubmit, language }: Props) {
  const labels = LABELS[language] || LABELS.en;

  const [selected, setSelected] = useState<Set<ReasonChip>>(new Set());
  const [customNote, setCustomNote] = useState('');

  // 진단 로그: 모달 open prop 변화를 운영자가 추적할 수 있게 함.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.log('[RevisionReasonModal] open prop changed:', open);
    }
  }, [open]);

  // ESC 키로 닫기 — UX 개선 (a11y).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const reset = () => {
    setSelected(new Set());
    setCustomNote('');
  };

  const toggleReason = (chip: ReasonChip) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  const handleSkip = () => {
    reset();
    onSubmit(null);
  };

  const handleRegenerate = () => {
    const reasons = Array.from(selected);
    const note = customNote.trim().slice(0, 300);
    reset();
    onSubmit({ reasons, customNote: note });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // createPortal: SwipeContainer 의 motion.div transform 컨테이너 + overflow-y-auto 클립을 모두 우회.
  // 사용자 신고 ("안 눌림", "잘 안 뜸", "늦게 뜸") 의 root cause 가 transformed ancestor 였음.
  // z-50 → z-[60] 으로 상향 (다른 floating 요소 충돌 방지).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="revision-reason-modal-title"
    >
      <div
        className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-amber-400" />
            <h2 id="revision-reason-modal-title" className="text-lg font-bold text-white">{labels.title}</h2>
          </div>
          <button type="button" onClick={handleClose} className="text-white/40 hover:text-white/80" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-white/55 mb-4 leading-relaxed">{labels.subtitle}</p>

        {/* Multi-select chips (복수 선택) */}
        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_REASONS.map((chip) => {
            const active = selected.has(chip);
            return (
              <button
                key={chip}
                type="button"
                onClick={() => toggleReason(chip)}
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

        {/* 자유 입력 (항상 표시 — 선택 선택) */}
        <textarea
          value={customNote}
          onChange={(e) => setCustomNote(e.target.value)}
          placeholder={labels.customPlaceholder}
          maxLength={300}
          rows={2}
          className="w-full px-3 py-2 mb-4 rounded-lg bg-white/[0.04] border border-white/10 focus:border-[#7C5CFC]/40 text-sm text-white/85 placeholder:text-white/30 outline-none resize-none"
        />

        <div className="flex gap-2 mt-1">
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
    </div>,
    document.body,
  );
}
