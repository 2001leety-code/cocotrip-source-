// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Snapshot = {
  forEach?: (visit: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void;
  docs?: Array<{ id: string; data: () => Record<string, unknown> }>;
};

const state = vi.hoisted(() => ({
  user: null as { email: string; getIdToken: () => Promise<string> } | null,
  subscriptions: [] as Array<{
    receive: (snapshot: Snapshot) => void;
    fail: (error: Error) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/components/admin/RuntimeFlagsPanel', () => ({ RuntimeFlagsPanel: () => null }));
vi.mock('@/components/admin/PromoBannerPanel', () => ({ PromoBannerPanel: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  query: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  orderBy: (...parts: unknown[]) => parts,
  doc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ forEach: () => {} }),
  onSnapshot: (_query: unknown, receive: (snapshot: Snapshot) => void, fail: (error: Error) => void) => {
    const unsubscribe = vi.fn();
    state.subscriptions.push({ receive, fail, unsubscribe });
    return unsubscribe;
  },
}));

import AdminCalendar from '../../src/pages/AdminCalendar';
import AdminPayments from '../../src/pages/AdminPayments';

beforeEach(() => {
  state.user = null;
  state.subscriptions.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('admin loading lifecycle', () => {
  it('starts a new calendar period loading, clears a previous read error, and releases every replaced listener', async () => {
    const view = render(<MemoryRouter><AdminCalendar /></MemoryRouter>);
    const spinner = () => view.container.querySelector('h1 .animate-spin');
    expect(spinner()).not.toBeNull();
    expect(state.subscriptions).toHaveLength(2);

    await act(async () => { state.subscriptions[0].receive({ forEach: () => {} }); });
    expect(spinner()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(spinner()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
    expect(spinner()).not.toBeNull();
    expect(state.subscriptions).toHaveLength(6);

    await act(async () => { state.subscriptions[4].fail(new Error('synthetic period failure')); });
    expect(screen.getByText('synthetic period failure')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.queryByText('synthetic period failure')).toBeNull();
    expect(spinner()).not.toBeNull();

    view.unmount();
    expect(state.subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('does not subscribe for a non-admin account and retains its completed loading state across an admin transition', async () => {
    const view = render(<MemoryRouter><AdminPayments /></MemoryRouter>);
    expect(screen.getByText('관리자 전용 페이지입니다.')).toBeTruthy();
    expect(state.subscriptions).toHaveLength(0);

    state.user = { email: '2001leety@gmail.com', getIdToken: async () => 'token' };
    view.rerender(<MemoryRouter><AdminPayments /></MemoryRouter>);
    await waitFor(() => expect(state.subscriptions).toHaveLength(1));
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    await act(async () => { state.subscriptions[0].receive({ docs: [] }); });

    state.user = null;
    view.rerender(<MemoryRouter><AdminPayments /></MemoryRouter>);
    expect(screen.getByText('관리자 전용 페이지입니다.')).toBeTruthy();
    expect(state.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

    state.user = { email: '2001leety@gmail.com', getIdToken: async () => 'token' };
    view.rerender(<MemoryRouter><AdminPayments /></MemoryRouter>);
    await waitFor(() => expect(state.subscriptions).toHaveLength(2));
    expect(view.container.querySelector('.animate-spin')).toBeNull();
  });
});
