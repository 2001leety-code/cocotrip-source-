// Sticky section tab strip — 2026-05-03 사용자 결정으로 "슬라이드별 1탭" 구조 도입.
// 좌우 스와이프와 SlideProgress dots가 모두 제거되어, 본 탭 스트립이 유일한 네비게이션.
//
// 슬라이드 1개당 1 탭:
//   - preTrip → "여행 준비"
//   - intro   → "Intro"
//   - day N   → "Day N"
//   - outro   → "Wrap-up"
//
// 광고 ad slide는 별도로 안 만듬 (PreTrip slide에 통합됨, 2026-05-03 기준).
import { useEffect, useMemo, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';
import type { Slide } from '../lib/buildSlides';
import { formatDayLabel } from '../lib/dayLabel';

interface SectionTabsProps {
  slides: Slide[];
  current: number;
  onJump: (slideIndex: number) => void;
}

interface Section {
  key: string;
  label: string;
  slideIndex: number;
}

export function SectionTabs({ slides, current, onJump }: SectionTabsProps) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = useMemo(() => pd.swipe || {}, [pd.swipe]);

  const sections = useMemo<Section[]>(() => {
    return slides.map((s, idx) => {
      let key: string;
      let label: string;
      switch (s.type) {
        case 'preTrip':
          key = 'preTrip';
          label = (sw as Record<string, string | undefined>).tabPreTrip || 'Pre-Trip';
          break;
        case 'intro':
          key = 'intro';
          label = sw.tabIntro || 'Intro';
          break;
        case 'day':
          key = `day-${s.dayIndex}`;
          label = formatDayLabel(language, (typeof s.dayIndex === 'number' ? s.dayIndex : 0) + 1);
          break;
        case 'activityGuide':
          key = 'activityGuide';
          label = (sw as Record<string, string | undefined>).tabActivityGuide || 'Activity Guide';
          break;
        case 'outro':
          key = 'outro';
          label = sw.tabOutro || 'Wrap-up';
          break;
        case 'ad':
          // 레거시 ad slide (현재 buildSlides에서 더 이상 생성 안 됨, 안전장치)
          key = `ad-${idx}`;
          label = String(s.adType || 'Ad');
          break;
        default:
          key = `slide-${idx}`;
          label = `Slide ${idx + 1}`;
      }
      return { key, label, slideIndex: idx };
    });
  }, [language, slides, sw]);

  const activeKey = useMemo(() => {
    return sections[current]?.key || sections[0]?.key;
  }, [sections, current]);

  // P93 (2026-05-18): 모바일 viewport 에서 가로 스크롤 탭바의 활성 탭이 viewport 밖에
  // 머무는 문제. 9탭(여행 준비/Intro/Day1-7/Wrap-up) 가 360px viewport 에 모두 fit
  // 안되는데 scrollbar-hide 로 스크롤 가능성 시각 신호도 없어 사용자가 Day7/Wrap-up
  // 존재를 모름. current 가 바뀔 때마다 active 탭을 가로 중앙으로 자동 스크롤.
  const listRef = useRef<HTMLDivElement>(null);
  // #1272 P2 (2026-08-10): 첫 렌더에서는 "가로 정렬만" 한다.
  //   scrollIntoView 는 block:'nearest' 여도 대상이 viewport 밖이면 문서를 세로로 스크롤한다.
  //   이 탭 스트립의 문서 위치는 모바일 히어로+요약 카드 아래(측정값 y≈760~985) — 즉 마운트
  //   시점엔 언제나 폴드 아래다. 그래서 플랜을 열면 페이지가 스스로 170~220px 내려가
  //   공용 헤더와 플랜 제목이 화면에서 밀려났다. tests/visual 의 T1(header above the fold)
  //   baseline 이 바로 그 스크롤된 프레임으로 굳어 있었고(헤더가 잘려 보임), 사용자에게도
  //   "내 플랜을 열었는데 제목부터 안 보인다"로 나타났다.
  //   마운트 이후(사용자가 탭이나 히어로 Day 칩을 눌러 섹션을 고른 뒤)에는 기존 동작 유지 —
  //   P93 의 가로 센터링과 "누르면 해당 Day 본문이 시야에 들어온다"를 둘 다 보존한다.
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active) return;
    const prevKey = lastKeyRef.current;
    lastKeyRef.current = activeKey;
    // 활성 섹션이 "실제로 바뀐" 경우에만 세로 포함 스크롤. 첫 관측(마운트)과
    // 같은 키로 effect 가 다시 도는 경우(StrictMode 이중 호출)는 아래 가로 정렬만.
    if (prevKey !== null && prevKey !== activeKey) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      return;
    }
    // 컨테이너의 scrollLeft 만 옮긴다 — 문서 세로 스크롤은 발생할 수 없다.
    // #slide-N 딥링크로 첫 활성 탭이 0번이 아닐 때도 센터링은 유지된다.
    list.scrollLeft = Math.max(
      0,
      active.offsetLeft - list.offsetLeft - (list.clientWidth - active.offsetWidth) / 2,
    );
  }, [activeKey]);

  if (sections.length <= 1) return null;

  return (
    <nav className="relative sticky top-14 z-30 -mx-4 border-y border-ec-line bg-ec-page px-4 md:top-16 md:mx-0 md:px-0" aria-label={sw.tabsNavLabel || 'Itinerary sections'}>
      <div
        ref={listRef}
        data-testid="section-tabs-scroll"
        className="flex gap-2 overflow-x-auto whitespace-nowrap py-3 pr-8 scrollbar-hide md:pr-0"
        role="tablist"
      >
        {sections.map(sec => {
          const active = sec.key === activeKey;
          return (
            <button
              key={sec.key}
              role="tab"
              aria-selected={active}
              onClick={() => onJump(sec.slideIndex)}
              className={`ec-chip min-h-[44px] shrink-0 cursor-pointer px-4 text-[14px] ${active ? 'ec-chip-brand' : ''}`}
            >
              {sec.label}
            </button>
          );
        })}
      </div>
      <span
        aria-hidden="true"
        data-scroll-affordance
        className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-end border-r-4 border-ec-line-2 bg-ec-page pr-1 text-ec-ink-3 md:hidden"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      </span>
    </nav>
  );
}
