// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { calculateQuote, useQuoteCalculator } from '../../src/hooks/useQuoteCalculator';
import { resolveKmFromCoords } from '../../src/lib/calculatorDistance';
import { useCharterRouteKm } from '../../src/lib/charterRouteKm';
import type { WizardState } from '../../src/components/charter/types';

const base: WizardState = {
  service: 'day_tour', vehicle: 'staria', paxCount: 2, adultCount: 2, childCount: 0,
  options: {}, originCustom: 'Synthetic origin', destinationCustom: 'Synthetic destination',
};
function deferredFetch() {
  const replies: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => replies.push(resolve)));
  vi.stubGlobal('fetch', fetchMock);
  return { replies, fetchMock };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('clears pending geocoding when switching to a known package and ignores the old reply', async () => {
  const { replies, fetchMock } = deferredFetch();
  const { result, rerender } = renderHook(state => useQuoteCalculator(state), { initialProps: base });
  expect(result.current.loading).toBe(true);
  const known = { ...base, destinationKey: 'gyeongju-jeonju' };
  rerender(known);
  expect(result.current.loading).toBe(false);
  expect(result.current.quote).toEqual(calculateQuote(known));
  await act(async () => replies[0](new Response(JSON.stringify({ km: 900 }))));
  expect(result.current.quote).toEqual(calculateQuote(known));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('uses only the latest distance response and keeps a manual override through a failed lookup', async () => {
  const { replies, fetchMock } = deferredFetch();
  const { result, rerender } = renderHook(({ state, manual }) => useQuoteCalculator(state, manual), {
    initialProps: { state: base, manual: null as number | null },
  });
  rerender({ state: { ...base, destinationCustom: 'Synthetic B' }, manual: null });
  await act(async () => replies[1](new Response(JSON.stringify({ km: 42 }))));
  const quoteB = result.current.quote;
  expect(quoteB?.distanceKm).toBe(42);
  await act(async () => replies[0](new Response(JSON.stringify({ km: 900 }))));
  expect(result.current.quote).toEqual(quoteB);
  rerender({ state: { ...base, destinationCustom: 'Synthetic C' }, manual: 55 });
  await act(async () => replies[2](new Response('{}', { status: 500 })));
  expect(result.current.loading).toBe(false);
  expect(result.current.geocodingFailed).toBe(false);
  expect(result.current.distanceSource).toBe('manual');
  expect(result.current.quote?.distanceKm).toBe(55);
  rerender({ state: { ...base, destinationCustom: 'Synthetic C' }, manual: null });
  expect(result.current.geocodingFailed).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('resolves confirmed coordinates and missing or inquiry-only input without a network call', () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const coords = { ...base, originLat: 37.55, originLng: 126.97, destLat: 37.5, destLng: 127.03 };
  const { result, rerender } = renderHook(state => useQuoteCalculator(state), { initialProps: coords as WizardState });
  expect(result.current.quote?.distanceKm).toBe(resolveKmFromCoords(37.55, 126.97, 37.5, 127.03)?.km);
  expect(result.current.distanceSource).toBe('geocoding');
  rerender({ ...base, vehicle: 'bus' });
  expect(result.current.quote?.needsCustomQuote).toBe(true);
  expect(result.current.loading).toBe(false);
  rerender({ ...base, service: undefined });
  expect(result.current.quote).toBeNull();
  expect(result.current.distanceSource).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('never reuses the previous route distance for new coordinates and preserves the request payload', async () => {
  vi.stubEnv('VITE_FEATURE_CHARTER_WAYPOINTS', 'true');
  const { replies, fetchMock } = deferredFetch();
  const route = { ...base, originLat: 37.11, originLng: 126.11, destLat: 37.22, destLng: 127.22,
    waypoints: [{ name: 'Synthetic waypoint', lat: 37.15, lng: 126.5 }] } as WizardState;
  const { result, rerender } = renderHook(state => useCharterRouteKm(state), { initialProps: route });
  expect(result.current.loading).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('/api/charter-route-km', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeCoords: result.current.routeCoords }),
  });
  await act(async () => replies[0](new Response(JSON.stringify({ ok: true, data: { km: 123 } }))));
  expect(result.current.routeKm).toBe(123);
  rerender({ ...route, destLat: 37.33 });
  expect(result.current.loading).toBe(true);
  expect(result.current.routeKm).toBeNull();
  rerender(route);
  expect(result.current.loading).toBe(false);
  expect(result.current.routeKm).toBe(123);
  await act(async () => replies[1](new Response(JSON.stringify({ ok: true, data: { km: 456 } }))));
  expect(result.current.routeKm).toBe(123);
  rerender({ ...route, waypoints: [] });
  expect(result.current).toEqual({ routeKm: null, routeCoords: null, loading: false, failed: false });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('retains a cached route failure as a blocking signal without retrying or charging', async () => {
  vi.stubEnv('VITE_FEATURE_CHARTER_WAYPOINTS', 'true');
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
  const state = { ...base, originLat: 37.41, originLng: 126.41, destLat: 37.42, destLng: 127.42,
    waypoints: [{ name: 'Synthetic waypoint', lat: 37.45, lng: 126.45 }] } as WizardState;
  const { result, rerender } = renderHook(value => useCharterRouteKm(value), { initialProps: state });
  await waitFor(() => expect(result.current.failed).toBe(true));
  rerender({ ...state, waypoints: [] });
  rerender(state);
  expect(result.current.loading).toBe(false);
  expect(result.current.failed).toBe(true);
  expect(result.current.routeKm).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
