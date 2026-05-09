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
 * 디자인은 AIIntroModal 과 일관성 유지 (다크 그라데이션, lucide 아이콘, Tailwind).
 * 4-lang i18n: t.resumeWizard.title / desc / continue / restart
 */
import { Clock, RotateCcw, Play } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

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
  const r = ((t as unknown) as { resumeWizard?: Record<string, string> }).resumeWizard ?? {};

  if (!open) return null;

  // desc 에 {summary} placeholder 가 있을 때만 치환. 요약이 비어있으면 placeholder 제거.
  const descTemplate = r.desc ?? 'You filled out: {summary}';
  const desc = summary
    ? descTemplate.replace('{summary}', summary)
    : (r.descNoSummary ?? 'Your previous progress was saved.');

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-wizard-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #1a1b2e 0%, #16213e 60%, #0f3460 100%)' }}
        // backdrop click 으로 닫지 않음 — 사용자가 명시적으로 선택해야 함 (실수로 진행 데이터 잃으면 안 됨)
      >
        {/* Header */}
        <div className="pt-8 pb-4 px-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full p-3" style={{ background: 'rgba(124,92,252,0.25)' }}>
              <Clock className="text-[#a78bfa]" size={32} />
            </div>
          </div>
          <h2 id="resume-wizard-title" className="text-white font-bold text-xl leading-tight">
            {r.title ?? 'Continue where you left off?'}
          </h2>
          <p className="text-white/70 text-sm mt-2 leading-relaxed">
            {desc}
          </p>
        </div>

        {/* CTAs — 위 = 이어서 (primary), 아래 = 새로 시작 (secondary) */}
        <div className="p-6 pt-2 space-y-2.5">
          <button
            onClick={onContinue}
            type="button"
            className="w-full rounded-xl py-3 font-semibold text-white text-sm transition-opacity hover:opacity-90 active:opacity-75 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #7c5cfc, #6d28d9)' }}
          >
            <Play size={16} />
            {r.continue ?? 'Continue'}
          </button>
          <button
            onClick={onRestart}
            type="button"
            className="w-full rounded-xl py-2.5 font-medium text-white/70 hover:text-white text-sm transition-colors flex items-center justify-center gap-2"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <RotateCcw size={14} />
            {r.restart ?? 'Start over'}
          </button>
        </div>
      </div>
    </div>
  );
}
