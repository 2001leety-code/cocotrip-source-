// @vitest-environment jsdom
//
// 2026-11-24: the planner "How the planner works" dialog was baked into the production
// /planner HTML (some deploys yes, some no). The prerender Chrome is 800px wide, so the
// desktop-only auto-open (350 ms after mount) fired whenever the content check took longer
// than 350 ms. That HTML is shown before the app loads, so phones saw the dialog over the
// planner for seconds, and returning visitors saw it again.
//
// Locked here:
//   1) the dialog never opens while the prerenderer is capturing (window.__PRERENDER_INJECTED)
//   2) vite.config gives the prerenderer that flag (`inject`)
//   3) it still opens for a first-time desktop visitor
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const dict = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? k : '') });
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { planner: dict }, language: 'en' }),
}));

import { AIIntroModal } from '@/components/AIIntroModal';

type PrerenderWindow = Window & { __PRERENDER_INJECTED?: unknown };

describe('AIIntroModal during prerender capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as PrerenderWindow).__PRERENDER_INJECTED;
  });

  it('stays closed while the prerenderer is capturing', () => {
    (window as PrerenderWindow).__PRERENDER_INJECTED = true;
    render(<AIIntroModal />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still opens for a first-time desktop visitor', () => {
    render(<AIIntroModal />);
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('vite.config passes the capture flag to the prerenderer', () => {
    const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    const renderer = config.slice(config.indexOf('rendererOptions'), config.indexOf('postProcess'));
    // Line must start with `inject:` so a commented-out `// inject: true` does not pass.
    expect(renderer).toMatch(/^\s*inject:\s*true\b/m);
  });
});
