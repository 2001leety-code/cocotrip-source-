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
import { useMemo } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';
import type { Slide } from '../lib/buildSlides';
import { BRAND } from '@/lib/design-tokens';

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
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

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
          label = `${sw.tabDay || 'Day'} ${(typeof s.dayIndex === 'number' ? s.dayIndex : 0) + 1}`;
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
  }, [slides, sw]);

  const activeKey = useMemo(() => {
    return sections[current]?.key || sections[0]?.key;
  }, [sections, current]);

  if (sections.length <= 1) return null;

  return (
    <div className="sticky top-16 z-30 bg-[#0a0b14]/95 backdrop-blur-md border-b border-white/[0.06] -mx-4 px-4">
      <div className="flex gap-1 overflow-x-auto scrollbar-hide py-2" role="tablist">
        {sections.map(sec => {
          const active = sec.key === activeKey;
          return (
            <button
              key={sec.key}
              role="tab"
              aria-selected={active}
              onClick={() => onJump(sec.slideIndex)}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all whitespace-nowrap"
              style={{
                background: active
                  ? BRAND.gradient.primary
                  : 'rgba(255,255,255,0.06)',
                color: active ? 'white' : 'rgba(255,255,255,0.55)',
                border: active ? '1px solid transparent' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {sec.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
