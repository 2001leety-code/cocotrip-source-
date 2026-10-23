// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- fetch 응답 모킹 스캐폴딩. */
/**
 * BookingDateChangeModal (2026-10-23, 후속 ②b) — 회원·게스트 공용 날짜 변경 모달.
 * 잠그는 것: min/max(KST 내일~+365) · 같은 날짜/미선택 제출 비활성 · 코드별 문구 · BOOKING_CHANGED 다시 불러오기 ·
 *   회원 = authFetch POST JSON / 게스트 = manageFetch(본문 토큰) 전송 계약 · requestId 1개를 재시도에도 재사용 ·
 *   게스트 성공 응답의 새 토큰을 onSaved 로 넘긴다.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';

void React;

const copy = en.bookingDateChange;
const authFetchMock = vi.hoisted(() => vi.fn<(path: string, init: any) => Promise<any>>());
const manageFetchMock = vi.hoisted(() => vi.fn<(path: string, opts: any) => Promise<any>>());
vi.mock('@/lib/authFetch', () => ({ authFetch: (p: string, i: any) => authFetchMock(p, i) }));
vi.mock('@/lib/manageFetch', () => ({ manageFetch: (p: string, o: any) => manageFetchMock(p, o) }));

const { BookingDateChangeModal } = await import('../../src/components/BookingDateChangeModal');
const { kstDatePlusDays } = await import('../../src/lib/bookingDateChange');

const CURRENT = kstDatePlusDays(30);
const NEW = kstDatePlusDays(40);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function renderModal(auth: any, extra: Record<string, any> = {}) {
  const onSaved = vi.fn(async () => undefined);
  const onClose = vi.fn();
  const onReload = vi.fn();
  render(
    <BookingDateChangeModal
      bookingID="ORD-1" bookingRef="CT-1" currentDate={CURRENT} language="en"
      auth={auth} onClose={onClose} onSaved={onSaved} onReload={onReload} {...extra}
    />,
  );
  return { onSaved, onClose, onReload };
}
const dateInput = () => screen.getByLabelText(copy.bdcNew) as HTMLInputElement;
const submitBtn = () => screen.getByRole('button', { name: copy.bdcSubmit }) as HTMLButtonElement;

beforeEach(() => {
  cleanup();
  authFetchMock.mockReset();
  manageFetchMock.mockReset();
});

describe('BookingDateChangeModal', () => {
  it('date range = KST tomorrow … +365, submit disabled until a different date is picked', () => {
    renderModal({ kind: 'member' });
    expect(dateInput().min).toBe(kstDatePlusDays(1));
    expect(dateInput().max).toBe(kstDatePlusDays(365));
    expect(submitBtn().disabled).toBe(true);
    fireEvent.change(dateInput(), { target: { value: CURRENT } });
    expect(submitBtn().disabled).toBe(true);
    expect(screen.getByText(copy.bdcSameDate)).toBeTruthy();
    fireEvent.change(dateInput(), { target: { value: NEW } });
    expect(submitBtn().disabled).toBe(false);
    expect(screen.getByText(copy.bdcNotePolicy)).toBeTruthy();
  });

  it('member → authFetch POST JSON { bookingID, changes:{tourDate}, requestId }', async () => {
    authFetchMock.mockResolvedValue(reply(200, { ok: true, data: { tourDate: NEW, emailSent: true, ignored: [] } }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [path, init] = authFetchMock.mock.calls[0];
    expect(path).toBe('/api/modifyBooking');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ bookingID: 'ORD-1', changes: { tourDate: NEW } });
    expect(body.requestId).toMatch(UUID_V4);
    expect(manageFetchMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ tourDate: NEW, emailSent: true }));
  });

  it('guest → manageFetch with the token in the body; new token handed to onSaved', async () => {
    manageFetchMock.mockResolvedValue(reply(200, { ok: true, data: { tourDate: NEW, manageToken: 'NEW-TOKEN', emailSent: false } }));
    const { onSaved } = renderModal({ kind: 'guest', manageToken: 'OLD-TOKEN' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [path, opts] = manageFetchMock.mock.calls[0];
    expect(path).toBe('/api/modifyBooking');
    expect(opts.manageToken).toBe('OLD-TOKEN');
    expect(opts.body).toMatchObject({ bookingID: 'ORD-1', changes: { tourDate: NEW } });
    expect(opts.body.requestId).toMatch(UUID_V4);
    expect(authFetchMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ tourDate: NEW, manageToken: 'NEW-TOKEN', emailSent: false }));
  });

  it('network loss → one automatic retry with the SAME requestId; recovered response counts as success', async () => {
    manageFetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(200, { ok: true, data: { tourDate: NEW, manageToken: 'REC', recovered: true, emailSent: false } }));
    const { onSaved } = renderModal({ kind: 'guest', manageToken: 'OLD' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(manageFetchMock).toHaveBeenCalledTimes(2);
    expect(manageFetchMock.mock.calls[0][1].body.requestId).toBe(manageFetchMock.mock.calls[1][1].body.requestId);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ manageToken: 'REC', recovered: true }));
  });

  it('requestId stays the same across a failed attempt and a manual resubmit', async () => {
    authFetchMock
      .mockResolvedValueOnce(reply(503, { ok: false, code: 'MANAGE_LINK_UNAVAILABLE' }))
      .mockResolvedValueOnce(reply(200, { ok: true, data: { tourDate: NEW } }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    expect(await screen.findByText(new RegExp(copy.bdcErrLinkUnavailable.slice(0, 20)))).toBeTruthy();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const ids = authFetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it.each([
    ['SLOT_FULL', 'bdcErrSlotFull'],
    ['DATE_UNAVAILABLE', 'bdcErrDateUnavailable'],
    ['NEW_DATE_TOO_SOON', 'bdcErrTooSoon'],
    ['NEW_DATE_TOO_FAR', 'bdcErrTooFar'],
    ['SLOT_BINDING_MISSING', 'bdcErrNoSeatRecord'],
    ['MODIFY_WINDOW_CLOSED', 'bdcErrWindowClosed'],
    ['MANAGE_LINK_UNAVAILABLE', 'bdcErrLinkUnavailable'],
    ['SOMETHING_NEW', 'bdcErrGeneric'],
  ] as const)('%s → its own message', async (code, key) => {
    authFetchMock.mockResolvedValue(reply(409, { ok: false, code }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain((copy as Record<string, string>)[key]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('sends the screen language in the body (server uses it for the confirmation mail)', async () => {
    authFetchMock.mockResolvedValue(reply(200, { ok: true, data: { tourDate: NEW } }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(authFetchMock.mock.calls[0][1].body).language).toBe('en');
  });

  // Astra r1 P2 — 회원은 어느 제출에서든 SAME_DATE = 이미 반영(응답만 유실).
  it('member: 200 with an unreadable body → error → manual resubmit → SAME_DATE → saved (same requestId)', async () => {
    authFetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('cut'); } })
      .mockResolvedValueOnce(reply(400, { ok: false, code: 'SAME_DATE' }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await screen.findByRole('alert');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ tourDate: NEW, emailSent: false, recovered: true, ignored: [] }));
    const ids = authFetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('member: network fails twice → error → manual resubmit → SAME_DATE → saved', async () => {
    authFetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(400, { ok: false, code: 'SAME_DATE' }));
    const { onSaved } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await screen.findByRole('alert');
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ tourDate: NEW, recovered: true })));
    expect(authFetchMock).toHaveBeenCalledTimes(3);
  });

  it('guest: SAME_DATE is NOT treated as success (guests recover through the server)', async () => {
    manageFetchMock.mockResolvedValue(reply(400, { ok: false, code: 'SAME_DATE' }));
    const { onSaved } = renderModal({ kind: 'guest', manageToken: 'T' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain(copy.bdcSameDate);
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Astra r1 P2 — Radix Dialog: 초점 이동·제한, 제출 중 닫기 무시.
  it('focus moves into the dialog on open', async () => {
    renderModal({ kind: 'member' });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Esc is ignored while submitting, and closes once the request has finished', async () => {
    let resolve: (v: any) => void = () => {};
    authFetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { onClose } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    await screen.findByRole('button', { name: copy.bdcSubmitting });
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    resolve(reply(409, { ok: false, code: 'SLOT_FULL' }));
    await screen.findByRole('alert');
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('BOOKING_CHANGED → "reload" calls onReload', async () => {
    authFetchMock.mockResolvedValue(reply(409, { ok: false, code: 'BOOKING_CHANGED' }));
    const { onReload } = renderModal({ kind: 'member' });
    fireEvent.change(dateInput(), { target: { value: NEW } });
    fireEvent.click(submitBtn());
    fireEvent.click(await screen.findByRole('button', { name: copy.bdcReload }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
