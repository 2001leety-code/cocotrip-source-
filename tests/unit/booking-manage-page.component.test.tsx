// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- fetch 응답 모킹 스캐폴딩. */
/**
 * /booking/manage 페이지 (2026-10-23, 후속 ②a 리뷰 P2).
 * 잠그는 것: 해시 토큰 읽고 주소창에서 제거 · 취소 409 → 최신 상태 재조회 + 안내(오류 화면 아님) ·
 *   5xx → 오류 화면의 "다시 조회"는 조회만 재시도(취소 재전송 없음) · 202 → 확인 중 · 401 → 링크 무효.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';

void React;

const copy = en.bookingManage;
const manageFetchMock = vi.hoisted(() => vi.fn<(path: string, opts: any) => Promise<any>>());
vi.mock('@/lib/manageFetch', () => ({ manageFetch: (path: string, opts: any) => manageFetchMock(path, opts) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en', t: en, changeLanguage: vi.fn() }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));

const BookingManagePage = (await import('../../src/pages/BookingManagePage')).default;

const BOOKING = {
  bookingID: 'ORD-1', bookingRef: 'CT-77', label: 'Gyeongbok Tour', tourDate: '2099-12-31', tourTime: '10:00', paxCount: 2,
  pickupLocation: 'Myeongdong', vehicleType: 'van', amountUSD: '100.00', currency: 'USD', status: 'CONFIRMED',
  canRefund: true, refundPercent: 100, maskedEmail: 'gu…＠example.com',
};
const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const lookupOk = (over: Record<string, any> = {}) => reply(200, { ok: true, data: { ...BOOKING, ...over } });

const calls = (path: string) => manageFetchMock.mock.calls.filter(([p]) => p === path);

async function openAndConfirm() {
  fireEvent.click(await screen.findByRole('button', { name: copy.bmCancelCta }));
  fireEvent.click(await screen.findByRole('button', { name: copy.bmConfirmCta }));
}

function renderPage() {
  window.history.replaceState(null, '', '/booking/manage#t=TOKEN-1');
  return render(<MemoryRouter initialEntries={['/booking/manage']}><BookingManagePage /></MemoryRouter>);
}

beforeEach(() => {
  cleanup();
  manageFetchMock.mockReset();
});

describe('/booking/manage', () => {
  it('reads #t=, strips it from the address bar, looks the booking up with the token', async () => {
    manageFetchMock.mockResolvedValueOnce(lookupOk());
    renderPage();
    expect(await screen.findByText('CT-77')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/booking/manage');
    expect(manageFetchMock).toHaveBeenCalledWith('/api/booking-manage', { manageToken: 'TOKEN-1' });
  });

  it('no token → invalid-link message, no request', async () => {
    window.history.replaceState(null, '', '/booking/manage');
    render(<MemoryRouter><BookingManagePage /></MemoryRouter>);
    expect(await screen.findByText(copy.bmInvalid)).toBeTruthy();
    expect(manageFetchMock).not.toHaveBeenCalled();
  });

  it('cancel 409 → reloads the latest status and shows the conflict notice (not the error screen)', async () => {
    manageFetchMock
      .mockResolvedValueOnce(lookupOk())
      .mockResolvedValueOnce(reply(409, { ok: false, code: 'NO_REFUND', error: 'closed' }))
      .mockResolvedValueOnce(lookupOk({ canRefund: false, refundPercent: 0 }));
    renderPage();
    await openAndConfirm();
    expect(await screen.findByText(copy.bmCancelConflict)).toBeTruthy();
    expect(calls('/api/booking-manage')).toHaveLength(2);
    expect(calls('/api/cancelBooking')).toHaveLength(1);
    expect(calls('/api/cancelBooking')[0][1]).toEqual({ manageToken: 'TOKEN-1', body: { bookingID: 'ORD-1', reason: '' } });
    expect(screen.queryByText(copy.bmResultError)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.bmCancelCta })).toBeNull();
  });

  it('cancel 5xx → error screen; "check again" retries the lookup only (no second cancel)', async () => {
    manageFetchMock
      .mockResolvedValueOnce(lookupOk())
      .mockResolvedValueOnce(reply(500, { ok: false, code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce(lookupOk({ status: 'CANCELED', canRefund: false }));
    renderPage();
    await openAndConfirm();
    fireEvent.click(await screen.findByRole('button', { name: copy.bmRetryLookup }));
    expect(await screen.findByText(copy.bmStatusCanceled)).toBeTruthy();
    expect(calls('/api/cancelBooking')).toHaveLength(1);
    expect(calls('/api/booking-manage')).toHaveLength(2);
  });

  it('network failure on the first lookup → error screen with "check again"', async () => {
    manageFetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(lookupOk());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: copy.bmRetryLookup }));
    expect(await screen.findByText('CT-77')).toBeTruthy();
  });

  it('202 → pending message; 401 → invalid link', async () => {
    manageFetchMock.mockResolvedValueOnce(lookupOk()).mockResolvedValueOnce(reply(202, { ok: false, code: 'REFUND_PENDING_VERIFICATION' }));
    renderPage();
    await openAndConfirm();
    expect(await screen.findByText(copy.bmResultPending)).toBeTruthy();

    cleanup();
    manageFetchMock.mockReset();
    manageFetchMock.mockResolvedValueOnce(lookupOk()).mockResolvedValueOnce(reply(401, { ok: false, code: 'AUTH_REQUIRED' }));
    renderPage();
    await openAndConfirm();
    await waitFor(() => expect(screen.getByText(copy.bmInvalid)).toBeTruthy());
    expect(calls('/api/booking-manage')).toHaveLength(1);
  });
});
