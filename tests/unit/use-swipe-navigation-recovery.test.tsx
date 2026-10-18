// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSwipeNavigation } from '../../src/pages/PlanDetailPage/hooks/useSwipeNavigation';

afterEach(cleanup);
describe('saved slide navigation', () => {
  it('preserves the saved hash through empty/partial loads, then clamps only when ready', () => {
    window.history.replaceState({ router: 'preserved' }, '', '/my-plans/a?shared=1#slide-3');
    const { result, rerender } = renderHook(({ count, ready }) => useSwipeNavigation(count, { navigationKey: 'a', ready }),
      { initialProps: { count: 0, ready: false } });
    act(() => { result.current.goNext(); result.current.goPrev(); result.current.goToSlide(NaN); });
    expect(window.location.hash).toBe('#slide-3');
    rerender({ count: 2, ready: false });
    expect(result.current.current).toBe(1);
    expect(window.location.hash).toBe('#slide-3');
    rerender({ count: 5, ready: true });
    expect(result.current.current).toBe(3);
    rerender({ count: 2, ready: true });
    expect(window.location.hash).toBe('#slide-1');
    expect(window.location.pathname + window.location.search).toBe('/my-plans/a?shared=1');
    expect(window.history.state).toEqual({ router: 'preserved' });
    rerender({ count: 0, ready: true });
    expect(window.location.hash).toBe('#slide-1');
  });

  it('honors user selection over pending restore and reads plan and history changes', () => {
    window.history.replaceState(null, '', '/my-plans/a#slide-7');
    const { result, rerender } = renderHook(({ key, count }) => useSwipeNavigation(count, { navigationKey: key, ready: false }),
      { initialProps: { key: 'a', count: 3 } });
    act(() => result.current.goToSlide(1));
    rerender({ key: 'a', count: 9 });
    expect(result.current.current).toBe(1);
    window.history.replaceState(null, '', '/my-plans/b#slide-2');
    rerender({ key: 'b', count: 9 });
    expect(result.current.current).toBe(2);
    act(() => {
      window.history.replaceState(null, '', '/my-plans/b#slide-4');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.current).toBe(4);
    act(() => {
      window.history.replaceState(null, '', '/my-plans/b#slide-5');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.current).toBe(5);
  });

  it('keeps the clamped slide after a ready itinerary shrinks and grows again', () => {
    window.history.replaceState(null, '', '/my-plans/c#slide-4');
    const { result, rerender } = renderHook(({ count }) => useSwipeNavigation(count, { navigationKey: 'c', ready: true }),
      { initialProps: { count: 6 } });
    expect(result.current.current).toBe(4);
    rerender({ count: 3 });
    expect(result.current.current).toBe(2);
    expect(window.location.hash).toBe('#slide-2');
    rerender({ count: 6 });
    expect(result.current.current).toBe(2);
    expect(window.location.hash).toBe('#slide-2');
    act(() => result.current.goNext());
    expect(result.current.current).toBe(3);
    expect(window.location.hash).toBe('#slide-3');
  });
});
