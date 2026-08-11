// @vitest-environment jsdom
//
// Quick-preview failure has to reach the person who caused it (2026-08-10).
//
// The bug this locks: when `/api/ai-planner-quick` failed all three attempts,
// the retry panel was rendered after the SEO/FAQ body. Measured on the PR #1275
// branch — desktop 1280×720: panel top y=2752 with the reader at scrollY 1180;
// mobile 390×844: y=2682 at scrollY 1884. Both readers were still parked at the
// wizard, so the page simply went quiet: no visible failure, no visible retry.
//
// Placement alone does not fix it — even directly under the wizard the panel is
// below a five-step form. So the panel owns two runtime behaviours, and this
// file is where they are pinned:
//   1. it takes focus when it appears (keyboard and screen-reader users land on
//      the failure, not somewhere in the middle of the brief), and
//   2. it scrolls itself into view, smoothly by default and instantly for a
//      reader who asked for reduced motion.
//
// Retry is the caller's business — the panel only reports the press. The page
// keeps the wizard mounted across the error, which is what preserves the
// answers; that half is asserted in planner-free-preview-truthfulness.test.ts.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlannerErrorPanel } from '../../src/pages/PlannerPage/components/PlannerErrorPanel';

/** jsdom implements neither of these; both are observable contract here. */
const scrollIntoView = vi.fn();

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: scrollIntoView,
  });
  setReducedMotion(false);
});

afterEach(() => cleanup());

const props = {
  title: 'Failed to generate itinerary',
  body: 'Nothing was charged. You can send the same brief again.',
  retryLabel: 'Try Again',
};

describe('PlannerErrorPanel', () => {
  it('states what failed, that nothing was charged, and how to go on', () => {
    render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />);
    expect(screen.getByText(props.title)).toBeInTheDocument();
    expect(screen.getByText(props.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: props.retryLabel })).toBeInTheDocument();
  });

  it('takes focus as soon as it appears', () => {
    const { container } = render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(panel);
  });

  it('scrolls itself into view smoothly by default', () => {
    render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: 'smooth', block: 'start' });
  });

  it('jumps instead of animating when the reader asked for reduced motion', () => {
    setReducedMotion(true);
    render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: 'auto' });
  });

  it('survives an environment with no matchMedia at all', () => {
    // Prerender (puppeteer) and older embedded webviews. A missing media query
    // must never take the failure notice down with it.
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    expect(() => render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />)).not.toThrow();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('reports the retry press to the caller', () => {
    const onRetry = vi.fn();
    render(<PlannerErrorPanel {...props} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: props.retryLabel }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is announced, so a screen reader hears the failure without finding it', () => {
    const { container } = render(<PlannerErrorPanel {...props} onRetry={vi.fn()} />);
    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();
  });
});
