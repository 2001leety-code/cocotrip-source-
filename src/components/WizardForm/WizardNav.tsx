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
  return (
    // 2026-08-10: 알약 그라데이션 버튼 + hover 확대 → editorial 버튼(4px 라운드, 단색
    // 브랜드, 하이라인 보조). `m-cta` 는 다크 위저드를 모바일에서 흰색으로 되돌리던
    // `!important` cascade 의 훅이었고, 그 cascade 와 함께 사라졌다.
    <div className="flex gap-3 pt-5">
      {onPrev && (
        <button
          type="button"
          onClick={onPrev}
          aria-label={prevLabel}
          className="ec-btn ec-btn-secondary shrink-0"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{prevLabel}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        aria-label={nextLabel}
        className="ec-btn ec-btn-primary min-w-0 flex-1"
      >
        <span className="truncate">{nextLabel}</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      {/* emphasis는 향후 PayPal 결제 버튼 등 별도 색 분기에 사용 가능 (현재는 동일). */}
      {emphasis === 'submit' && null}
    </div>
  );
}
