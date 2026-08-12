/**
 * P93 (2026-05-18) — Mobile tab strip overflow visibility regression slot.
 *
 * Pre-fix: SectionTabs.tsx had `overflow-x-auto scrollbar-hide` on the tab
 * row but no two things that make horizontal-scroll discoverable on mobile:
 *   1) No right-edge affordance → users can't see that more tabs exist
 *      past the screen edge (scrollbar-hide actively hides the only signal).
 *   2) No scrollIntoView on activeKey change → as the user advances past
 *      Day 5 the active tab stays anchored, so Day 7 + Wrap-up live forever
 *      offscreen-right on a 360px viewport with 9 tabs.
 *
 * User-visible symptom: 7-day plan on mobile shows "여행 준비, Intro, Day 1
 * … Day 6" tabs only. Day 7 + Wrap-up tabs were unreachable without an
 * intentional swipe the user had no reason to attempt.
 *
 * Post-fix:
 *   1) `useEffect([activeKey])` → query `[aria-selected="true"]` and call
 *      `scrollIntoView({ inline: 'center' })`. Active tab is always visible.
 *   2) Right-edge solid arrow — a non-gradient overlay on the sticky parent
 *      (with `aria-hidden` + `pointer-events-none` so it never intercepts
 *      touches or screen-reader focus).
 *
 * If a future refactor strips either guard, the corresponding assertion
 * here fails and CI catches it before users do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tabsSrc = readFileSync(
  resolve(
    process.cwd(),
    'src/pages/PlanDetailPage/components/SectionTabs.tsx',
  ),
  'utf8',
);
const mistakeLintSrc = readFileSync(
  resolve(process.cwd(), 'scripts/lint-mistake-patterns.mjs'),
  'utf8',
);

describe('P93 —SectionTabs mobile overflow visibility', () => {
  it('imports useEffect and useRef (signals the scrollIntoView wiring exists)', () => {
    expect(tabsSrc).toMatch(
      /import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*['"]react['"]/,
    );
    expect(tabsSrc).toMatch(
      /import\s*\{[^}]*\buseRef\b[^}]*\}\s*from\s*['"]react['"]/,
    );
  });

  it('scrolls the active tab into view (center alignment) when activeKey changes', () => {
    // The effect runs when activeKey changes (user advances slides). It must
    // query the currently selected tab and center it horizontally.
    expect(tabsSrc).toMatch(/aria-selected="true"/);
    expect(tabsSrc).toMatch(
      /scrollIntoView\(\s*\{[^}]*inline\s*:\s*['"]center['"][^}]*\}\s*\)/,
    );
    // The dependency array must include activeKey (not slides — that'd refire
    // every render when the parent re-renders for unrelated reasons).
    expect(tabsSrc).toMatch(/\}\s*,\s*\[activeKey\]\s*\)/);
  });

  it('renders a right-edge solid scroll-affordance signal', () => {
    // The signal is on the sticky parent (relative positioning context) so it
    // doesn't move with the scrolled tab row.
    expect(tabsSrc).toMatch(/data-scroll-affordance/);
    expect(tabsSrc).not.toMatch(/bg-gradient-to-l/);
    // Must be non-interactive — the signal must not steal clicks or screen-reader
    // focus from the underlying tab buttons.
    expect(tabsSrc).toMatch(/pointer-events-none/);
    expect(tabsSrc).toMatch(/aria-hidden=["']true["']/);
    expect(tabsSrc).toMatch(/ChevronRight/);
  });

  it('keeps mistake-lint aligned with the no-gradient design policy', () => {
    expect(mistakeLintSrc).toMatch(/const hasSolidAffordance/);
    expect(mistakeLintSrc).toMatch(/data-scroll-affordance/);
    expect(mistakeLintSrc).toMatch(/!hasFade && !hasSolidAffordance/);
  });

  it('keeps scrollbar-hide + whitespace-nowrap layout (regression baseline)', () => {
    // The fix complements scrollbar-hide rather than replacing it — the
    // scrollbar itself remains hidden (UX choice) but affordance+autoscroll
    // restore discoverability.
    expect(tabsSrc).toMatch(/scrollbar-hide/);
    expect(tabsSrc).toMatch(/whitespace-nowrap/);
    expect(tabsSrc).toMatch(/overflow-x-auto/);
  });
});
