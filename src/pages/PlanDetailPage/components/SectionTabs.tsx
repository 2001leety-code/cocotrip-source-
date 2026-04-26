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
    // Walk slides in order; ad slides attach to the *next* meaningful section.
    let pendingAdStart: number | null = null;
    slides.forEach((s, idx) => {
      if (s.type === 'ad') {
        if (pendingAdStart === null) pendingAdStart = idx;
        return;
      }
      const start = pendingAdStart !== null ? pendingAdStart : idx;
      pendingAdStart = null;
      const key = s.type === 'day' ? `day-${s.dayIndex}` : s.type;
      const label = s.type === 'intro'
        ? (sw.tabIntro || 'Intro')
        : s.type === 'outro'
          ? (sw.tabOutro || 'Wrap-up')
          : `${sw.tabDay || 'Day'} ${(typeof s.dayIndex === 'number' ? s.dayIndex : 0) + 1}`;
      out.push({ key, label, slideIndex: start, endIndex: idx });
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
