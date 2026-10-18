// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayRouteMap } from '../../src/pages/PlanDetailPage/components/DayRouteMap';
import type { PlanStop } from '../../src/pages/PlanDetailPage/types';

void React;
const leaflet = vi.hoisted(() => ({ map: vi.fn(), polyline: vi.fn(), marker: vi.fn(), remove: vi.fn() }));
const lang = vi.hoisted(() => ({ current: 'en' }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: lang.current }) }));
vi.mock('leaflet', () => {
  const layer = () => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis() });
  return { default: { ...leaflet, tileLayer: layer, divIcon: vi.fn(), latLngBounds: () => ({ extend: vi.fn() }) } };
});
function stops(title = 'Museum', steps?: unknown[]): PlanStop[] {
  return [{ category: 'culture', name: 'Palace', lat: 37.58, lng: 126.98 },
    { category: 'culture', name: title, lat: 37.59, lng: 126.99,
      ...(steps ? { transit_from_prev: { steps_detail: steps } } : {}) }] as PlanStop[];
}
const step = { mode: 'bus', path: [37.58, 126.98, 37.59, 126.99], busNo: '100', routeColor: '#123456' };
function response(segments: unknown[], ok = true, bodyOk = true) {
  return { ok, json: async () => ({ ok: bodyOk, segments }) } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const SHOW = 'Show transit route';
const RETRY = 'Retry missing routes';
const LOADING = 'Finding route…';
const NONE = 'No transit route was found for this day.';
const PARTIAL = "Transit routes couldn't be found for some parts of this day. Missing parts are shown as straight lines.";
const CAPPED = 'Transit routes are shown where available. Any remaining connections are shown as straight lines.';
const UNAVAILABLE = "Couldn't load transit routes right now. Please try again in a moment.";
const RATE_LIMITED = 'Too many route requests right now. Please wait a moment and try again.';
/** A response carrying an explicit HTTP status, as the real API sends. */
function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const step2 = { mode: 'bus', path: [37.59, 126.99, 37.57, 127.0], busNo: '200', routeColor: '#654321' };
function threeStops(): PlanStop[] {
  return [...stops(), { category: 'food', name: 'Market', lat: 37.57, lng: 127.0 }] as PlanStop[];
}
/** Route colours drawn on the most recent Leaflet map instance. */
function drawnColors() {
  const start = leaflet.map.mock.invocationCallOrder.at(-1) || 0;
  return leaflet.polyline.mock.calls
    .filter((_, i) => leaflet.polyline.mock.invocationCallOrder[i] > start)
    .map((call) => (call[1] as { color?: string }).color);
}
/** Three stops; the first lookup returns only leg 1 of the two legs it tried. */
async function renderPartial(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 1, steps_detail: [step] }], legsLookedUp: 2 }));
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<DayRouteMap stops={threeStops()} routeScopeKey="A:1" />);
  fireEvent.click(screen.getByRole('button', { name: SHOW }));
  expect(await screen.findByText(PARTIAL)).toBeTruthy();
  await waitFor(() => expect(drawnColors()).toContain('#123456'));
  return view;
}

// Pre-resolve the mocked modules so a concurrent dynamic import cannot receive the real
// Leaflet (same harness note as day-route-map-staleness-matrix).
beforeAll(async () => { await import('leaflet'); await import('leaflet/dist/leaflet.css'); });
beforeEach(() => {
  vi.clearAllMocks();
  leaflet.map.mockReturnValue({ fitBounds: vi.fn(), invalidateSize: vi.fn(), remove: leaflet.remove });
  leaflet.polyline.mockImplementation(() => ({ addTo: vi.fn() }));
  leaflet.marker.mockImplementation(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); lang.current = 'en'; });

