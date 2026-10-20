// @vitest-environment jsdom
// Staleness matrix for DayRouteMap's on-demand /api/course-route fetch.
// Covers cases the recovery suite does not: coordinate-only change, reorder,
// late response after a same-scope coordinate change, network error -> retry,
// rate-limit copy, and unmount while pending. Provider fetch is mocked (no TMAP call).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayRouteMap } from '../../src/pages/PlanDetailPage/components/DayRouteMap';
import type { PlanStop } from '../../src/pages/PlanDetailPage/types';

void React;
const leaflet = vi.hoisted(() => ({ map: vi.fn(), polyline: vi.fn(), marker: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('leaflet', () => {
  const layer = () => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis() });
  return { default: { ...leaflet, tileLayer: layer, divIcon: vi.fn(), latLngBounds: () => ({ extend: vi.fn() }) } };
});

const SHOW = 'Show transit route';
const NONE = 'No transit route was found for this day.';
const UNAVAILABLE = "Couldn't load transit routes right now. Please try again in a moment.";
const RATE_LIMITED = 'Too many route requests right now. Please wait a moment and try again.';
const A = { category: 'culture', name: 'Palace', lat: 37.58, lng: 126.98 };
const B = { category: 'culture', name: 'Museum', lat: 37.59, lng: 126.99 };
const C = { category: 'food', name: 'Market', lat: 37.57, lng: 127.0 };
const day = (...s: object[]) => s as PlanStop[];
const busStep = (from: [number, number], to: [number, number]) =>
  ({ mode: 'bus', path: [...from, ...to], busNo: '100', routeColor: '#123456' });
const ok = (segments: unknown[]) => ({ ok: true, status: 200, json: async () => ({ ok: true, segments }) }) as Response;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
/** Polylines drawn after the most recent Leaflet map instance was created. */
function lastMapPolylines() {
  const start = leaflet.map.mock.invocationCallOrder.at(-1) ?? 0;
  return leaflet.polyline.mock.calls.filter((_, i) => leaflet.polyline.mock.invocationCallOrder[i] > start);
}
const isSolidRoute = (call: unknown[]) => (call[1] as { color?: string }).color === '#123456';
const isDashed = (call: unknown[]) => (call[1] as { dashArray?: string }).dashArray === '4, 8';

// Harness note: when two effects dynamic-import 'leaflet' concurrently before the mock
// is resolved, vitest can hand the 2nd importer the REAL module (seen while writing this
// suite). Pre-resolve the mocked module once; tests that rerender mid-import also wait
// for the first map so the cancelled effect's import cannot race the mock.
beforeAll(async () => { await import('leaflet'); await import('leaflet/dist/leaflet.css'); });
beforeEach(() => {
  vi.clearAllMocks();
  leaflet.map.mockReturnValue({ fitBounds: vi.fn(), invalidateSize: vi.fn(), remove: leaflet.remove });
  leaflet.polyline.mockImplementation(() => ({ addTo: vi.fn() }));
  leaflet.marker.mockImplementation(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fetchAndInstall() {
  fireEvent.click(screen.getByRole('button', { name: SHOW }));
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  await waitFor(() => expect(lastMapPolylines().some(isSolidRoute)).toBe(true));
}

describe('DayRouteMap staleness matrix', () => {
  it('coordinate-only change (same count, names, scope) drops fetched legs and redraws a straight fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([{ to: 1, steps_detail: [busStep([37.58, 126.98], [37.59, 126.99])] }])));
    const { rerender } = render(<DayRouteMap stops={day(A, B)} routeScopeKey="P:day:0" />);
    await fetchAndInstall();
    const maps = leaflet.map.mock.calls.length;
    rerender(<DayRouteMap stops={day(A, { ...B, lat: 37.595 })} routeScopeKey="P:day:0" />);
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    await waitFor(() => expect(leaflet.map.mock.calls.length).toBeGreaterThan(maps));
    const lines = lastMapPolylines();
    expect(lines.some(isSolidRoute)).toBe(false);
    expect(lines).toEqual([[[[37.58, 126.98], [37.595, 126.99]], expect.objectContaining({ dashArray: '4, 8' })]]);
  });

  it('reordering the same stops invalidates fetched legs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([
      { to: 1, steps_detail: [busStep([37.58, 126.98], [37.59, 126.99])] },
      { to: 2, steps_detail: [busStep([37.59, 126.99], [37.57, 127.0])] },
    ])));
    const { rerender } = render(<DayRouteMap stops={day(A, B, C)} routeScopeKey="P:day:0" />);
    await fetchAndInstall();
    const maps = leaflet.map.mock.calls.length;
    rerender(<DayRouteMap stops={day(A, C, B)} routeScopeKey="P:day:0" />);
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    await waitFor(() => expect(leaflet.map.mock.calls.length).toBeGreaterThan(maps));
    const lines = lastMapPolylines();
    expect(lines.some(isSolidRoute)).toBe(false);
    expect(lines.every(isDashed)).toBe(true);
  });

  it('discards a late response after a same-scope coordinate change and aborts it', async () => {
    const late = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(late.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<DayRouteMap stops={day(A, B)} routeScopeKey="P:day:0" />);
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    rerender(<DayRouteMap stops={day(A, { ...B, lng: 126.995 })} routeScopeKey="P:day:0" />);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { late.resolve(ok([{ to: 1, steps_detail: [busStep([37.58, 126.98], [37.59, 126.99])] }])); });
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    expect(screen.queryByText(NONE)).toBeNull();
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(2));
    expect(lastMapPolylines().some(isSolidRoute)).toBe(false);
  });

  it('network error leaves a retry state; retry installs the route and clears the message', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok([{ to: 1, steps_detail: [busStep([37.58, 126.98], [37.59, 126.99])] }]));
    vi.stubGlobal('fetch', fetchMock);
    render(<DayRouteMap stops={day(A, B)} routeScopeKey="P:day:0" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
    await fetchAndInstall();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 429 rate limit is shown as a distinct rate-limit message, not as "no route found"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ ok: false, code: 'RATE_LIMITED' }),
    } as Response));
    render(<DayRouteMap stops={day(A, B)} routeScopeKey="P:day:0" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    expect(await screen.findByText(RATE_LIMITED)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.getByRole('button', { name: SHOW })).toBeEnabled();
  });

  it('aborts the pending request on unmount and ignores its late response', async () => {
    const late = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(late.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<DayRouteMap stops={day(A, B)} routeScopeKey="P:day:0" />);
    fireEvent.click(screen.getByRole('button', { name: SHOW }));
    unmount();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { late.resolve(ok([])); });
  });
});
