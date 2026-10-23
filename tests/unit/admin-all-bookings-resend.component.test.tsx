// @vitest-environment jsdom
/**
 * /admin/all-bookings — 게스트 "관리 링크 재발송" 버튼 (2026-10-23, PR-3).
 * 잠그는 것: 노출 조건(게스트 PayPal + CONFIRMED 만, 미전달 pending 배지) · 확인 → POST 본문 · 성공 토스트(마스킹 주소) ·
 *   429 문구 · 502 서버 문구.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const fetchMock = vi.fn();
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'synthetic-token') }, loading: false }));

vi.stubGlobal('fetch', fetchMock);
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: toastSpy }));

const { default: AdminAllBookings } = await import('../../src/pages/AdminAllBookings');

const row = (over: Record<string, unknown>) => ({
  source: 'cocotrip', kind: 'paypal', date: '2026-11-20', amountKRW: 135000, priceUSD: 100, status: 'CONFIRMED',
  detail: '', createdAtMs: 1, isTest: false, captureID: 'CAP', parentOrderID: null, refundable: false,
  guestManaged: false, manageLinkPending: false, manageLinkResentAt: null, ...over,
});
const LIST = {
  ok: true,
  data: {
    items: [
      row({ id: 'G-1', bookingRef: 'G-1', label: '게스트 예약', guestManaged: true, manageLinkPending: true }),
      row({ id: 'M-1', bookingRef: 'M-1', label: '회원 예약' }),
      row({ id: 'G-2', bookingRef: 'G-2', label: '취소된 게스트', guestManaged: true, status: 'CANCELED' }),
    ],
    total: 3,
    counts: { cocotrip: 3, mood: 0, paypal: 3 },
  },
};
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function articleOf(label: string) {
  return screen.getByText(label).closest('article') as HTMLElement;
}

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  Object.values(toastSpy).forEach((f) => f.mockReset());
  authState.user = { getIdToken: vi.fn(async () => 'synthetic-token') };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderList() {
  fetchMock.mockResolvedValueOnce(json(LIST));
  render(<MemoryRouter><AdminAllBookings /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('게스트 예약')).toBeInTheDocument());
}

describe('AdminAllBookings — resend manage link', () => {
  it('button only on CONFIRMED guest PayPal rows; pending badge shown', async () => {
    await renderList();
    const guest = articleOf('게스트 예약');
    expect(within(guest).getByRole('button', { name: '관리 링크 재발송' })).toBeInTheDocument();
    expect(within(guest).getByText('링크 전달 확인 필요')).toBeInTheDocument();
    expect(within(articleOf('회원 예약')).queryByRole('button', { name: '관리 링크 재발송' })).toBeNull();
    expect(within(articleOf('취소된 게스트')).queryByRole('button', { name: '관리 링크 재발송' })).toBeNull();
  });

  it('confirm → POST resend-manage-link with Bearer → success toast with the masked address', async () => {
    await renderList();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { recipientMasked: 'g***@example.com' } }));
    fetchMock.mockResolvedValueOnce(json(LIST)); // 성공 후 목록 갱신
    fireEvent.click(within(articleOf('게스트 예약')).getByRole('button', { name: '관리 링크 재발송' }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('g***@example.com 로 관리 링크를 보냈습니다'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain('/api/admin-all-bookings');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/admin-booking-action');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer synthetic-token');
    expect(JSON.parse(init.body)).toEqual({ bookingRef: 'G-1', action: 'resend-manage-link' });
  });

  it('while the request is in flight the button is disabled (no double send from the UI)', async () => {
    await renderList();
    let resolvePost!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));
    fireEvent.click(within(articleOf('게스트 예약')).getByRole('button', { name: '관리 링크 재발송' }));
    const busy = await within(articleOf('게스트 예약')).findByRole('button', { name: '보내는 중…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(json(LIST));
    resolvePost(json({ ok: true, data: { recipientMasked: 'g***@example.com' } }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledTimes(1));
  });

  it('cancelled confirm → no request', async () => {
    await renderList();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(articleOf('게스트 예약')).getByRole('button', { name: '관리 링크 재발송' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 → "1분 뒤" message; 502 → server message', async () => {
    await renderList();
    const btn = () => within(articleOf('게스트 예약')).getByRole('button', { name: '관리 링크 재발송' });

    fetchMock.mockResolvedValueOnce(json({ ok: false, code: 'RESEND_TOO_SOON', error: 'x' }, 429));
    fireEvent.click(btn());
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith('방금 재발송했습니다 — 1분 뒤 다시 시도하세요'));

    fetchMock.mockResolvedValueOnce(json({ ok: false, code: 'MAIL_FAILED', error: '메일 발송 실패 — 잠시 후 다시 시도하세요' }, 502));
    await waitFor(() => expect(btn()).not.toBeDisabled());
    fireEvent.click(btn());
    await waitFor(() => expect(toastSpy.error).toHaveBeenLastCalledWith('메일 발송 실패 — 잠시 후 다시 시도하세요'));
  });
});
