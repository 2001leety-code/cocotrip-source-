/**
 * ResumeWizardModal — 24h 이내 미완 wizard 재진입 시 "이어서 / 새로 시작" 선택 모달 (B9-35).
 *
 * 사용 패턴:
 *   const snap = loadWizardSnapshot<MyValues>('planner');
 *   const [open, setOpen] = useState(!!snap);
 *   ...
 *   <ResumeWizardModal
 *     open={open}
 *     summary="Seoul · 4박 5일 · 2명"  // saved snapshot 의 입력 요약
 *     onContinue={() => { setValuesFromSnap(snap!.values); setStep(snap!.step); setOpen(false); }}
 *     onRestart={() => { clearWizardSnapshot('planner'); setOpen(false); }}
 *   />
 *
 * 2026-08-11 (Korea Editorial Concierge): 다크 보라 gradient/glass → 종이 카드로 전환.
 * 색은 전부 ec-* 토큰(docs/DESIGN-EDITORIAL-CONCIERGE.md). backdrop 클릭/Esc 로 닫히지
 * 않는 원래 동작은 그대로 유지 — 진행 데이터를 실수로 잃으면 안 되므로 사용자가
 * 두 버튼 중 하나를 명시적으로 눌러야 닫힌다. open 시 primary 버튼(이어서)으로 포커스를
 * 옮기고, 닫힐 때(open→false) 모달을 열기 전 포커스였던 요소로 되돌린다.
 * 4-lang i18n: t.resumeWizard.title / desc / continue / restart
 *
 * 2026-08-11 (a11y follow-up, PR #1278): open 동안 Tab/Shift+Tab 이 배경 페이지로
 * 빠져나가지 않도록 dialog 내부에 포커스를 가둔다(focus trap) + body 배경 스크롤 잠금.
 */
import { useEffect, useRef } from 'react';
import { Clock, RotateCcw, Play } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  /** 저장된 입력 요약 (e.g., "Seoul · 4박 5일 · 2명"). 빈 문자열이면 desc 만 노출. */
  summary?: string;
  onContinue: () => void;
  onRestart: () => void;
}

export function ResumeWizardModal({ open, summary, onContinue, onRestart }: Props) {
  const { t } = useLanguage();
  // 4-lang i18n. 키 누락 시 EN fallback.
  const r = ((t as unknown) as { resumeWizard?: Record<string, string> }).resumeWizard || {};
  const continueRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // open 시 포커스를 primary 버튼으로. 닫힐 때(cleanup) 열기 전 초점을 복원 —
  // 훅은 얼리 리턴 위에 있어야 하므로 컴포넌트 최상단에 둔다.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    continueRef.current?.focus();
    return () => {
      const el = previouslyFocusedRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [open]);

  // open 동안 Tab/Shift+Tab 을 dialog 내부로 순환시킨다(포커스 트랩). 배경으로 빠져나가면
  // (마지막에서 Tab, 첫 요소에서 Shift+Tab, 혹은 클릭 등으로 바깥에 포커스가 가 있으면)
  // 반대쪽 끝으로 되돌린다.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !card.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // open 동안 배경 스크롤 잠금. cleanup 에서 이전 값 그대로 복원 (다른 곳에서 이미
  // overflow 를 건드려 놓은 상태였어도 그 값을 보존).
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  // desc 에 {summary} placeholder 가 있을 때만 치환. 요약이 비어있으면 placeholder 제거.
  const descTemplate = r.desc || 'You filled out: {summary}';
  const desc = summary
    ? descTemplate.replace('{summary}', summary)
    : (r.descNoSummary || 'Your previous progress was saved.');

  return (
    // Backdrop — ink at low opacity, no blur (frosted glass 는 이 시스템에서 제거됨).
    <div
      className="ec-root fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(20, 20, 26, 0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-wizard-title"
      aria-describedby="resume-wizard-desc"
      // backdrop click 으로 닫지 않음 — 사용자가 명시적으로 선택해야 함 (실수로 진행 데이터 잃으면 안 됨)
    >
      <div
        ref={cardRef}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay"
      >
        {/* Header */}
        <div className="pt-8 pb-4 px-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full p-3 bg-ec-brand-wash">
              <Clock className="text-ec-brand" size={32} aria-hidden />
            </div>
          </div>
          <h2 id="resume-wizard-title" className="ec-h3">
            {r.title || 'Continue where you left off?'}
          </h2>
          <p id="resume-wizard-desc" className="ec-body-sm mt-2 break-words text-ec-ink-3">
            {desc}
          </p>
        </div>

        {/* CTAs — 위 = 이어서 (primary), 아래 = 새로 시작 (secondary) */}
        <div className="p-6 pt-2 space-y-2.5">
          <button
            ref={continueRef}
            onClick={onContinue}
            type="button"
            className="ec-btn ec-btn-primary w-full"
          >
            <Play size={16} aria-hidden />
            {r.continue || 'Continue'}
          </button>
          <button
            onClick={onRestart}
            type="button"
            className="ec-btn ec-btn-secondary w-full"
          >
            <RotateCcw size={14} aria-hidden />
            {r.restart || 'Start over'}
          </button>
        </div>
      </div>
    </div>
  );
}
