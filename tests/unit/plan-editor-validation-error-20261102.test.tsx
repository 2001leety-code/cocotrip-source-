/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
const { auth, write } = vi.hoisted(() => ({ auth: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/mealDraftIdentity', () => ({ mealDraftGuestHeaders: async () => ({}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: auth }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(() => ({})), updateDoc: write }));
import { usePlanEditor } from '../../src/pages/PlanDetailPage/hooks/usePlanEditor';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

const original = (): PlanDocument => ({ mealOptionsRevision: 1, itinerary: { meal_options_version: 1, days: [{ day: 1, city: 'seoul', stops: [
  { name: 'A', category: 'culture', start_time: '10:00' }, { name: 'B', category: 'food', start_time: '12:00' },
] }] } });
const setup = () => renderHook(() => {
  const [plan, setPlan] = React.useState<PlanDocument | null>(original);
  return { plan, editor: usePlanEditor('plan-1', plan, setPlan) };
});
afterEach(() => { cleanup(); auth.mockReset(); write.mockReset(); });

describe('plan editor failed server validation', () => {
  it.each(['delete', 'add', 'reorder', 'apply'] as const)('%s restores the snapshot and exposes an error without unhandled rejection or Firestore write', async (action) => {
    auth.mockRejectedValueOnce(new Error('offline'));
    const hook = setup();
    const initial = structuredClone(hook.result.current.plan);
    await act(async () => {
      const editor = hook.result.current.editor;
      if (action === 'delete') await editor.deleteStop(0, 0);
      if (action === 'add') await editor.addStop(0, { name: 'New' });
      if (action === 'reorder') await editor.reorderStops(0, 0, 1);
      if (action === 'apply') await editor.applyStopOrder(0, [1, 0]);
    });
    expect(hook.result.current.plan).toEqual(initial);
    expect(hook.result.current.editor.editError).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(auth.mock.calls[0][1].body)).toMatchObject({ action: 'edit', planId: 'plan-1', baseRevision: 1 });
  });
  it('clears the error when the next validated edit starts and succeeds', async () => {
    auth.mockResolvedValueOnce({ ok: false, json: async () => ({ status: 'failed' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'saved' }) });
    const hook = setup();
    await act(async () => { await hook.result.current.editor.deleteStop(0, 0); });
    expect(hook.result.current.editor.editError).toBe(true);
    await act(async () => { await hook.result.current.editor.deleteStop(0, 0); });
    expect(hook.result.current.editor.editError).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('replaces the optimistic edit with the canonical saved plan and revision', async () => {
    const canonical: PlanDocument = { planId: 'plan-1', mealOptionsRevision: 2, itinerary: { meal_options_version: 1, days: [{ day: 1, city: 'seoul', stops: [{ name: 'Server placement', category: 'culture' }] }] } };
    auth.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'saved', plan: canonical }) });
    const hook = setup();
    await act(async () => { await hook.result.current.editor.deleteStop(0, 0); });
    expect(hook.result.current.plan).toEqual(canonical);
    expect(hook.result.current.editor.editError).toBe(false);
    expect(hook.result.current.editor.editRefreshError).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('does not claim an edit was unsaved if the saved plan refresh fails', async () => {
    auth.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'saved' }) }).mockRejectedValueOnce(new Error('offline'));
    const hook = setup();
    await act(async () => { await hook.result.current.editor.deleteStop(0, 0); });
    expect(hook.result.current.editor.editError).toBe(false);
    expect(hook.result.current.editor.editRefreshError).toBe(true);
    expect(auth).toHaveBeenCalledTimes(2);
  });

  it.each(['token-removed', 'logged-out', 'guest-changed'])('discards a late saved plan after access changes: %s', async (nextScope) => {
    let finish: (value: unknown) => void = () => {};
    auth.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(({ scope }: { scope: string }) => {
      const [plan, setPlan] = React.useState<PlanDocument | null>(original);
      return { plan, setPlan, editor: usePlanEditor('plan-1', plan, setPlan, scope) };
    }, { initialProps: { scope: 'owner-token-guest' } });
    let pending: Promise<void> | undefined;
    act(() => { pending = hook.result.current.editor.deleteStop(0, 0); });
    await waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
    hook.rerender({ scope: nextScope });
    act(() => { hook.result.current.setPlan(null); });
    await act(async () => {
      finish({ ok: true, json: async () => ({ status: 'saved', plan: { ...original(), planId: 'plan-1', privateValue: 'private' } }) });
      await pending;
    });
    expect(hook.result.current.plan).toBeNull();
    expect(hook.result.current.editor.editError).toBe(false);
    expect(hook.result.current.editor.editRefreshError).toBe(false);
  });
  it('discards a late rollback and error after logout', async () => {
    let fail: (error: Error) => void = () => {};
    auth.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const hook = renderHook(({ scope }: { scope: string }) => {
      const [plan, setPlan] = React.useState<PlanDocument | null>(original);
      return { plan, setPlan, editor: usePlanEditor('plan-1', plan, setPlan, scope) };
    }, { initialProps: { scope: 'signed-in' } });
    let pending: Promise<void> | undefined;
    act(() => { pending = hook.result.current.editor.deleteStop(0, 0); });
    await waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
    hook.rerender({ scope: 'logged-out' });
    act(() => { hook.result.current.setPlan(null); });
    await act(async () => { fail(new Error('late failure')); await pending; });
    expect(hook.result.current.plan).toBeNull();
    expect(hook.result.current.editor.editError).toBe(false);
  });

  it('discards an old response even if the previous access scope is later restored', async () => {
    let finish: (value: unknown) => void = () => {};
    auth.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(({ scope }: { scope: string }) => {
      const [plan, setPlan] = React.useState<PlanDocument | null>(original);
      return { plan, setPlan, editor: usePlanEditor('plan-1', plan, setPlan, scope) };
    }, { initialProps: { scope: 'owner' } });
    let pending: Promise<void> | undefined;
    act(() => { pending = hook.result.current.editor.deleteStop(0, 0); });
    await waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
    hook.rerender({ scope: 'public' });
    act(() => { hook.result.current.setPlan(null); });
    hook.rerender({ scope: 'owner' });
    await act(async () => { finish({ ok: true, json: async () => ({ status: 'saved', plan: { ...original(), planId: 'plan-1' } }) }); await pending; });
    expect(hook.result.current.plan).toBeNull();
  });

});
