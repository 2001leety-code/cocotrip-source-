// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePwaUpdateGuard } from '@/hooks/usePwaUpdateGuard';
import { hasFocusedEditable, isPaymentLikelyInProgress } from '@/lib/pwaUpdateGuard';

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('live browser event wiring for PWA protection', () => {
  it.each(['input', 'change', 'focusin', 'pointerdown', 'keydown', 'touchstart', 'scroll'])('captures %s during activation and blocks the callback captured before render', (eventName) => {
    const reload = vi.fn(); const update = vi.fn(async () => {});
    const { result } = renderHook(() => usePwaUpdateGuard(reload));
    const firstCallback = result.current.guard.onNeedReload;
    act(() => { result.current.guard.scheduleAutomatic(update); vi.advanceTimersByTime(1200); });
    expect(update).toHaveBeenCalledTimes(1);
    const element = document.createElement('textarea'); document.body.append(element);
    act(() => { fireEvent(element, new Event(eventName, { bubbles: false })); firstCallback(); });
    expect(reload).not.toHaveBeenCalled(); expect(result.current.state.reason).toBe('interaction');
  });
  it('detects a PayPal-named local iframe inserted after the request without sending anything', () => {
    const reload = vi.fn(); const update = vi.fn(async () => {});
    const { result } = renderHook(() => usePwaUpdateGuard(reload));
    act(() => { result.current.guard.scheduleAutomatic(update); vi.advanceTimersByTime(1200); });
    const frame = document.createElement('iframe'); frame.name = 'paypal-local-fake'; frame.src = 'about:blank'; document.body.append(frame);
    act(() => result.current.guard.onNeedReload());
    expect(reload).not.toHaveBeenCalled(); expect(result.current.state.reason).toBe('payment');
  });
  it('remembers a hidden-to-visible transition during manual activation', async () => {
    const reload = vi.fn(); const update = vi.fn(async () => {});
    const { result } = renderHook(() => usePwaUpdateGuard(reload));
    await act(async () => result.current.guard.requestManual(update));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => fireEvent(document, new Event('visibilitychange')));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => result.current.guard.onNeedReload()); expect(reload).not.toHaveBeenCalled();
  });
  it.each(['input', 'textarea', 'select'])('identifies a focused %s as editing', (tag) => {
    const element = document.createElement(tag); document.body.append(element); element.focus();
    expect(hasFocusedEditable(document)).toBe(true);
  });
  it('guards a focused non-PayPal iframe too', () => {
    const frame = document.createElement('iframe'); frame.src = 'about:blank'; document.body.append(frame); frame.focus();
    expect(isPaymentLikelyInProgress(document)).toBe(true);
  });
  it('unmount stops timers and prevents captured callbacks from reloading', () => {
    const reload = vi.fn(); const update = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => usePwaUpdateGuard(reload));
    const callback = result.current.guard.onNeedReload;
    act(() => result.current.guard.scheduleAutomatic(update)); unmount();
    act(() => { vi.advanceTimersByTime(1200); callback(); });
    expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
});
