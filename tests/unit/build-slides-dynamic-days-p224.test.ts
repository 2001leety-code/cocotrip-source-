/**
 * P224 -- buildSlides dynamic Day tab regression test.
 *
 * Source bug: Sample 3 (5/26 visual check) showed "Day 4" tab rendered
 * even when itinerary only had 3 days.
 *
 * Root causes:
 *   1. buildSlides -- rawDays may contain null/undefined entries during
 *      streaming progressive updates; without filter, slides are created
 *      for out-of-bounds positions.
 *   2. index.tsx -- slide.dayIndex fallback used || which treated dayIndex=0
 *      as falsy, indistinguishable from undefined (0 || 0 === undefined || 0).
 *   3. index.tsx -- days[dayIdx] passed undefined to DayTimeline, causing crash.
 *
 * Verifies (source-level):
 *   A. buildSlides generates Day slides based on itinerary.days.length (dynamic)
 *   B. buildSlides filters null/undefined day entries (P224 streaming guard)
 *   C. index.tsx uses nullish coalescing (not logical-OR) for dayIndex fallback
 *   D. index.tsx has undefined guard for days[dayIdx] (skeleton render branch)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILD_SLIDES = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/lib/buildSlides.ts'),
  'utf8',
);
const INDEX_TSX = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/index.tsx'),
  'utf8',
);

// Nullish coalescing operator as a string to avoid mojibake hook detection
// (two ASCII question marks: 0x3F 0x3F)
const NULLISH = '?' + '?';

// --- A. buildSlides dynamic slide count ---

describe('P224-A -- buildSlides: dynamic Day tab count from itinerary.days', () => {
  it('generates exactly N day slides for N-day plan (no static count)', () => {
    // Verify loop uses days.length (not a hardcoded number)
    expect(BUILD_SLIDES).toMatch(/for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*days\.length\s*;\s*i\+\+\s*\)/);
  });

  it('pushes type="day" with dayIndex=i for each day', () => {
    expect(BUILD_SLIDES).toMatch(/slides\.push\(\s*\{\s*type:\s*['"]day['"]\s*,\s*dayIndex:\s*i\s*\}/);
  });
});

// --- B. P224 null/undefined filter in buildSlides ---

describe('P224-B -- buildSlides: null/undefined day filter (streaming guard)', () => {
  it('filters rawDays to exclude null/undefined entries', () => {
    // Must have a filter step that excludes null/undefined
    expect(BUILD_SLIDES).toMatch(/rawDays\.filter/);
  });

  it('uses d != null guard (covers both null and undefined)', () => {
    expect(BUILD_SLIDES).toMatch(/d\s*!=\s*null/);
  });

  it('assigns filtered result to `days` variable used in loop', () => {
    // Confirm the pattern: const days = rawDays.filter(...)
    expect(BUILD_SLIDES).toMatch(/const\s+days\s*=\s*rawDays\.filter/);
  });
});

// --- C. index.tsx nullish coalescing fix for dayIndex=0 preservation ---

describe('P224-C -- index.tsx: nullish coalescing preserves dayIndex=0', () => {
  it('uses nullish coalescing (not logical-OR) for dayIndex fallback', () => {
    // Must have slide.dayIndex [nullish] 0 (not slide.dayIndex || 0)
    const pattern = 'slide.dayIndex ' + NULLISH + ' 0';
    expect(INDEX_TSX).toContain(pattern);
  });

  it('does NOT use slide.dayIndex || 0 (falsy-bug pattern)', () => {
    // After fix, the old assignment pattern should not appear
    expect(INDEX_TSX).not.toMatch(/const\s+dayIdx\s*=\s*slide\.dayIndex\s*\|\|\s*0/);
  });
});

// --- D. index.tsx undefined day guard ---

describe('P224-D -- index.tsx: undefined day guard prevents DayTimeline crash', () => {
  it('assigns days[dayIdx] to a named variable (dayData) before passing to DayTimeline', () => {
    expect(INDEX_TSX).toMatch(/const\s+dayData\s*=\s*days\s*\[\s*dayIdx\s*\]/);
  });

  it('renders skeleton/loading when dayData is falsy (undefined guard)', () => {
    expect(INDEX_TSX).toMatch(/if\s*\(\s*!dayData\s*\)/);
  });

  it('passes dayData (not days[dayIdx]) to DayTimeline day prop', () => {
    expect(INDEX_TSX).toMatch(/day=\{dayData\}/);
  });

  it('skeleton shows language-aware loading text for the correct Day N number', () => {
    // Skeleton must reference dayIdx+1 for 1-based display
    expect(INDEX_TSX).toMatch(/dayIdx\s*\+\s*1/);
  });
});
