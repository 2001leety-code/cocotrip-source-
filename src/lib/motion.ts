/**
 * Motion preference, for the places the app moves the page itself.
 *
 * CSS transitions are already covered — `index.css` zeroes durations under
 * `prefers-reduced-motion`, and every planner transition rides a duration
 * token. Programmatic scrolling is not: `scrollIntoView({ behavior: 'smooth' })`
 * animates regardless of the media query, so the places a reduced-motion reader
 * would get a long animated scroll are exactly the places the app moves them
 * without being asked — the failure panel, the return trip to the brief after a
 * retry, and the jump to a wizard field the reader left blank.
 *
 * Lives in `lib/` rather than next to its callers because they are components,
 * and `react-refresh/only-export-components` (eslint.config.js) rejects a
 * non-component export from a component module.
 *
 * 2026-08-18: moved from `pages/PlannerPage/lib/` to `src/lib/`. The wizard
 * (`components/WizardForm/`) needs it too, and a component reaching into a page
 * directory points the dependency the wrong way.
 */

/** True when the reader asked for reduced motion. False where nothing can ask —
 *  prerender (puppeteer) and older embedded webviews have no `matchMedia`. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll `el` to the top of the viewport and give it focus, motion honoured.
 *  Focus first with `preventScroll` so the browser's own instant focus scroll
 *  does not fight the explicit one and leave the element at the bottom edge. */
export function focusAndReveal(el: HTMLElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
