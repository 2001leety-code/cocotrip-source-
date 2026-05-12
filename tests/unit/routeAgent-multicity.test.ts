// routeAgent-multicity.test.ts — PDF-issue-2/3 fix 회귀 슈트 (B-AI2/B-AI3 활성)
//
// 사용자 PDF 검토 (cocotrip--5--2026-05-14.pdf) 4 이슈 중 RouteAgent 핵심 fix:
//   - 이슈 2 (KTX 전후 transit): STATION_COORDS / STANDARD_INTERCITY from/to_station + intercity bookend segment
//   - 이슈 3 (Day 별 lodging.city): validatePatternStructure B-LCC validator
//
// RouteAgent.enrichItineraryWithRoute 자체는 ODsay/Naver API 의존이라 e2e mock 어려움.
// 단위 테스트는 pure helper + validator + 상수 매핑 정합성만 검증.

import { describe, it, expect } from 'vitest';
import {
  STATION_COORDS,
  lookupStationCoord,
  isSameAsFirstCity,
  getDayHotelCoord,
} from '../../api/_ai_core/agents/RouteAgent.js';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

// ─────────────────────────────────────────────────────────
// B-AI2: KTX/Air/Bus 정거장 매핑 (PDF-issue-2 부분 활성)
// ─────────────────────────────────────────────────────────

describe('B-AI2 — STATION_COORDS 매핑 (PDF-issue-2)', () => {
  it('KTX 주요역 좌표 등록 — 서울역/부산역/동대구역/대전역', () => {
    expect(STATION_COORDS['서울역']).toBeDefined();
    expect(STATION_COORDS['서울역'].lat).toBeCloseTo(37.5547, 2);
    expect(STATION_COORDS['부산역']).toBeDefined();
    expect(STATION_COORDS['부산역'].lat).toBeCloseTo(35.1149, 2);
    expect(STATION_COORDS['동대구역']).toBeDefined();
    expect(STATION_COORDS['대전역']).toBeDefined();
  });

  it('공항 좌표 등록 — 김포/김해(PUS)/제주(CJU)', () => {
    expect(STATION_COORDS['김포국제공항']).toBeDefined();
    expect(STATION_COORDS['김해국제공항']).toBeDefined();
    expect(STATION_COORDS['김해국제공항'].lat).toBeCloseTo(35.18, 1);
    expect(STATION_COORDS['제주국제공항']).toBeDefined();
  });

  it('lookupStationCoord — 등록된 station 반환', () => {
    const r = lookupStationCoord('서울역');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('서울역');
  });

  it('lookupStationCoord — 미등록 station / 빈 / null → null', () => {
    expect(lookupStationCoord('미등록역')).toBeNull();
    expect(lookupStationCoord('')).toBeNull();
    expect(lookupStationCoord(null as unknown as string)).toBeNull();
    expect(lookupStationCoord(undefined as unknown as string)).toBeNull();
  });

  it('모든 좌표 finite + Korea 범위 — lat 33~38, lng 125~130', () => {
    for (const [name, coord] of Object.entries(STATION_COORDS)) {
      expect(Number.isFinite(coord.lat), `${name} lat not finite`).toBe(true);
      expect(Number.isFinite(coord.lng), `${name} lng not finite`).toBe(true);
      expect(coord.lat, `${name} lat ${coord.lat} out of Korea range`).toBeGreaterThanOrEqual(33);
      expect(coord.lat).toBeLessThanOrEqual(38);
      expect(coord.lng).toBeGreaterThanOrEqual(125);
      expect(coord.lng).toBeLessThanOrEqual(130);
    }
  });
});

// ─────────────────────────────────────────────────────────
// B-AI3: validatePatternStructure B-LCC — lodging_city 일관성 (PDF-issue-3 활성)
// ─────────────────────────────────────────────────────────

