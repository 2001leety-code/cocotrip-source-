// TMAP 실경로(geometry) 파싱 회귀 테스트 (2026-07-19).
// 배경: TMAP 응답은 leg 마다 passShape.linestring(실도로 좌표)·routeColor·승하차 좌표를
// 주는데 파서가 통째로 버려 지도가 stop→stop 직선만 그렸다. 아래가 그 복구를 지킨다.
import { describe, it, expect } from 'vitest';
import { parseLinestring, mapTmapItineraryToRoute } from '../../api/_tmap_helper.js';

describe('parseLinestring — "lon,lat …" → [[lat,lng], …]', () => {
  it('경도/위도 순서를 뒤집어 지도 라이브러리 순서로 만든다', () => {
    expect(parseLinestring('126.9784,37.5665 127.0276,37.4979')).toEqual([
      [37.5665, 126.9784],
      [37.4979, 127.0276],
    ]);
  });

  it('좌표를 5자리(≈1m)로 반올림해 문서 비대를 막는다', () => {
    const [[lat, lng]] = parseLinestring('126.97841234,37.56651234')!;
    expect(lat).toBe(37.56651);
    expect(lng).toBe(126.97841);
  });

  it('maxPoints 초과 시 균등 샘플링하되 시작·끝은 보존한다', () => {
    const pts = Array.from({ length: 500 }, (_, i) => `127.${String(i).padStart(5, '0')},37.5`).join(' ');
    const out = parseLinestring(pts, 50)!;
    expect(out.length).toBe(50);
    expect(out[0]).toEqual([37.5, 127.0]);
    expect(out[out.length - 1]).toEqual([37.5, 127.00499]);
  });

  it('빈 값·잘못된 입력은 null (지도가 폴백으로 직선을 그리게)', () => {
    expect(parseLinestring('')).toBeNull();
    expect(parseLinestring(null as unknown as string)).toBeNull();
    expect(parseLinestring('garbage')).toBeNull();
  });
});

describe('mapTmapItineraryToRoute — geometry 보존', () => {
  const itinerary = {
    totalTime: 1200, totalDistance: 5000, transferCount: 1, pathType: 1,
    fare: { regular: { totalFare: 1250 } },
    legs: [
      {
        mode: 'WALK', sectionTime: 300, distance: 200,
        start: { name: '출발지', lon: 126.9784, lat: 37.5665 },
        end: { name: '선릉역7번출구', lon: 127.0482, lat: 37.5059 },
        steps: [{ streetName: '테헤란로', distance: 59, description: '테헤란로를 따라 59m 이동', linestring: '127.02936,37.498245 127.02881,37.498074' }],
      },
      {
        mode: 'SUBWAY', sectionTime: 600, distance: 4000, route: '수도권2호선', routeColor: '009D3E',
        start: { name: '선릉', lon: 127.0489, lat: 37.5044 },
        end: { name: '잠실', lon: 127.1001, lat: 37.5133 },
        passShape: { linestring: '127.048958,37.504489 127.052578,37.505512 127.100188,37.513336' },
      },
    ],
  };

  it('지하철 leg 에 실경로·노선색·승하차 좌표가 실린다', () => {
    const r = mapTmapItineraryToRoute(itinerary)!;
    const subway = r.steps.find((s: { mode: string }) => s.mode === 'subway')!;
    expect(subway.path.length).toBe(3);
    expect(subway.path[0]).toEqual([37.50449, 127.04896]);
    expect(subway.routeColor).toBe('#009D3E');       // 2호선 공식 초록
    expect(subway.fromPoint).toMatchObject({ name: '선릉' });
    expect(subway.toPoint).toMatchObject({ name: '잠실' });
  });

  it('도보 leg 은 steps[].linestring 을 합쳐 경로 + 길안내를 만든다', () => {
    const r = mapTmapItineraryToRoute(itinerary)!;
    const walk = r.steps.find((s: { mode: string }) => s.mode === 'walk')!;
    expect(walk.path.length).toBe(2);
    expect(walk.walk_guide[0]).toMatchObject({ street: '테헤란로', distance: 59 });
  });

  it('geometry 가 없는 응답도 깨지지 않는다 (구형/부분 응답 방어)', () => {
    const bare = { ...itinerary, legs: [{ mode: 'BUS', sectionTime: 600, distance: 3000, route: '간선:472', start: {}, end: {} }] };
    const r = mapTmapItineraryToRoute(bare)!;
    const bus = r.steps.find((s: { mode: string }) => s.mode === 'bus')!;
    expect(bus.busNo).toBe('472');
    expect(bus.path).toBeUndefined();      // 없으면 아예 필드를 안 만든다 → 프론트가 직선 폴백
    expect(bus.routeColor).toBeUndefined();
  });
});
