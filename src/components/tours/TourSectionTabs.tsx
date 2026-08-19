// TourSectionTabs — 투어 상세 페이지 sticky anchor 탭 (MRT 벤치마킹 P1).
// PlanDetailPage/components/SectionTabs.tsx 와 같은 sticky 스타일(top-14 md:top-16,
// role=tablist/tab)을 따르되, 슬라이드 인덱스가 아니라 섹션 id 로 scrollIntoView 한다.
import { useState } from 'react';

export interface TourSectionTab {
  id: string;
  label: string;
}

interface Props {
  tabs: TourSectionTab[];
  ariaLabel?: string;
}

export function TourSectionTabs({ tabs, ariaLabel }: Props) {
  const [active, setActive] = useState(tabs[0]?.id);

  // 섹션이 1개 이하면 탭으로 고를 게 없다 — SectionTabs.tsx 와 같은 가드.
  if (tabs.length <= 1) return null;

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      className="sticky top-14 z-30 -mx-4 border-y border-ec-line bg-ec-page px-4 md:top-16 md:mx-0 md:px-0"
      aria-label={ariaLabel}
      data-testid="tour-detail-section-tabs"
    >
      <div role="tablist" className="flex gap-2 overflow-x-auto whitespace-nowrap py-3 pr-8 scrollbar-hide md:pr-0">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => jump(tab.id)}
              className={`ec-chip min-h-[44px] shrink-0 cursor-pointer px-4 text-[14px] ${isActive ? 'ec-chip-brand' : ''}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