describe('B-AI3 — B-LCC validator (PDF-issue-3)', () => {
  const baseRequest = { regions: ['busan', 'seoul'], arrival_airport: 'PUS' };
  const validStop = { order: 1, name: 'Test', category: 'lodging', start_time: '09:00' };

  it('city-change day: lodging_city = intercity_transit.to_city → PASS', () => {
    const itinerary = {
      days: [
        {
          day: 3, city: 'Seoul', theme: 'Seoul Day 1',
          lodging_city: 'Seoul',
          intercity_transit: { mode: 'KTX', from_city: 'Busan', to_city: 'Seoul' },
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const errors = validatePatternStructure(itinerary, baseRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors).toHaveLength(0);
  });

  it('city-change day: lodging_city ≠ intercity_transit.to_city → FAIL (B-LCC trigger)', () => {
    const itinerary = {
      days: [
        {
          day: 3, city: 'Seoul', theme: 'Seoul Day 1',
          lodging_city: 'Busan', // ← 모순 (intercity 가 Seoul 도착인데 lodging 은 Busan)
          intercity_transit: { mode: 'KTX', from_city: 'Busan', to_city: 'Seoul' },
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const errors = validatePatternStructure(itinerary, baseRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors.length).toBeGreaterThanOrEqual(1);
    expect(lccErrors[0]).toMatch(/lodging_city.*Busan.*intercity_transit\.to_city.*Seoul/);
  });

  it('일반 day (intercity 없음): lodging_city = day.city → PASS', () => {
    const itinerary = {
      days: [
        {
          day: 4, city: 'Seoul', theme: 'Seoul Day 2',
          lodging_city: 'Seoul',
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const errors = validatePatternStructure(itinerary, baseRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors).toHaveLength(0);
  });

  it('일반 day: lodging_city ≠ day.city → FAIL (B-LCC trigger, PDF 사용자 실제 케이스)', () => {
    const itinerary = {
      days: [
        {
          day: 4, city: 'Seoul', theme: 'Seoul Day 2',
          lodging_city: 'Busan', // ← 사용자 PDF 캡쳐의 실제 모순 (Day 4 Seoul 인데 lodging 부산)
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const errors = validatePatternStructure(itinerary, baseRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors.length).toBeGreaterThanOrEqual(1);
    expect(lccErrors[0]).toMatch(/lodging_city.*Busan.*day\.city.*Seoul/);
  });

  it('lodging_city 미명시 → B-LCC 검증 skip (backward compat)', () => {
    const itinerary = {
      days: [
        {
          day: 4, city: 'Seoul', theme: 'Seoul Day 2',
          // lodging_city 없음
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const errors = validatePatternStructure(itinerary, baseRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors).toHaveLength(0);
  });

  it('단도시 plan (regions.length < 2) → B-LCC 검증 skip', () => {
    const itinerary = {
      days: [
        {
          day: 1, city: 'Seoul',
          lodging_city: 'Busan', // 단도시인데 모순 — 그래도 다도시 plan 아니라 skip
          stops: [validStop, { ...validStop, order: 2 }, { ...validStop, order: 3 }, { ...validStop, order: 4 }],
        },
      ],
    };
    const singleCityRequest = { regions: ['seoul'], arrival_airport: 'ICN' };
    const errors = validatePatternStructure(itinerary, singleCityRequest);
    const lccErrors = errors.filter((e: string) => e.includes('B-LCC'));
    expect(lccErrors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────
// B-AI3b: getDayHotelCoord / isSameAsFirstCity portable test (PDF-issue-3 helper export 활성)
// ─────────────────────────────────────────────────────────

describe('B-AI3b — isSameAsFirstCity family normalization (PDF-issue-3)', () => {
  it('동일 city family — busan vs busan_city / Busan / 부산 모두 true', () => {
    expect(isSameAsFirstCity('busan', 'busan')).toBe(true);
    expect(isSameAsFirstCity('Busan', 'busan')).toBe(true);
    expect(isSameAsFirstCity('busan_city', 'busan')).toBe(true);
    expect(isSameAsFirstCity('부산', 'busan')).toBe(true);
    expect(isSameAsFirstCity('busan', '부산')).toBe(true);
  });

  it('다른 city — Seoul vs Busan / 서울 vs 부산 → false', () => {
    expect(isSameAsFirstCity('seoul', 'busan')).toBe(false);
    expect(isSameAsFirstCity('Seoul', 'busan')).toBe(false);
    expect(isSameAsFirstCity('서울', '부산')).toBe(false);
    expect(isSameAsFirstCity('jeju', 'busan')).toBe(false);
  });

  it('단도시 / city 미정 → true (trip-level fallback 트리거)', () => {
    expect(isSameAsFirstCity('', 'busan')).toBe(true);
    expect(isSameAsFirstCity('seoul', '')).toBe(true);
    expect(isSameAsFirstCity(null as unknown as string, null as unknown as string)).toBe(true);
    expect(isSameAsFirstCity(undefined as unknown as string, 'busan')).toBe(true);
  });
});

describe('B-AI3b — getDayHotelCoord context-based resolver (PDF-issue-3)', () => {
  const tripHotelBusan = { lat: 35.1631, lng: 129.1635, label: '해운대', source: 'naver_geocode' };

  it('단도시 plan / isMultiCity=false → 항상 trip-level', () => {
    const ctx = {
      isMultiCity: false,
      recommendedZonesMap: null,
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: 'Seoul' }, ctx);
    expect(r.lat).toBe(35.1631);
    expect(r.lng).toBe(129.1635);
    expect(r.label).toBe('해운대');
    expect(r.source).toBe('naver_geocode');
  });

  it('다도시 plan + day.city 미정 → trip-level', () => {
    const ctx = {
      isMultiCity: true,
      recommendedZonesMap: null,
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: null }, ctx);
    expect(r.lat).toBe(35.1631);
  });

  it('다도시 plan + 같은 city continuing → trip-level (부산 → 부산)', () => {
    const ctx = {
      isMultiCity: true,
      recommendedZonesMap: { seoul: 'myeongdong' },
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: 'Busan' }, ctx);
    expect(r.lat).toBe(35.1631);
    expect(r.source).toBe('naver_geocode'); // trip-level
  });

  it('다도시 plan + 다른 city + recommended_zones[city] 매칭 → multi_city_zone', () => {
    const ctx = {
      isMultiCity: true,
      recommendedZonesMap: { seoul: 'myeongdong', Seoul: 'myeongdong' },
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: 'Seoul' }, ctx);
    expect(r.source).toBe('multi_city_zone');
    expect(r.label).toBe('명동');
    // ZONE_COORDS 명동 = 37.5635, 126.9821
    expect(r.lat).toBeCloseTo(37.5635, 2);
    expect(r.lng).toBeCloseTo(126.9821, 2);
  });

  it('다도시 plan + 다른 city + recommended_zones 미정 → CITY_CENTER fallback', () => {
    const ctx = {
      isMultiCity: true,
      recommendedZonesMap: null,
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: 'Seoul' }, ctx);
    expect(r.source).toBe('multi_city_center');
    expect(r.label).toMatch(/Seoul/i);
    // CITY_CENTER_COORDS seoul = 37.5665, 126.9780
    expect(r.lat).toBeCloseTo(37.5665, 2);
  });

  it('다도시 plan + recommended_zones / city_center 둘 다 매칭 X → trip-level fallback', () => {
    const ctx = {
      isMultiCity: true,
      recommendedZonesMap: { foo: 'bar' }, // 매칭 안 됨
      tripFirstRegion: 'busan',
      tripHotel: tripHotelBusan,
    };
    const r = getDayHotelCoord({ city: 'Unknownville' }, ctx);
    // trip-level fallback
    expect(r.lat).toBe(35.1631);
    expect(r.source).toBe('naver_geocode');
  });

  it('ctx 미정 / null → trip-level null coord 반환 (안전)', () => {
    const r = getDayHotelCoord({ city: 'Seoul' }, null as unknown as never);
    expect(r.lat).toBeNull();
    expect(r.lng).toBeNull();
  });
});
