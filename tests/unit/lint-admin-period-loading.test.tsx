// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DispatchTimeline from '../../src/components/admin/DispatchTimeline';
import ProfitSettlement from '../../src/components/admin/ProfitSettlement';

type Snapshot = { forEach: (visit: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void };
const state = vi.hoisted(() => ({
  subscriptions: [] as Array<{ receive: (snapshot: Snapshot) => void; fail: (error: Error) => void }>,
  write: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (...parts: unknown[]) => parts, where: (...parts: unknown[]) => parts,
  doc: vi.fn(), setDoc: state.write, serverTimestamp: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ forEach: () => {}, docs: [] }),
  onSnapshot: (_query: unknown, receive: (snapshot: Snapshot) => void, fail: (error: Error) => void) => {
    state.subscriptions.push({ receive, fail }); return state.unsubscribe;
  },
}));
beforeEach(() => { state.subscriptions.length = 0; vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each([
  ['dispatch date', DispatchTimeline],
  ['settlement month', ProfitSettlement],
] as const)('%s loading display', (_name, Component) => {
  it('starts loading for every period selection, including returning before the intervening request completes', async () => {
    const view = render(<Component />);
    const busy = () => view.container.querySelector('.animate-spin');
    expect(busy()).not.toBeNull();
    await act(async () => { state.subscriptions[0].receive({ forEach: () => {} }); });
    expect(busy()).toBeNull();
    const next = view.container.querySelector('.lucide-chevron-right')?.closest('button');
    const previous = view.container.querySelector('.lucide-chevron-left')?.closest('button');
    expect(next).toBeInstanceOf(HTMLButtonElement);
    expect(previous).toBeInstanceOf(HTMLButtonElement);
    fireEvent.click(next!);
    expect(busy()).not.toBeNull();
    fireEvent.click(previous!);
    expect(busy()).not.toBeNull();
    expect(state.subscriptions).toHaveLength(3);
    await act(async () => { state.subscriptions[2].fail(new Error('synthetic read failure')); });
    expect(busy()).toBeNull();
    expect(view.container).toHaveTextContent('synthetic read failure');
    expect(state.write).not.toHaveBeenCalled();
    view.unmount();
    expect(state.unsubscribe).toHaveBeenCalledTimes(3);
  });
});
