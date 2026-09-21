// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/hooks/useLanguage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const firestoreState = vi.hoisted(() => ({ onSnapshot: null as null | ((snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void) }));
const authState = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'synthetic-token') }, loading: false, error: null }));

vi.stubGlobal('fetch', fetchMock);
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(), collection: vi.fn(), serverTimestamp: vi.fn(), query: vi.fn(), orderBy: vi.fn(),
  onSnapshot: vi.fn((_query: unknown, onNext: (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void) => {
    firestoreState.onSnapshot = onNext;
    return vi.fn();
  }),
}));

const { default: Admin } = await import('../../src/pages/Admin');

function snapshot() {
  const confirmedAtMs = new Date('2026-09-21T09:00:00.000Z').getTime();
  return { docs: [{ id: 'booking-1', data: () => ({ status: 'CONFIRMED', paymentMethod: 'paypal', priceUSD: '100', confirmedAt: { toMillis: () => confirmedAtMs } }) }] };
}

function renderAdmin() {
  return render(<MemoryRouter><LanguageProvider><Admin /></LanguageProvider></MemoryRouter>);
}

beforeEach(() => {
  cleanup();
  fetchMock.mockImplementation(async (url: string) => url.includes('posthog')
    ? { ok: true, json: async () => ({ ok: true, data: { today: { uniqueVisitors: 1, pageviews: 2 }, week: { uniqueVisitors: 1, pageviews: 2 }, month: { uniqueVisitors: 1, pageviews: 2 }, topPages: [], excludedAdmin: null } }) }
    : { ok: true, json: async () => ({ data: { bookings: [], total: 0 } }) });
  authState.loading = false;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Admin dashboard lifecycle', () => {
  it('same user의 auth loading 완료는 booking만 다시 읽고, 새 사용자는 visitors와 booking을 모두 다시 읽는다', async () => {
    const userA = { getIdToken: vi.fn(async () => 'token-a') };
    const userB = { getIdToken: vi.fn(async () => 'token-b') };
    authState.user = userA;
    authState.loading = true;
    const view = renderAdmin();

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('posthog')).length).toBe(1));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/admin-bookings')).length).toBe(0);

    authState.loading = false;
    view.rerender(<MemoryRouter><LanguageProvider><Admin /></LanguageProvider></MemoryRouter>);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/admin-bookings')).length).toBe(1));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('posthog')).length).toBe(1);

    authState.user = userB;
    view.rerender(<MemoryRouter><LanguageProvider><Admin /></LanguageProvider></MemoryRouter>);
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('posthog')).length).toBe(2);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/admin-bookings')).length).toBe(2);
    });
  });

  it('fixed confirmedAt snapshot is recalculated against the following day clock', async () => {
    let now = new Date('2026-09-21T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    renderAdmin();
    await waitFor(() => expect(firestoreState.onSnapshot).toBeTypeOf('function'));

    act(() => { firestoreState.onSnapshot?.(snapshot()); });
    const card = screen.getByText('오늘 실결제').parentElement?.parentElement;
    expect(card).toHaveTextContent('1건');

    now = new Date('2026-09-22T12:00:00.000Z').getTime();
    act(() => { firestoreState.onSnapshot?.(snapshot()); });
    await waitFor(() => expect(card).toHaveTextContent('0건'));
  });
});
