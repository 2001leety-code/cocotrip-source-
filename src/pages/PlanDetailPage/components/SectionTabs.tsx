// Sticky section tab strip — Option A "tabs + sections" hybrid.
// Sits above SlideProgress and groups slides into top-level sections so the
// user can jump from Day 3 → Outro without swiping past 4 ad slides.
//
// Slide-level dots stay below for fine-grained navigation; this tab strip
// is for "skip to a section" intent.
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
  endIndex: number;
}

export function SectionTabs({ slides, current, onJump }: SectionTabsProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    // 2026-04-27 fix: ad slide는 *직전* section에 attach (이전 동작은 next에 attach
    // → eSIM(idx=1)이 Day 1 section에 묶여서 "Day 1" 탭 활성인데 eSIM 카드만 보이는 혼란).
    // 이제 eSIM은 Intro와 같은 그룹, airportPickup은 마지막 Day와 같은 그룹.
    slides.forEach((s, idx) => {
      if (s.type === 'ad') {
        // 직전 section의 endIndex를 이 ad slide까지로 확장
        const last = out[out.length - 1];
        if (last) last.endIndex = idx;
        return;
      }
      const key = s.type === 'day' ? `day-${s.dayIndex}` : s.type;
      const label = s.type === 'intro'
        ? (sw.tabIntro || 'Intro')
        : s.type === 'outro'
          ? (sw.tabOutro || 'Wrap-up')
          : `${sw.tabDay || 'Day'} ${(typeof s.dayIndex === 'number' ? s.dayIndex : 0) + 1}`;
      out.push({ key, label, slideIndex: idx, endIndex: idx });
    });
    return out;
  }, [slides, sw.tabIntro, sw.tabOutro, sw.tabDay]);

  const activeKey = useMemo(() => {
    // The active tab is the section whose [slideIndex, endIndex] range contains `current`.
    const hit = sections.find(s => current >= s.slideIndex && current <= s.endIndex);
    return hit?.key || sections[0]?.key;
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
