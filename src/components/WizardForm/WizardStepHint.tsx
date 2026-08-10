// #wizard-step-hints (2026-06-05, 운영자 #3): 위저드 각 스텝의 비차단 친절 설명 배너.
// - 스텝 첫 도달 시 1회 자동 노출 (localStorage COCO_WIZARD_HINT_<step>).
// - 닫으면 작은 "?" 칩으로 접힘 → 언제든 다시 보기.
// - 차단 모달이 아님 (입력 흐름 방해 X) = NN/g "도움말은 단계 옆에, 작업 기억 부담 최소화".
// - 4언어 (stepHints.ts).
import { useState } from 'react';
import { Lightbulb, X, HelpCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { WIZARD_STEP_HINTS, normalizeHintLang } from './stepHints';

const SEEN_PREFIX = 'COCO_WIZARD_HINT_';

export function WizardStepHint({ step }: { step: number }) {
  const { language } = useLanguage();
  const lang = normalizeHintLang(language);
  const hint = WIZARD_STEP_HINTS[step];

  // 안 본 스텝이면 자동 노출, 본 스텝이면 접힘("?"만).
  //
  // 2026-08-04: 예전엔 이걸 useEffect 로 했다 — 첫 렌더에서 무조건 접힌 채 그렸다가
  //   effect 가 다시 열어서 매 스텝마다 렌더가 한 번 더 돌았고, 배너가 깜빡였다.
  //   호출부가 `key={step}` 으로 스텝마다 새로 마운트하므로 초기값으로 한 번에 정하면 된다.
  //   (effect 안에서 setState 하는 패턴 자체를 react-hooks/set-state-in-effect 가 잡는다.)
  const [open, setOpen] = useState<boolean>(() => {
    if (!hint) return false;
    try {
      return !localStorage.getItem(`${SEEN_PREFIX}${step}`);
    } catch {
      return false; // SSR / private mode → 안 띄움이 안전
    }
  });

  if (!hint) return null;

  const persistSeen = () => {
    try { localStorage.setItem(`${SEEN_PREFIX}${step}`, String(Date.now())); } catch { /* silent */ }
  };

  // 접힌 상태 — 작은 "?" 칩 (다시 보기)
  if (!open) {
    return (
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ec-btn ec-btn-quiet"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {hint.title[lang]}
        </button>
      </div>
    );
  }

  // 펼친 상태 — 친절 설명 배너.
  // 2026-08-10: 보라 카드 → 왼쪽 브랜드 규칙(rule) 한 줄. 차단 모달이 아니라 여백에
  // 붙은 편집자 주석처럼 읽히게 — 문구·동작·localStorage 키는 그대로다.
  return (
    <div className="mb-4 flex items-start gap-3 border-l-2 border-ec-brand pl-3" role="note">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-ec-brand" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug text-ec-ink">{hint.title[lang]}</p>
        <p className="ec-body-sm mt-1 text-ec-ink-3">{hint.body[lang]}</p>
      </div>
      <button
        type="button"
        onClick={() => { persistSeen(); setOpen(false); }}
        className="ec-btn ec-btn-quiet shrink-0"
        aria-label="Close hint"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
