// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- fetch 응답 모킹 스캐폴딩. */
/**
 * 마이페이지 예약 — 날짜 변경 저장 뒤 초점 복귀 (2026-10-23, 후속 ②b Astra r3).
 * 저장하면 목록이 로딩 화면으로 바뀌었다 돌아온다(카드 언마운트) → 모달 언마운트 시점의 복귀는 대상이 없다.
 * 잠그는 것: 재조회가 끝난 뒤 그 예약 카드의 "수정" 버튼에 초점 · 카드 버튼이 없으면 목록 컨테이너로 폴백.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../../src/i18n/locales/en.json';

void React;

const authFetchMock = vi.hoisted(() => vi.fn<(path: string, init?: any) => Promise<any>>());
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', email: 'm@example.com' }, loading: false }) }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('../../src/lib/authFetch', () => ({
  authFetch: (path: string, init?: any) => authFetchMock(path, init),
  authDownload: vi.fn(),
}));

const { MyBookingsTab } = await import('../../src/components/MyBookingsTab');
const { getWizardI18n } = await import('../../src/components/charter/wizard-i18n');
const { kstDatePlusDays } = await import('../../src/lib/bookingDateChange');

const dc = en.bookingDateChange;
const i18n = getWizardI18n('en');
const CURRENT = kstDatePlusDays(30);
const NEW = kstDatePlusDays(40);

function booking(over: Record<string, any> = {}) {
  return {
    id: 'B1', bookingRef: 'CT-B1', status: 'CONFIRMED', productType: 'tour_gyeongbok', tourDate: CURRENT,
    pickupLocation: '', dropoffLocation: '', paxCount: 2, vehicleType: 'van', amountKRW: 135000, amountUSD: '100.00',
    createdAt: null, canceledAt: null, refundedAmount: 0, canRefund: false, canModify: true, refundPercent: 0,
    hoursUntilTour: 720, ...over,
  };
}
const list = (bookings: any[]) => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { bookings } }) });

function cardModifyButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (b) => b.className.includes('customer-booking-action') && (b.textContent || '').includes(i18n.mbModifyBtn),
  ) as HTMLButtonElement | undefined;
}

/** 목록(즉시) → 수정 → 날짜 변경 → 저장 → 재조회(늦게 resolve). release() 로 재조회를 끝낸다. */
async function saveWithSlowReload(reloaded: any[]) {
  let release: () => void = () => {};
  const slow = new Promise<any>((r) => { release = () => r(list(reloaded)); });
  let listCalls = 0;
  authFetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/my-bookings')) {
      listCalls += 1;
      return listCalls === 1 ? list([booking()]) : slow;
    }
    if (path === '/api/modifyBooking') {
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { tourDate: NEW, emailSent: true, ignored: [] } }) };
    }
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter><MyBookingsTab userEmail="m@example.com" language="en" /></MemoryRouter>);
  await waitFor(() => expect(cardModifyButton()).toBeTruthy());
  fireEvent.click(cardModifyButton()!);
  fireEvent.click(await screen.findByRole('button', { name: dc.bdcButton }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(dc.bdcNew), { target: { value: NEW } });
  fireEvent.click(within(dialog).getByRole('button', { name: dc.bdcSubmit }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(listCalls).toBe(2));
  expect(cardModifyButton()).toBeUndefined(); // 재조회 중 — 카드 없음
  return release;
}

beforeEach(() => { authFetchMock.mockReset(); });
afterEach(() => cleanup());

describe('MyBookingsTab — focus after a saved date change', () => {
  it('returns focus to that booking card’s "Modify" button once the list has re-loaded', async () => {
    const release = await saveWithSlowReload([booking({ tourDate: NEW })]);
    release();
    await waitFor(() => expect(cardModifyButton()).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(cardModifyButton()));
  });

  it('falls back to the bookings container when the card button is gone after the re-load', async () => {
    const release = await saveWithSlowReload([booking({ tourDate: NEW, canModify: false })]);
    release();
    await waitFor(() => expect(document.querySelector('.customer-bookings-root')).toBeTruthy());
    expect(cardModifyButton()).toBeUndefined();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.customer-bookings-root')));
  });
});
