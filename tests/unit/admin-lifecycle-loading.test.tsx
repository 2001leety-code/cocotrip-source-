// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const authState = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'synthetic-token') }, loading: false }));

vi.stubGlobal('fetch', fetchMock);
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => authState }));

const { default: AdminAllBookings } = await import('../../src/pages/AdminAllBookings');
const { default: AdminReconciliation } = await import('../../src/pages/AdminReconciliation');

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  authState.user = { getIdToken: vi.fn(async () => 'synthetic-token') };
  authState.loading = false;
});
afterEach(() => cleanup());

describe('admin async loading lifecycles', () => {
  it('AdminAllBookings shows the initial load and reloads after an auth user transition', async () => {
    let resolveFirst!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const view = render(<MemoryRouter><AdminAllBookings /></MemoryRouter>);
    expect(document.querySelector('svg.animate-spin')).toBeTruthy();
    resolveFirst(response({ ok: true, data: { items: [{ source: 'cocotrip', id: 'b1', bookingRef: 'REF-1', label: '첫 예약', date: '2026-09-21', amountKRW: 50000, priceUSD: '35', status: 'CONFIRMED', detail: '', createdAtMs: 1, isTest: false }], total: 1, counts: { cocotrip: 1, mood: 0 } } }));
    await waitFor(() => expect(screen.getByText('첫 예약')).toBeInTheDocument());

    let resolveSecond!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    authState.user = { getIdToken: vi.fn(async () => 'second-token') };
    view.rerender(<MemoryRouter><AdminAllBookings /></MemoryRouter>);
    expect(document.querySelector('svg.animate-spin')).toBeTruthy();
    resolveSecond(response({ ok: true, data: { items: [{ source: 'mood', id: 'm1', bookingRef: 'MOOD-1', label: '두 번째 예약', date: '2026-09-22', amountKRW: 70000, priceUSD: null, status: 'confirmed', detail: '', createdAtMs: 2, isTest: false }], total: 1, counts: { cocotrip: 0, mood: 1 } } }));
    await waitFor(() => expect(screen.getByText('두 번째 예약')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('AdminReconciliation reports a failed scan and manual retry can recover candidates', async () => {
    fetchMock.mockRejectedValueOnce(new Error('FAILED_PRECONDITION'));
    render(<MemoryRouter><AdminReconciliation /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('스캔 실패')).toBeInTheDocument());
    expect(screen.getByText('Firestore 인덱스 빌드 중입니다. 1~3분 후 새로고침 해주세요.', { exact: true })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(response({ ok: true, data: { candidates: [{ bookingId: 'b1', bookingRef: 'REF-1', productType: 'charter_custom_estimate', productLabel: '추정가 전세', amountKRW: 100000, amountUSD: '70', userEmail: 'synthetic@example.test', tourDate: '2026-09-22', provider: 'paypal', captureID: 'cap-1', createdAt: '2026-09-21T00:00:00.000Z', requiresReconciliation: true }], scanned: 1, rangeSince: '2026-09-20', rangeUntil: '2026-09-21' } }));
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(screen.getByText('추정가 전세')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
