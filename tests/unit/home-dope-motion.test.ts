// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HOME_COPY } from '../../src/sections/home/homeCopy';
import { scrambleFrame, SCRAMBLE_FRAMES } from '../../src/sections/home/useScramble';
import { playGlyphResolve, GLYPH_RESOLVE_MS } from '../../src/sections/home/glyphResolve';
import { nextPlanIndex, useCyclingPlan, PLAN_CYCLE_MS } from '../../src/sections/home/useCyclingPlan';

interface TweenVars {
  duration: number;
  repeat?: number;
  scrambleText: { text: string; chars: string };
  onComplete: () => void;
}

const gsapMock = vi.hoisted(() => ({
  failImport: false,
  kill: vi.fn(),
  calls: [] as Array<{ target: HTMLElement; vars: TweenVars }>,
}));

vi.mock('gsap', () => ({
  gsap: {
    registerPlugin: () => {},
    to: (target: HTMLElement, vars: TweenVars) => {
      gsapMock.calls.push({ target, vars });
      return { kill: gsapMock.kill };
    },
  },
}));

vi.mock('gsap/ScrambleTextPlugin', () => ({
  get ScrambleTextPlugin() {
    if (gsapMock.failImport) throw new Error('chunk load failed');
    return {};
  },
}));

const flush = async () => {
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function liveNode() {
  const node = document.createElement('span');
  node.textContent = 'CHARTER';
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  vi.useRealTimers();
  gsapMock.failImport = false;
  gsapMock.kill.mockClear();
  gsapMock.calls.length = 0;
  document.body.innerHTML = '';
});

describe('home-dope motion', () => {
  it('headlineLines joined equal the accessible headline, 4 lines, no duration claims', () => {
    for (const [lang, copy] of Object.entries(HOME_COPY)) {
      const joined = copy.hero.headlineLines.flat().map((s) => s.text).join('').trim();
      expect(joined, lang).toBe(copy.hero.headline);
      expect(copy.hero.headlineLines).toHaveLength(4);
      expect(copy.hero.headline, lang).not.toMatch(/minute|instant|second|분 만에|즉시|초 만에|分で|瞬時|秒|分钟/i);
    }
  });

  it('scramble final frame is exactly the input; earlier frames keep whitespace', () => {
    const text = 'Seoul City Tour · 서울';
    expect(scrambleFrame(text, SCRAMBLE_FRAMES)).toBe(text);
    const mid = scrambleFrame(text, 3, SCRAMBLE_FRAMES, () => 0);
    expect(mid).not.toBe(text);
    expect(Array.from(mid)).toHaveLength(Array.from(text).length);
    expect([...mid].map((ch, i) => /\s/.test(ch) === /\s/.test(Array.from(text)[i]))).not.toContain(false);
  });

  it('row glyph resolve runs one bounded GSAP ScrambleText tween with letter/digit/punctuation glyphs and ends on the real title', async () => {
    const node = liveNode();
    playGlyphResolve(node, 'CHARTER');
    expect(gsapMock.calls).toHaveLength(0);
    await flush();
    expect(gsapMock.calls).toHaveLength(1);
    const { target, vars } = gsapMock.calls[0];
    expect(target).toBe(node);
    expect(vars.duration * 1000).toBe(GLYPH_RESOLVE_MS);
    expect(GLYPH_RESOLVE_MS).toBeLessThanOrEqual(600);
    expect(vars.repeat ?? 0).toBe(0);
    expect(vars.scrambleText.text).toBe('CHARTER');
    expect(vars.scrambleText.chars).toMatch(/^[A-Z0-9#%&*+/<>=:]+$/);
    node.textContent = '#%&';
    vars.onComplete();
    expect(node.textContent).toBe('CHARTER');
  });

  it('playGlyphResolve cancel restores the real text and kills a running tween', async () => {
    const node = liveNode();
    const cancel = playGlyphResolve(node, 'CHARTER');
    await flush();
    node.textContent = '#%&';
    cancel();
    expect(gsapMock.kill).toHaveBeenCalledTimes(1);
    expect(node.textContent).toBe('CHARTER');
  });

  it('cancel before GSAP arrives (unmount) never starts a stale tween', async () => {
    const node = liveNode();
    const cancel = playGlyphResolve(node, 'CHARTER');
    cancel();
    expect(node.textContent).toBe('CHARTER');
    await flush();
    expect(gsapMock.calls).toHaveLength(0);
    expect(node.textContent).toBe('CHARTER');
  });

  it('a failed GSAP import leaves the plain final title', async () => {
    gsapMock.failImport = true;
    const node = liveNode();
    node.textContent = '#%&';
    const cancel = playGlyphResolve(node, 'CHARTER');
    await flush();
    expect(gsapMock.calls).toHaveLength(0);
    expect(node.textContent).toBe('CHARTER');
    cancel();
    expect(node.textContent).toBe('CHARTER');
  });

  it('cycling index wraps and holds while paused', () => {
    expect(nextPlanIndex(2, 3)).toBe(0);
    expect(nextPlanIndex(0, 0)).toBe(0);
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ paused }) => useCyclingPlan(3, paused), {
      initialProps: { paused: false },
    });
    for (const expected of [1, 2, 0]) {
      act(() => vi.advanceTimersByTime(PLAN_CYCLE_MS));
      expect(result.current[0]).toBe(expected);
    }
    rerender({ paused: true });
    act(() => vi.advanceTimersByTime(PLAN_CYCLE_MS * 3));
    expect(result.current[0]).toBe(0);
  });
});
