import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_UPDATE_IDLE_MS, AUTO_UPDATE_WINDOW_MS, createPwaUpdateGuard, type PwaUpdateState } from '@/lib/pwaUpdateGuard';

function fixture(mount = true) {
  const conditions = { editing: false, paying: false, visible: true };
  const reload = vi.fn();
  const update = vi.fn(async () => {});
  const states: PwaUpdateState[] = [];
  const guard = createPwaUpdateGuard({
    now: () => Date.now(), editable: () => conditions.editing, payment: () => conditions.paying,
    visible: () => conditions.visible, reload, publish: (state) => states.push(state),
    schedule(callback, delay) { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  });
  if (mount) guard.mount();
  return { guard, conditions, reload, update, states, state: () => states[states.length - 1] };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('PWA live reload protection', () => {
  it('preserves readiness received before first mount without publishing or reloading early', () => {
    const f = fixture(false); f.guard.onNeedReload(); f.guard.onNeedReload();
    expect(f.states).toHaveLength(0); expect(f.reload).not.toHaveBeenCalled();
    f.guard.mount(); expect(f.state()).toMatchObject({ ready: true, deferred: true });
    f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1199);
    expect(f.reload).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(f.reload).toHaveBeenCalledOnce(); expect(f.update).not.toHaveBeenCalled();
  });
  it('keeps pre-mount readiness protected when editing starts before the first effect', async () => {
    const f = fixture(false); f.guard.onNeedReload(); f.conditions.editing = true;
    f.guard.mount(); f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1200);
    expect(f.state()).toMatchObject({ ready: true, reason: 'editing' });
    expect(f.reload).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    f.conditions.editing = false; await f.guard.requestManual(f.update);
    expect(f.reload).toHaveBeenCalledOnce(); expect(f.update).not.toHaveBeenCalled();
  });
  it('does not turn a late callback after actual unmount into pre-mount readiness', () => {
    const f = fixture(); f.guard.unmount(); f.guard.onNeedReload(); f.guard.mount();
    expect(f.state().ready).toBe(false); expect(f.reload).not.toHaveBeenCalled();
  });
  it('keeps the ten-second detection and 1.2-second idle contracts', () => {
    expect(AUTO_UPDATE_WINDOW_MS).toBe(10000); expect(AUTO_UPDATE_IDLE_MS).toBe(1200);
    const f = fixture(); f.guard.scheduleAutomatic(f.update);
    vi.advanceTimersByTime(1199); expect(f.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(f.update).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.reload).not.toHaveBeenCalled(); f.guard.onNeedReload(); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('does not silently reload on an unsolicited controller event', () => {
    const f = fixture(); f.guard.onNeedReload(); f.guard.onNeedReload();
    expect(f.reload).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.state()).toMatchObject({ ready: true, deferred: true });
  });
  it('may apply an already-active update after a guarded cold-start idle interval', () => {
    const f = fixture(); f.guard.onNeedReload(); f.guard.scheduleAutomatic(f.update);
    vi.advanceTimersByTime(1199); expect(f.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(f.reload).toHaveBeenCalledTimes(1); expect(f.update).not.toHaveBeenCalled();
  });
  it('does not start an automatic request when detection is outside the window', () => {
    const f = fixture(); vi.advanceTimersByTime(10000); f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(2000);
    expect(f.update).not.toHaveBeenCalled(); expect(f.state().deferred).toBe(true);
  });
  it('rejects a throttled timer outside the existing 10s + 1.2s grace', () => {
    const f = fixture(); f.guard.scheduleAutomatic(f.update); vi.setSystemTime(11200); vi.advanceTimersByTime(1200);
    expect(f.update).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it('blocks any earlier interaction even if the field is no longer focused', () => {
    const f = fixture(); f.guard.markInteraction(); f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1200);
    expect(f.update).not.toHaveBeenCalled(); expect(f.state().reason).toBe('interaction');
  });
  it.each(['editing', 'paying', 'visible'] as const)('blocks %s before activation and checks it again immediately before reload', (condition) => {
    const f = fixture(); f.conditions[condition] = condition !== 'visible';
    f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1200); expect(f.update).not.toHaveBeenCalled();
    const g = fixture(); g.guard.scheduleAutomatic(g.update); vi.advanceTimersByTime(1200);
    expect(g.update).toHaveBeenCalledTimes(1); g.conditions[condition] = condition !== 'visible';
    g.guard.onNeedReload(); expect(g.reload).not.toHaveBeenCalled(); expect(g.state().deferred).toBe(true);
  });
  it('blocks typing begun while activation is in flight, even after blur', () => {
    const f = fixture(); f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1200);
    f.guard.markInteraction(); f.guard.onNeedReload(); expect(f.reload).not.toHaveBeenCalled();
    expect(f.state()).toMatchObject({ ready: true, busy: false, reason: 'interaction' });
  });
  it('does not reload for late completion beyond the cold-start deadline', () => {
    const f = fixture(); f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(11200); f.guard.onNeedReload();
    expect(f.reload).not.toHaveBeenCalled(); expect(f.state().busy).toBe(false);
  });
  it('manual request after a deferred active update reloads once without skipWaiting again', async () => {
    const f = fixture(); f.guard.markInteraction(); f.guard.onNeedReload();
    await f.guard.requestManual(f.update); await f.guard.requestManual(f.update); f.guard.onNeedReload();
    expect(f.reload).toHaveBeenCalledTimes(1); expect(f.update).not.toHaveBeenCalled();
  });
  it('manual request in a long session is allowed but activation alone never reloads', async () => {
    const f = fixture(); vi.advanceTimersByTime(60000); f.guard.markInteraction(); await f.guard.requestManual(f.update);
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.reload).not.toHaveBeenCalled();
    f.guard.onNeedReload(); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it.each(['editing', 'paying', 'visible'] as const)('manual update does not bypass the current %s guard', async (condition) => {
    const f = fixture(); f.conditions[condition] = condition !== 'visible'; await f.guard.requestManual(f.update);
    expect(f.update).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it('manual activation followed by another interaction cannot discard new work', async () => {
    const f = fixture(); await f.guard.requestManual(f.update); f.guard.markInteraction(); f.guard.onNeedReload();
    expect(f.reload).not.toHaveBeenCalled(); expect(f.state().deferred).toBe(true);
  });
  it('repeated clicks and controlling events only activate and reload once', async () => {
    const f = fixture(); await f.guard.requestManual(f.update); await f.guard.requestManual(f.update);
    f.guard.onNeedReload(); f.guard.onNeedReload(); f.guard.onNeedReload();
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('failed activation is recoverable without pretending it reloaded', async () => {
    const f = fixture(); f.update.mockRejectedValueOnce(new Error('fake-private-detail'));
    await f.guard.requestManual(f.update); expect(f.state()).toMatchObject({ busy: false, reason: 'failed' });
    expect(JSON.stringify(f.state())).not.toContain('fake-private'); await f.guard.requestManual(f.update);
    f.guard.onNeedReload(); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('a request timeout unlocks the button but late readiness does not reload', async () => {
    const f = fixture(); await f.guard.requestManual(f.update); vi.advanceTimersByTime(10000); f.guard.onNeedReload();
    expect(f.reload).not.toHaveBeenCalled(); expect(f.state().busy).toBe(false);
    await f.guard.requestManual(f.update); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('unmount cancels pending auto work and ignores subsequent controlling', () => {
    const f = fixture(); f.guard.scheduleAutomatic(f.update); f.guard.unmount(); vi.advanceTimersByTime(2000); f.guard.onNeedReload();
    expect(f.update).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it('StrictMode effect cleanup/remount keeps one active timer', () => {
    const f = fixture(); f.guard.scheduleAutomatic(f.update); f.guard.unmount(); f.guard.mount();
    f.guard.scheduleAutomatic(f.update); vi.advanceTimersByTime(1200); f.guard.onNeedReload();
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.reload).toHaveBeenCalledTimes(1);
  });
});
