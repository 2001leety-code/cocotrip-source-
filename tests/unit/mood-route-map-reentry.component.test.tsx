// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoodRouteMap } from '@/components/MoodRouteMap';

const state = vi.hoisted(() => ({ loadMaps: vi.fn(), getNaver: vi.fn() }));
vi.mock('@/lib/naverMap', () => ({
  loadNaverMaps: state.loadMaps,
  getNaver: state.getNaver,
  naverMapSearchUrl: () => 'https://example.com/search',
  naverMapDirectionsUrl: () => 'https://example.com/directions',
}));

function deferred() {
  let finish!: () => void;
  return { promise: new Promise<void>((resolve) => { finish = resolve; }), finish };
}

const route = (id: number) => ({
  km: id,
  durationMin: id * 10,
  path: [[126.9, 37.5], [127, 37.6]] as [number, number][],
  points: [
    { lat: 37.5, lng: 126.9, role: 'origin' as const },
    { lat: 37.6, lng: 127, role: 'destination' as const },
  ],
});

function page(value: ReturnType<typeof route>) {
  return <MoodRouteMap origin="A" waypoints={[]} destination="B" route={value} accent="#7c5cfc" inputBg="#fff" inputBorder="1px solid" textDim="#555" />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_NCP_MAP_CLIENT_ID', 'synthetic-client');
  const Bounds = vi.fn(function Bounds() { return { extend: vi.fn() }; });
  const MapMock = vi.fn(function MapMock() { return { fitBounds: vi.fn() }; });
  const LatLng = vi.fn(function LatLng() {});
  const Polyline = vi.fn(function Polyline() {});
  const Marker = vi.fn(function Marker() {});
  const Point = vi.fn(function Point() {});
  state.getNaver.mockReturnValue({
    maps: {
      Map: MapMock, LatLng, LatLngBounds: Bounds, Polyline, Marker, Point,
    },
  });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('MoodRouteMap route re-entry', () => {
  it('does not reuse route A ready state while A is re-entered behind pending route B', async () => {
    const firstA = deferred();
    const pendingB = deferred();
    const latestA = deferred();
    state.loadMaps.mockReturnValueOnce(firstA.promise).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(latestA.promise);
    const routeA = route(1);
    const routeB = route(2);
    const view = render(page(routeA));

    expect(screen.getByText('지도 불러오는 중…')).toBeTruthy();
    await act(async () => { firstA.finish(); });
    expect(screen.queryByText('지도 불러오는 중…')).toBeNull();
    expect(state.getNaver).toHaveBeenCalledTimes(1);

    await act(async () => { view.rerender(page(routeB)); });
    await act(async () => { view.rerender(page(routeA)); });
    expect(screen.getByText('지도 불러오는 중…')).toBeTruthy();

    await act(async () => { pendingB.finish(); });
    expect(state.getNaver).toHaveBeenCalledTimes(1);
    expect(screen.getByText('지도 불러오는 중…')).toBeTruthy();
    await act(async () => { latestA.finish(); });
    expect(state.getNaver).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('지도 불러오는 중…')).toBeNull();
    view.unmount();
  });
});
