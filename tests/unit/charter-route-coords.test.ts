/**
 * 차터 경유지 좌표 추출/검증 가드 (FEATURE_CHARTER_WAYPOINTS).
 *
 * extractRouteCoords 는 결제/견적 body.routeCoords 에서 안전하게 좌표를 뽑아
 * 서버 TMAP 재조회에 넘긴다. 좌표 위조는 자기 여정만 바꾸므로 가격은 정직(P311) —
 * 여기선 "유효 좌표만 통과 + 경유지 5 cap + 잘못된 입력은 null" 만 회귀 가드한다.
 */
import { describe, it, expect } from 'vitest';
import { extractRouteCoords, fetchTmapCarRouteKm } from '../../api/_tmap_car_route.js';

const OK = { lng: 126.97, lat: 37.56 };
const OK2 = { lng: 129.07, lat: 35.18 };

describe('extractRouteCoords — body.routeCoords 안전 추출', () => {
  it('origin+dest 유효 → { origin, dest, waypoints:[] }', () => {
    const r = extractRouteCoords({ routeCoords: { origin: OK, dest: OK2 } });
    expect(r).toEqual({ origin: OK, dest: OK2, waypoints: [] });
  });

  it('경유지 포함 → 순서 보존', () => {
    const wp = [{ lng: 127.1, lat: 37.4 }, { lng: 127.5, lat: 36.9 }];
    const r = extractRouteCoords({ routeCoords: { origin: OK, dest: OK2, waypoints: wp } });
    expect(r!.waypoints).toEqual(wp);
  });

  it('경유지 5 cap (TMAP passList 제한) — 6개 → 앞 5개만', () => {
    const wp = Array.from({ length: 6 }, (_, i) => ({ lng: 127 + i * 0.1, lat: 37 - i * 0.1 }));
    const r = extractRouteCoords({ routeCoords: { origin: OK, dest: OK2, waypoints: wp } });
    expect(r!.waypoints).toHaveLength(5);
  });

  it('잘못된 경유지(좌표 아님) 는 필터링, 유효한 것만', () => {
    const wp = [{ lng: 127.1, lat: 37.4 }, { lng: 'x', lat: null } as never, { foo: 1 } as never];
    const r = extractRouteCoords({ routeCoords: { origin: OK, dest: OK2, waypoints: wp } });
    expect(r!.waypoints).toEqual([{ lng: 127.1, lat: 37.4 }]);
  });

  it('origin/dest 누락·무효 → null (기존 matrix 폴백 신호)', () => {
    expect(extractRouteCoords({ routeCoords: { origin: OK } })).toBeNull();
    expect(extractRouteCoords({ routeCoords: { origin: OK, dest: { lng: 999, lat: 999 } } })).toBeNull();
    expect(extractRouteCoords({ routeCoords: {} })).toBeNull();
  });

  it('routeCoords 없음 → null (무경유 예약 = 무영향)', () => {
    expect(extractRouteCoords({})).toBeNull();
    expect(extractRouteCoords(null as never)).toBeNull();
    expect(extractRouteCoords({ originKey: 'ICN', destKey: 'BUSAN' })).toBeNull();
  });

  it('좌표 위조(경계밖 lat/lng) → 거부 (NaN/Infinity/범위밖)', () => {
    expect(extractRouteCoords({ routeCoords: { origin: { lng: NaN, lat: 37 }, dest: OK2 } })).toBeNull();
    expect(extractRouteCoords({ routeCoords: { origin: { lng: Infinity, lat: 37 }, dest: OK2 } })).toBeNull();
    expect(extractRouteCoords({ routeCoords: { origin: { lng: 200, lat: 37 }, dest: OK2 } })).toBeNull();
  });
});

describe('fetchTmapCarRouteKm — 키 없으면 안전 null (throw 금지)', () => {
  it('TMAP_APP_KEY 미설정 → null (결제 차단 신호, 크래시 안 함)', async () => {
    const saved = process.env.TMAP_APP_KEY;
    delete process.env.TMAP_APP_KEY;
    try {
      expect(await fetchTmapCarRouteKm(OK, OK2)).toBeNull();
    } finally {
      if (saved !== undefined) process.env.TMAP_APP_KEY = saved;
    }
  });

  it('무효 origin/dest → null (fetch 시도 안 함)', async () => {
    process.env.TMAP_APP_KEY = 'test-key';
    try {
      expect(await fetchTmapCarRouteKm({ lng: NaN, lat: 0 } as never, OK2)).toBeNull();
    } finally {
      delete process.env.TMAP_APP_KEY;
    }
  });
});
