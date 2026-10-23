// @vitest-environment jsdom
/**
 * /admin/reconciliation — 재전송 후보 화면 (2026-10-23, PR-4).
 * 잠그는 것: 상태 배지(실패/결과 미상 + "수신 확인 필요") · 텔레그램 별도 표시 · 일괄 버튼 = "실패 N건 미완료 단계 재처리" ·
 *   일괄 replayed 0: 대상 없음 = 정보 / 전부 미완료 = 오류 / 1건↑ = 성공 · 단건 미완료 = 경고, 이미 완료 = 정보(성공 아님) ·
 *   후보 0 문구 "조회 N건 중 후보 0"(전체 정상 단정 금지) · 정산 대상은 알림 상태와 별도 구역.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const fetchMock = vi.fn();
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'synthetic-token') }, loading: false }));

vi.stubGlobal('fetch', fetchMock);
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: toastSpy }));

const { default: AdminReconciliation } = await import('../../src/pages/AdminReconciliation');

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cand = (over: Record<string, unknown>) => ({
  bookingRef: null, productType: 'tour_gyeongbok', productLabel: '경복궁 투어', amountKRW: 135000, amountUSD: '100',
  userEmail: 'g@example.com', tourDate: '2026-11-20', provider: 'paypal', captureID: 'CAP', createdAt: '2026-10-21T00:00:00.000Z',
  requiresReconciliation: false, missingSteps: ['email'], lastFailureReason: null, telegram: 'complete', ...over,
});
const SCAN = {
  ok: true,
  data: {
    candidates: [cand({ bookingId: 'ORD-FAIL', state: 'failed' }), cand({ bookingId: 'ORD-UNK', state: 'unknown', telegram: 'missing' })],
    reconciliation: [],
    scanned: 12, rangeSince: '2026-05-03T11:51:00.000Z', rangeUntil: '2026-10-23T00:00:00.000Z',
  },
};
const EMPTY = { ok: true, data: { candidates: [], reconciliation: [], scanned: 12, rangeSince: 'a', rangeUntil: 'b' } };
const BATCH = /실패 1건 미완료 단계 재처리/;

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  Object.values(toastSpy).forEach((f) => f.mockReset());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderPage(scan: unknown = SCAN) {
  fetchMock.mockResolvedValueOnce(json(scan));
  render(<MemoryRouter><AdminReconciliation /></MemoryRouter>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
}

describe('AdminReconciliation — candidates', () => {
  it('state badges + batch button counts failed only', async () => {
    await renderPage();
    const table = await screen.findByRole('table'); // 설명문·가이드에도 같은 단어가 있어 표 안으로 좁힌다
    expect(within(table).getByText('실패')).toBeInTheDocument();
    expect(within(table).getByText('결과 미상')).toBeInTheDocument();
    expect(within(table).getByText('수신 확인 필요')).toBeInTheDocument(); // unknown 은 "재전송 가능" 이 아니라 수신 확인
    expect(within(table).getByText('텔레그램: 기록 없음')).toBeInTheDocument(); // 텔레그램은 판정과 별도 표시
    expect(screen.getByRole('button', { name: BATCH })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /2건/ })).toBeNull();
    expect(within(table).getAllByText('확인메일').length).toBe(2); // missingSteps 라벨
  });

  it('reconciliation targets render in their own section even when there are no replay candidates', async () => {
    await renderPage({ ...EMPTY, data: { ...EMPTY.data, reconciliation: [cand({ bookingId: 'ORD-EST', bookingRef: 'CT-EST-1', productLabel: '추정가 전세', requiresReconciliation: true, state: 'complete' })] } });
    const section = await screen.findByTestId('reconciliation-section');
    expect(within(section).getByText('CT-EST-1')).toBeInTheDocument();
    expect(within(section).getByText('추정가 전세')).toBeInTheDocument();
    expect(screen.getByText('조회 12건 중 재전송 후보 0건')).toBeInTheDocument();
  });

  it('batch replay with replayed 0 → no success toast, info "재전송 대상 0건"', async () => {
    await renderPage();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { mode: 'replay', replayed: 0, failed: 0, results: [], skippedUnknown: ['ORD-UNK'] } }));
    fetchMock.mockResolvedValueOnce(json(SCAN)); // 재스캔
    fireEvent.click(await screen.findByRole('button', { name: BATCH }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalledWith('재전송 대상 0건'));
    expect(toastSpy.success).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ dryRun: false });
  });

  it('batch replay where every attempt failed → error toast, not success', async () => {
    await renderPage();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { mode: 'replay', replayed: 0, failed: 1, results: [{ ok: false }], skippedUnknown: [] } }));
    fetchMock.mockResolvedValueOnce(json(SCAN));
    fireEvent.click(await screen.findByRole('button', { name: BATCH }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it('batch replay with replayed > 0 → success toast', async () => {
    await renderPage();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { mode: 'replay', replayed: 1, failed: 0, results: [{ ok: true }], skippedUnknown: ['ORD-UNK'] } }));
    fetchMock.mockResolvedValueOnce(json(SCAN));
    fireEvent.click(await screen.findByRole('button', { name: BATCH }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith('1건 재전송 완료'));
  });

  it('single replay that the processor did not finish → warning, not success', async () => {
    await renderPage();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { bookingId: 'ORD-UNK', replayed: false, outcome: 'manual_intervention', state: 'unknown' } }));
    fetchMock.mockResolvedValueOnce(json(SCAN));
    fireEvent.click((await screen.findAllByRole('button', { name: /알림 재전송/ }))[1]);
    await waitFor(() => expect(toastSpy.warning).toHaveBeenCalled());
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it('single replay of an already-complete booking (replayed:false, ALREADY_COMPLETE) → info, not success', async () => {
    await renderPage();
    fetchMock.mockResolvedValueOnce(json({ ok: true, data: { bookingId: 'ORD-FAIL', replayed: false, state: 'complete', reason: 'ALREADY_COMPLETE' } }));
    fetchMock.mockResolvedValueOnce(json(SCAN));
    fireEvent.click((await screen.findAllByRole('button', { name: /알림 재전송/ }))[0]);
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalled());
    expect(String(toastSpy.info.mock.calls[0][0])).toContain('이미 처리 완료');
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it('zero candidates → "조회 N건 중 재전송 후보 0건" (no "all notifications sent" claim), no batch button', async () => {
    await renderPage(EMPTY);
    expect(await screen.findByText('조회 12건 중 재전송 후보 0건')).toBeInTheDocument();
    expect(screen.queryByText(/모든 알림이 정상/)).toBeNull();
    expect(screen.queryByRole('button', { name: /미완료 단계 재처리/ })).toBeNull();
  });
});
