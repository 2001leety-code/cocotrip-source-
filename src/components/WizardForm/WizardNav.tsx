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
  // 2026-07-19 토큰 통일로 모바일/데스크톱 그라데이션 분기가 사라져 isMobile 은 쓰지 않는다.
  // prop 타입은 호출부 호환 위해 그대로 두고(WizardStep0/1/2 3곳), 여기서 꺼내 오지만 않는다.
  // (꺼내 두면 no-unused-vars 가 계속 잡는다. 타입에서 지우려면 호출부 3곳을 같이 고쳐야 하고
  //  그건 7/19 의 "호출부 호환 유지" 결정을 뒤집는 것이라 별도 건이다.)
  emphasis = 'next',
}: WizardNavProps) {
  const nextBg = disabled ? 'rgba(255,255,255,.1)' : 'var(--coco-cta-gradient)';

  return (
    <div className="flex gap-3 pt-2">
      {onPrev && (
        <button
          type="button"
          onClick={onPrev}
          aria-label={prevLabel}
          className="shrink-0 px-3 sm:px-4 py-3 rounded-full border border-white/[0.12] text-white/55 hover:text-white hover:border-white/25 text-sm font-semibold flex items-center gap-1 whitespace-nowrap transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">{prevLabel}</span>
        </button>
      )}
      {/* m-cta: 라이트 셸이 이 클래스로 흰 글자·active 보정 매칭 (var() 배경은 속성 선택자에 안 잡힘) */}
      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        aria-label={nextLabel}
        className="m-cta flex-1 min-w-0 py-3 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.03] disabled:hover:scale-100 whitespace-nowrap transition-all"
        style={{ background: nextBg, boxShadow: disabled ? undefined : 'var(--coco-cta-shadow)' }}
      >
        <span className="truncate">{nextLabel}</span>
        <ChevronRight className="w-5 h-5 shrink-0" />
      </button>
      {/* emphasis는 향후 PayPal 결제 버튼 등 별도 색 분기에 사용 가능 (현재는 동일). */}
      {emphasis === 'submit' && null}
    </div>
  );
}