describe('day route request and render boundaries', () => {
  it.each(['resolve', 'reject'] as const)('ignores old %s and clears pending state after A → B → A', async completion => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finding route…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(<DayRouteMap stops={stops()} routeScopeKey="B:1" />);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    rerender(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    await act(async () => {
      if (completion === 'resolve') old.resolve(response([{ to: 1, steps_detail: [step] }]));
      else old.reject(new Error('old failure'));
    });
    expect(screen.getByRole('button', { name: 'Finding route…' })).toBeDisabled();
    expect(screen.queryByText('No transit route was found for this day.')).toBeNull();
    await act(async () => { fresh.resolve(response([{ to: 1, steps_detail: [step] }])); });
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not install a late response from the previous day into the committed day', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    rerender(<DayRouteMap stops={stops()} routeScopeKey="A:2" />);
    await act(async () => { old.resolve(response([{ to: 1, steps_detail: [step] }])); });
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    expect(screen.queryByText('No transit route was found for this day.')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP', response([{ to: 1, steps_detail: [step] }], false)],
    ['body', response([{ to: 1, steps_detail: [step] }], true, false)],
    ['LOOKUP_FAILED', reply({ ok: false, segments: [], code: 'LOOKUP_FAILED' })],
    ['HTTP 500', reply({ ok: false }, 500)],
  ])('treats a %s failure as a temporary load failure, not as a missing route', async (_kind, failed) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failed));
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
  });

  it('shows HTTP 429 as a rate limit and keeps the lookup available without retrying by itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ok: false, code: 'RATE_LIMITED' }, 429));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(RATE_LIMITED)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a network error is a load failure; a manual retry installs the route and clears the message', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 1, steps_detail: [step] }], legsLookedUp: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an empty successful answer for tried legs says no route was found and stays retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ok: true, segments: [], legsLookedUp: 1 })));
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(NONE)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
  });

  it('does not offer a retry when the API tried no legs (all skipped as very short)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ok: true, segments: [], legsLookedUp: 0, capped: false }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(NONE)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('partial result keeps found legs; retrying the missing ones merges both and ends the retry', async () => {
    const fetchMock = vi.fn();
    await renderPartial(fetchMock);
    expect(screen.getByRole('status')).toHaveTextContent(PARTIAL);
    fetchMock.mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 2, steps_detail: [step2] }], legsLookedUp: 2 }));
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(screen.queryByText(PARTIAL)).toBeNull();
    await waitFor(() => expect(drawnColors()).toEqual(expect.arrayContaining(['#123456', '#654321'])));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stops).toHaveLength(3);
  });

  it('a failed retry after a partial result keeps the found route and the retry', async () => {
    const fetchMock = vi.fn();
    await renderPartial(fetchMock);
    fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'RATE_LIMITED' }, 429));
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(await screen.findByText(RATE_LIMITED)).toBeTruthy();
    expect(screen.getByRole('button', { name: RETRY })).toBeEnabled();
    expect(drawnColors()).toContain('#123456');

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('button', { name: RETRY })).toBeEnabled();
    expect(drawnColors()).toContain('#123456');

    fetchMock.mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 2, steps_detail: [null] }], legsLookedUp: 2 }));
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(await screen.findByText(PARTIAL)).toBeTruthy();
    expect(drawnColors()).not.toContain('#654321');
    expect(drawnColors()).toContain('#123456');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a complete answer leaves no retry; a capped one says so without offering a retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 1, steps_detail: [step] }, { to: 2, steps_detail: [step2] }], legsLookedUp: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={threeStops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();

    fetchMock.mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 1, steps_detail: [step] }], legsLookedUp: 1, capped: true }));
    rerender(<DayRouteMap stops={threeStops()} routeScopeKey="A:2" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(CAPPED)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('capped with a skipped short first leg keeps all 12 routes, no retry, and neutral copy', async () => {
    // 14 stops: leg 1 is ~11 m (API skips <50 m), legs 2–13 all succeed, yet the API sets
    // capped because 13 total legs > its 12-leg budget. Only leg 1 is straight.
    const fourteen = Array.from({ length: 14 }, (_, i) => ({
      category: 'culture', name: `Stop ${i + 1}`, lat: i === 0 ? 37.58 : 37.5801 + (i - 1) * 0.01, lng: 126.98,
    })) as PlanStop[];
    const segments = Array.from({ length: 12 }, (_, i) => ({ to: i + 2, steps_detail: [step] }));
    const fetchMock = vi.fn().mockResolvedValue(reply({ ok: true, segments, legsLookedUp: 12, capped: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={fourteen} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByRole('status')).toHaveTextContent(CAPPED);
    expect(screen.queryByRole('button')).toBeNull();
    await waitFor(() => expect(drawnColors().filter((color) => color === '#123456').length).toBeGreaterThanOrEqual(12));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a retry is single-flight and its late answer is dropped after a scope change', async () => {
    const fetchMock = vi.fn();
    const { rerender } = await renderPartial(fetchMock);
    const late = deferred<Response>();
    fetchMock.mockReturnValueOnce(late.promise);
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    fireEvent.click(screen.getByRole('button', { name: LOADING }));
    expect(screen.getByRole('button', { name: LOADING })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    rerender(<DayRouteMap stops={threeStops()} routeScopeKey="A:2" />);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => { late.resolve(reply({ ok: false, code: 'RATE_LIMITED' }, 429)); });
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    expect(screen.queryByRole('button', { name: RETRY })).toBeNull();
    expect(screen.queryByText(PARTIAL)).toBeNull();
    expect(screen.queryByText(RATE_LIMITED)).toBeNull();
    await waitFor(() => expect(drawnColors()).not.toContain('#123456'));
  });

  it.each([
    ['ko', '빠진 경로 다시 찾기', '일부 구간의 대중교통 경로를 찾지 못했어요. 빠진 구간은 직선으로 표시합니다.', '경로 요청이 많아 잠시 제한되었어요. 잠시 후 다시 시도해 주세요.'],
    ['en', RETRY, PARTIAL, RATE_LIMITED],
    ['ja', '不足している経路を再検索', '一部区間の公共交通ルートを見つけられませんでした。不足区間は直線で表示しています。', 'ルート検索が集中しています。しばらく待ってからもう一度お試しください。'],
    ['zh', '重新查找缺失路线', '部分路段未找到公共交通路线，缺失部分以直线显示。', '路线请求过多，请稍等片刻后重试。'],
  ])('%s: partial and rate-limit copy and the retry name are localized', async (language, retryName, partialCopy, rateCopy) => {
    lang.current = language;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ ok: true, segments: [{ to: 1, steps_detail: [step] }], legsLookedUp: 2 }))
      .mockResolvedValueOnce(reply({ ok: false, code: 'RATE_LIMITED' }, 429));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={threeStops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(partialCopy)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: retryName }));
    expect(await screen.findByText(rateCopy)).toBeTruthy();
    expect(screen.getByRole('button', { name: retryName })).toBeEnabled();
  });

  it.each([
    response([{ to: 99, steps_detail: [step] }]),
    response([{ to: 1, steps_detail: [null] }]),
    response([{ to: 1, steps_detail: [{ ...step, fromPoint: { lat: 37, lng: 127, name: {} } }] }]),
  ])('rejects index/step failures without installing route data', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(invalid));
    render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    expect(await screen.findByText('No transit route was found for this day.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    expect(drawnColors()).not.toContain('#123456');
  });

  it('redraws changed geometry, style and labels of equal size and prefers saved routes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={stops('Museum', [step])} routeScopeKey="A:1" />);
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(1));
    const changed = { ...step, mode: 'walk', path: [37.581, 126.981, 37.591, 126.991], routeColor: '#abcdef' };
    rerender(<DayRouteMap stops={stops('Museum new name', [changed])} routeScopeKey="A:1" />);
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(2));
    expect(leaflet.remove).toHaveBeenCalledTimes(1);
    expect(leaflet.polyline).toHaveBeenLastCalledWith([[37.581, 126.981], [37.591, 126.991]], expect.objectContaining({ color: '#abcdef', dashArray: '4, 8' }));
    expect(screen.getByText('Museum new name')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalidates fetched data on renamed visits, original numbering and same-coordinate day changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([{ to: 1, steps_detail: [step] }]));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={stops()} routeScopeKey="A:1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    rerender(<DayRouteMap stops={stops('Different visit')} routeScopeKey="A:1" />);
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    rerender(<DayRouteMap stops={[{ name: 'No coordinate' }, ...stops('Different visit')]} routeScopeKey="A:1" />);
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show transit route' }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    rerender(<DayRouteMap stops={stops()} routeScopeKey="A:2" />);
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
  });
});
