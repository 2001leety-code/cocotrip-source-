// @vitest-environment jsdom
//
// 투어 상세 지도 (2026-07-20).
// TourStop 에 좌표를 넣어 CourseMiniMap 으로 핀 + 순서 직선을 그린다.
// CourseMiniMap 은 Leaflet 을 dynamic import 하므로 여기선 mock 하고,
// TourStopMap 이 (a) 좌표 게이트를 지키는지 (b) 어댑터 매핑이 옳은지만 검증한다.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TourStop } from '@/data/tours';

void React;

// CourseMiniMap 을 가벼운 stub 으로 — 넘어온 props 를 DOM 에 노출해 어댑터를 관찰한다.
vi.mock('@/pages/PlannerPage/components/courseBuilder/CourseMiniMap', () => ({
  CourseMiniMap: ({ stops, title }: { stops: Array<{ title: string; time: string; lat?: number; lng?: number }>; title: string }) => (
    <div data-testid="minimap" data-title={title} data-count={stops.length}>
      {stops.map((s, i) => (
        <span key={i} data-testid="stop" data-title={s.title} data-time={s.time} data-lat={s.lat === undefined ? '' : s.lat} data-lng={s.lng === undefined ? '' : s.lng} />
      ))}
    </div>
  ),
}));

import { TourStopMap } from '@/components/tours/TourStopMap';

const stop = (name: string, lat?: number, lng?: number, time = '09:00'): TourStop => ({
  time, name: { ko: name, en: name, ja: name, zh: name }, stay_min: 60,
  description: { ko: '', en: '', ja: '', zh: '' },
  ...(lat != null ? { lat } : {}), ...(lng != null ? { lng } : {}),
});

describe('TourStopMap', () => {
  it('좌표가 2개 이상이면 지도를 그린다', async () => {
    render(<TourStopMap stops={[stop('경복궁', 37.5786, 126.9772), stop('광장시장', 37.5701, 126.9991)]} language="en" title="Itinerary" />);
    // CourseMiniMap 은 lazy import 라 마이크로태스크 뒤에 나타난다.
    expect(await screen.findByTestId('minimap')).toBeInTheDocument();
    expect(screen.getByTestId('minimap').dataset.count).toBe('2');
  });

  it('좌표가 있는 stop 이 2개 미만이면 아무것도 그리지 않는다', () => {
    // 지도가 뜨려면 유효 좌표 2개가 필요하다(CourseMiniMap 하드게이트와 동일 정책).
    const { container: c1 } = render(<TourStopMap stops={[stop('경복궁', 37.5786, 126.9772)]} language="en" title="t" />);
    expect(c1.querySelector('[data-testid="minimap"]')).toBeNull();
    const { container: c2 } = render(<TourStopMap stops={[stop('경복궁'), stop('광장시장')]} language="en" title="t" />);
    expect(c2.querySelector('[data-testid="minimap"]')).toBeNull();
  });

  it('어댑터가 이름을 현재 언어로, 좌표를 그대로 넘긴다', async () => {
    const jp: TourStop = { ...stop('X', 37.5, 127.0), name: { ko: '경복궁', en: 'Gyeongbokgung', ja: '景福宮', zh: '景福宫' } };
    render(<TourStopMap stops={[jp, stop('광장시장', 37.57, 126.99)]} language="ja" title="t" />);
    await screen.findByTestId('minimap');
    const first = screen.getAllByTestId('stop')[0];
    expect(first.dataset.title).toBe('景福宮');
    expect(first.dataset.lat).toBe('37.5');
    expect(first.dataset.lng).toBe('127');
  });

  it('좌표 없는 stop 도 어댑터에는 포함시킨다(순서 유지) — CourseMiniMap 이 알아서 스킵', async () => {
    // 좌표 없는 stop 을 빼면 번호가 어긋난다. 넘기되 CourseMiniMap 이 lat/lng 없으면 핀만 안 찍는다.
    render(<TourStopMap stops={[stop('a', 37.5, 127.0), stop('lunch'), stop('b', 37.6, 127.1)]} language="en" title="t" />);
    await screen.findByTestId('minimap');
    expect(screen.getByTestId('minimap').dataset.count).toBe('3');
    expect(screen.getAllByTestId('stop')[1].dataset.lat).toBe('');
  });
});
