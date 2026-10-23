// @vitest-environment jsdom
/**
 * /admin/all-bookings — 게스트 "관리 링크 재발송" 버튼 (2026-10-23, PR-3).
 * 잠그는 것: 노출 조건(게스트 PayPal + CONFIRMED 만, pending 배지) · 화면 내 확인창(닫기 = 요청 0, 요청 중 재제출 금지) ·
 *   POST 본문 · 성공 토스트(마스킹 주소)+목록 갱신 · 잠금은 화면 전체 하나(A 발송 중 B 도 비활성) · 429 문구 · 502 서버 문구.
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
      row({ id: 'G-3', bookingRef: 'G-3', label: '두번째 게스트', guestManaged: true }),
    ],
    total: 4,
    counts: { cocotrip: 4, mood: 0, paypal: 4 },
  },
};
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const RESEND = '관리 링크 재발송';

function articleOf(label: string) {
  return screen.getByText(label).closest('article') as HTMLElement;
}
const rowButton = (label: string) => within(articleOf(label)).getByRole('button', { name: /관리 링크 재발송|보내는 중…/ });
const dialog = () => screen.getByRole('dialog', { name: RESEND });
const postCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/admin-booking-action');

/** 행 버튼 → 화면 내 확인창 → 확인. */
function confirmResend(label: string) {
  fireEvent.click(rowButton(label));
  fireEvent.click(within(dialog()).getByRole('button', { name: '확인' }));
}

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  Object.values(toastSpy).forEach((f) => f.mockReset());
  authState.user = { getIdToken: vi.fn(async () => 'synthetic-token') };
});
afterEach(() => { cleanup(); });

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

  it('row button opens an in-page confirm (booking ref + stored-address notice); 닫기 → no request', async () => {
    await renderList();
    fireEvent.click(rowButton('게스트 예약'));
    const d = dialog();
    expect(within(d).getByText(/G-1/)).toBeInTheDocument();
    expect(within(d).getByText(/저장된 결제자 이메일로만/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it('확인 → POST resend-manage-link with Bearer → success toast (masked address), dialog closes, list reloads', async () => {
    await renderList();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { recipientMasked: 'g***@example.com' } }));
    fetchMock.mockResolvedValueOnce(json(LIST)); // 성공 후 목록 갱신
    confirmResend('게스트 예약');
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('g***@example.com 로 관리 링크를 보냈습니다'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain('/api/admin-all-bookings');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/admin-booking-action');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer synthetic-token');
    expect(JSON.parse(init.body)).toEqual({ bookingRef: 'G-1', action: 'resend-manage-link' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('while sending: dialog buttons disabled (no re-submit) and EVERY row button is locked; after completion all unlock, one request', async () => {
    await renderList();
    let resolvePost!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));
    confirmResend('게스트 예약');

    const busyConfirm = await within(dialog()).findByRole('button', { name: '보내는 중…' });
    expect(busyConfirm).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: '닫기' })).toBeDisabled();
    fireEvent.click(busyConfirm); // 재제출 시도
    expect(rowButton('게스트 예약')).toBeDisabled();
    expect(rowButton('게스트 예약')).toHaveTextContent('보내는 중…');
    expect(rowButton('두번째 게스트')).toBeDisabled(); // 다른 행도 잠긴다(행 단위 잠금이면 여기서 풀렸다)
    expect(rowButton('두번째 게스트')).toHaveTextContent(RESEND);
    fireEvent.click(rowButton('두번째 게스트'));
    expect(postCalls()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(json(LIST));
    resolvePost(json({ ok: true, data: { recipientMasked: 'g***@example.com' } }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rowButton('게스트 예약')).not.toBeDisabled());
    expect(rowButton('두번째 게스트')).not.toBeDisabled();
    expect(postCalls()).toHaveLength(1);
  });

  it('429 → "1분 뒤" message; 502 → server message', async () => {
    await renderList();

    fetchMock.mockResolvedValueOnce(json({ ok: false, code: 'RESEND_TOO_SOON', error: 'x' }, 429));
    confirmResend('게스트 예약');
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith('방금 재발송했습니다 — 1분 뒤 다시 시도하세요'));

    fetchMock.mockResolvedValueOnce(json({ ok: false, code: 'MAIL_FAILED', error: '메일을 보내지 못했습니다 — 1분 뒤 다시 시도하세요' }, 502));
    await waitFor(() => expect(rowButton('게스트 예약')).not.toBeDisabled());
    confirmResend('게스트 예약');
    await waitFor(() => expect(toastSpy.error).toHaveBeenLastCalledWith('메일을 보내지 못했습니다 — 1분 뒤 다시 시도하세요'));
  });
});
