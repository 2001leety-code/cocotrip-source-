// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip — WizardForm 공통 하단 네비게이션
// 모바일: Back 아이콘만(shrink-0) + Next는 다음 단계 텍스트(flex-1)
// 데스크톱: Back 아이콘+텍스트 + Next 풀라벨, 둘 다 유연 폭
// 라벨 길이 무관하게 일관된 크기 비율 보장.
// ─────────────────────────────────────────────────────────────────────────────
import { ChevronLeft, ChevronRight } from 'lucide-react';

type WizardNavProps = {
  /** Back 클릭 핸들러. 없으면 Back 버튼 비표시. */
  onPrev?: () => void;
  /** Next/Submit 클릭 핸들러. */
  onNext: () => void;
  /** Next 버튼 라벨 (필수, 단계 i18n에서 주입). */
  nextLabel: string;
  /** Back 라벨 (i18n `planner_prev` 기본값). 데스크톱에서만 노출, 모바일은 아이콘만. */
  prevLabel?: string;
  /** Next 비활성 (예: 필수 입력 미완료). */
  disabled?: boolean;
  /** 모바일 그라데이션 색상 분기 (기존 step 패턴 동일). */
  isMobile: boolean;
  /** Next 버튼이 결제/생성 같은 강조형이면 true (color는 동일, 의미만 명확화). */
  emphasis?: 'next' | 'submit';
};

export function WizardNav({
  onPrev,
  onNext,
  nextLabel,
  prevLabel = 'Back',
  disabled = false,
  isMobile,
  emphasis = 'next',
}: WizardNavProps) {
  const nextBg = disabled
    ? 'rgba(255,255,255,.1)'
    : isMobile
      ? 'linear-gradient(135deg,#B668FC,#FF6B9D)'
      : 'linear-gradient(135deg,#7C5CFC,#EA537E)';

  return (
    <div className="flex gap-3 pt-2">
      {onPrev && (
        <button
          type="button"
          onClick={onPrev}
          aria-label={prevLabel}
          className="shrink-0 px-3 sm:px-4 py-3 rounded-xl border border-white/[0.12] text-white/55 hover:text-white hover:border-white/25 text-sm font-semibold flex items-center gap-1 whitespace-nowrap transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">{prevLabel}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        aria-label={nextLabel}
        className="flex-1 min-w-0 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.03] disabled:hover:scale-100 whitespace-nowrap transition-all"
        style={{ background: nextBg }}
      >
        <span className="truncate">{nextLabel}</span>
        <ChevronRight className="w-5 h-5 shrink-0" />
      </button>
      {/* emphasis는 향후 PayPal 결제 버튼 등 별도 색 분기에 사용 가능 (현재는 동일). */}
      {emphasis === 'submit' && null}
    </div>
  );
}
