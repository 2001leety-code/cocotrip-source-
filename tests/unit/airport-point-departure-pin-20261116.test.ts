/**
 * 2026-11-16 — 공항 "한 점" 고정. 운영 시험(11/16 합성 plan)에서 본 것:
 *   ① 출국일 마지막 구간은 지도 조회가 잡은 활주로 안 점에서, 출국 안내(departure_guide)는 지하철역에서 끝났다(인천 매번).
 *   ② 부산 안내가 공항역이 아니라 한 정거장 옆(서부산유통지구, 1.5km)으로 갔다.
 *   ③ 지하철 없는 공항(제주 등) 안내가 활주로 한가운데에서 시작했다(제주 도착 "걸어서 49분").
 *   ④ 출국일 공항 stop 뒤에 "숙소로 돌아가기" 카드가 붙었다(부산·제주 — 공항이 숙소 50km 안).
 * 시간 계산 입력(AIRPORT_COORDS)은 그대로 둔다 — 1분만 움직여도 저장된 1일 끼니 면제가 수정 때 막힌다(검토 11/16).
 * 실제 RouteAgent 오프라인 실행: axios·transit·ODsay·transitCache·텔레그램·LLM 전부 mock, 구간 이동 20분 고정.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { readFileSync } from 'node:fs';
import { AIRPORT_COORDS, AIRPORT_STATION_COORDS, airportPoint, haversineKm } from '../../api/_ai_core/constants.js';
import { mealWindowsFromRequest, validatePatternStructure } from '../../api/_ai_core/responseValidator.js';
import { isAirportStop } from '../../src/lib/airportStop.js';
import { RouteAgent, lookupStationCoord, pinDepartureAirportStop } from '../../api/_ai_core/agents/RouteAgent.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';

type Stop = Record<string, unknown>;
const at = (p: { lat: number; lng: number } | null | undefined) => ({ lat: p!.lat, lng: p!.lng });

describe('airportPoint — 안내 경로와 같은 점, 지도 자료와 300m 안', () => {
  it('지하철역이 있으면 역, 없으면 같은 공항 여객터미널(기준점 3km 안)', () => {
    for (const key of Object.keys(AIRPORT_COORDS)) {
      const ref = AIRPORT_COORDS[key as keyof typeof AIRPORT_COORDS];
      if (!ref) { expect(airportPoint(key), key).toBeNull(); continue; }
      const station = AIRPORT_STATION_COORDS[key as keyof typeof AIRPORT_STATION_COORDS];
      if (station) expect(airportPoint(key), key).toBe(station);
      else expect(haversineKm(airportPoint(key), ref)!, key).toBeLessThan(3);
    }
    expect(airportPoint('XXX')).toBeNull();
    expect(airportPoint(undefined)).toBeNull();
  });

  it('RouteAgent 는 공항 길찾기 점을 airportPoint 로만 얻는다(도착·출국 안내, 첫날 도시 이동, 항공 구간 앞뒤)', () => {
    const src = readFileSync(new URL('../../api/_ai_core/agents/RouteAgent.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/AIRPORT_STATION_COORDS\[/);
    expect(src).not.toMatch(/=\s*AIRPORT_COORDS\[/);
    for (const [name, key] of [['김포국제공항', 'GMP'], ['인천국제공항', 'ICN'], ['김해국제공항 (PUS)', 'PUS'], ['CJU', 'CJU'], ['대구국제공항', 'TAE']]) {
      expect(at(lookupStationCoord(name)), name).toEqual(at(airportPoint(key)));
    }
  });

  // OpenStreetMap 대조(2026-11-16): 여객터미널(aeroway=terminal)·부산김해경전철 공항역 노드.
  const OSM: Array<[string, { lat: number; lng: number }, string]> = [
    ['CJU', { lat: 33.5063, lng: 126.4926 }, '제주국제공항 여객터미널'],
    ['TAE', { lat: 35.8997, lng: 128.6385 }, '대구국제공항 여객터미널'],
    ['PUS', { lat: 35.1719, lng: 128.9486 }, '공항역(부산김해경전철)'],
  ];
  it.each(OSM)('%s → %s 300m 안', (key, ref) => {
    expect(haversineKm(airportPoint(key), ref)!).toBeLessThan(0.3);
  });
  it('부산 안내 점은 서부산유통지구역(OSM 35.1664/128.9549) 쪽이 아니다', () => {
    expect(haversineKm(airportPoint('PUS'), { lat: 35.1664, lng: 128.9549 })!).toBeGreaterThan(0.6);
  });
});

describe('isAirportStop — 서버·화면 공용 판정', () => {
  it.each([
    [{ category: 'airport', name: 'Incheon International Airport' }, true],
    [{ category: 'airport_transfer', name: '인천국제공항 T1' }, true],
    [{ category: 'travel', name: '김해국제공항', _departure_airport_stop: true }, true],
    [{ category: 'travel', name: '인천공항1터미널역' }, true],
    [{ category: 'travel', name: 'Gimpo (GMP)' }, true],
    [{ category: 'travel', name: 'x', display_name: '関西空港 経由' }, true],
    [{ category: 'travel', name: 'Seoul Station' }, false],
    [{ category: 'travel', name: 'Jeju Intercity Bus Terminal' }, false],
    [{ category: 'travel', name: 'Campus Town' }, false],
    [{ category: 'food', name: 'Airport Food Court' }, false],
    [{ category: 'lodging', name: 'Hotel Airport Inn' }, false],
    [null, false],
  ])('%j → %s', (stop, expected) => {
    expect(isAirportStop(stop as Stop)).toBe(expected);
  });
});

describe('pinDepartureAirportStop — 출국일 마지막 공항 stop 만, 같은 공항만', () => {
  const hotel = { category: 'lodging', name: 'Hotel', lat: 37.5636, lng: 126.9826 };
  it('지도 조회가 활주로 안을 잡은 출국 stop → 인천1터미널역(안내 점)', () => {
    const places: Stop[] = [{ ...hotel }, { category: 'travel', name: '인천국제공항 제1여객터미널', _departure_airport_stop: true, ...at(AIRPORT_COORDS.ICN_T1) }];
    expect(pinDepartureAirportStop(places, 'ICN_T1')).toBe(true);
    expect(at(places[1] as never)).toEqual(at(AIRPORT_STATION_COORDS.ICN_T1));
  });
  it('blockMode 출국 stop 은 좌표가 없거나 지도 조회가 먼 곳(해운대 쪽 21km)을 잡아도 고정한다', () => {
    for (const coord of [{ lat: null, lng: null }, { lat: 35.1665774, lng: 129.1820554 }]) {
      const places: Stop[] = [{ ...hotel }, { category: 'travel', name: '김해국제공항', _departure_airport_stop: true, ...coord }];
      expect(pinDepartureAirportStop(places, 'PUS')).toBe(true);
      expect(at(places[1] as never)).toEqual(at(AIRPORT_STATION_COORDS.PUS));
    }
  });
  it('다른 공항(출국은 인천, stop 은 김포 — 30km+, 또는 좌표 없이 이름이 김포)·좌표도 이름도 출국 공항이 아닌 stop·공항 아닌 마지막 stop·모르는 공항은 그대로', () => {
    const gimpo = { category: 'travel', name: 'Gimpo International Airport', ...at(AIRPORT_STATION_COORDS.GMP) };
    const cases: Array<[Stop[], string]> = [
      [[{ ...hotel }, { ...gimpo }], 'ICN_T1'],
      [[{ ...hotel }, { category: 'airport', name: '김포국제공항', lat: null, lng: null }], 'ICN_T1'],
      [[{ ...hotel }, { category: 'airport', name: 'Gimpo Airport (GMP)' }], 'ICN'],
      // 도심 탑승 수속(서울역) — 좌표가 없다고 인천으로 옮기면 시내 정류장에 공항까지 구간이 붙는다
      [[{ ...hotel }, { category: 'airport_transfer', name: 'Seoul Station City Airport Terminal', lat: null, lng: null }], 'ICN_T1'],
      [[{ ...hotel }, { category: 'food', name: 'Lunch', lat: 37.5, lng: 126.9 }], 'ICN_T1'],
      [[{ ...hotel }, { category: 'airport', name: 'Airport', ...at(AIRPORT_COORDS.ICN_T1) }, { ...hotel }], 'ICN_T1'],
      [[{ ...hotel }, { category: 'airport', name: 'Airport', ...at(AIRPORT_COORDS.ICN_T1) }], 'ALREADY'],
    ];
    for (const [places, key] of cases) {
      const before = JSON.stringify(places);
      expect(pinDepartureAirportStop(places, key)).toBe(false);
      expect(JSON.stringify(places)).toBe(before);
    }
  });
  // 운영 시나리오 11/16: 식이 손님(legacy) plan 의 'Incheon International Airport' 는 주소 지도 조회가 못 찾아 좌표가 없었다
  //   → 마지막 구간이 "차로 25분·5km" 기본값(출국 안내는 73분). 비교할 좌표가 없으니 이름이 다른 공항일 때만 둔다.
  it('좌표 없는 모델 stop(지도 조회 실패 — 영어 이름 등)은 안내 점에 고정 — 같은 공항의 다른 터미널 이름도 출국 안내 점으로', () => {
    const cases: Array<[Stop, string]> = [
      [{ category: 'airport', name: 'Incheon International Airport', address: 'Incheon International Airport', lat: null, lng: null }, 'ICN_T1'],
      [{ category: 'airport', name: '인천국제공항 T2' }, 'ICN_T1'],
      [{ category: 'travel', name: 'Jeju Airport' }, 'CJU'],
    ];
    for (const [stop, key] of cases) {
      const places: Stop[] = [{ ...hotel }, { ...stop }];
      expect(pinDepartureAirportStop(places, key), String(stop.name)).toBe(true);
      expect(at(places[1] as never)).toEqual(at(airportPoint(key)));
      expect(places[1]._geocoded).toBe(true);
    }
  });
});

describe('RouteAgent 실행 — 출국일 마지막 구간·숙소 복귀', () => {
  let transitSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.ROUTE_TSP_ENABLED = 'false';
    transitSpy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
      ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
  });
  afterEach(() => { transitSpy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; });

  const P = { lat: 37.5636, lng: 126.9826 };
  // 명동 숙소 ↔ 인천1터미널역 ≈ 48km — 50km 안이라 고정만 하면 예전 규칙으로는 복귀 카드가 생긴다.
  async function run(lastStops: Stop[]) {
    const itinerary = { days: [
      { day: 1, city: 'seoul', stops: [
        { category: 'lodging', name: 'Hotel', start_time: '09:00', ...P },
        { category: 'culture', name: 'Palace', start_time: '10:00', stay_min: 60, lat: 37.5796, lng: 126.977 },
        { category: 'food', name: 'Lunch', start_time: '12:00', stay_min: 60, lat: 37.57, lng: 126.98 },
      ] },
      { day: 2, city: 'seoul', stops: lastStops },
    ] };
    await enrichItineraryWithRoute(itinerary as never, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', departureTime: '13:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null } as never);
    return itinerary as unknown as { days: Array<{ stops: Stop[]; last_to_lodging?: unknown }> };
  }

  it('blockMode 출국 stop(활주로 안 좌표) → 마지막 구간이 인천1터미널역에서 끝나고, 출국일 숙소 복귀 카드 없음, 첫날 복귀 카드는 그대로', async () => {
    const it2 = await run([
      { category: 'lodging', name: 'Hotel', start_time: '07:00', ...P },
      { category: 'travel', name: '인천국제공항 제1여객터미널', display_name: 'Incheon Airport T1', start_time: '10:00', stay_min: 0, _departure_airport_stop: true, ...at(AIRPORT_COORDS.ICN_T1) },
    ]);
    const last = it2.days[1].stops[it2.days[1].stops.length - 1];
    expect(at(last as never)).toEqual(at(AIRPORT_STATION_COORDS.ICN_T1));
    expect(it2.days[1].last_to_lodging).toBeUndefined();
    expect(it2.days[0].last_to_lodging).toBeTruthy();
  });

  it('출국일이 공항이 아닌 곳에서 끝나면(예: 출국 없는 마지막 날 식당) 복귀 카드는 예전처럼 만든다', async () => {
    const it3 = await run([
      { category: 'lodging', name: 'Hotel', start_time: '09:00', ...P },
      { category: 'food', name: 'Brunch', start_time: '10:00', stay_min: 60, lat: 37.57, lng: 126.98 },
    ]);
    expect(it3.days[1].last_to_lodging).toBeTruthy();
  });

  it('식이 손님(legacy) 모양 — 좌표 없는 영어 공항 stop 도 안내 점에 고정, 마지막 구간은 진짜 조회(25분·5km 기본값 아님)', async () => {
    const it4 = await run([
      { category: 'lodging', name: 'Seoul Mock Hotel', start_time: '05:30', ...P },
      { category: 'airport', name: 'Incheon International Airport', address: 'Incheon International Airport', start_time: '07:00', stay_min: 0 },
    ]);
    const last = it4.days[1].stops[it4.days[1].stops.length - 1] as Stop & { transit_from_prev?: Record<string, unknown> };
    const station = at(AIRPORT_STATION_COORDS.ICN_T1);
    expect(at(last as never)).toEqual(station);
    expect(transitSpy.mock.calls.some(([, curr]) => (curr as Stop).lat === station.lat && (curr as Stop).lng === station.lng)).toBe(true);
    expect(last.transit_from_prev?.distance_km).not.toBe(5);
    expect(it4.days[1].last_to_lodging).toBeUndefined();
  });
});

describe('시간 계산 입력(AIRPORT_COORDS)은 그대로 — 저장된 1일 끼니 면제가 수정 때 막히지 않게', () => {
  it('공항 기준점 표 전체가 #1503(11/16 오전) 때와 같다 — 값 이동·키 추가 모두 잡는다', () => {
    expect(AIRPORT_COORDS).toEqual({
      ICN_T1: { lat: 37.4602, lng: 126.4407 }, ICN_T2: { lat: 37.4583, lng: 126.4424 }, ICN: { lat: 37.4602, lng: 126.4407 },
      GMP: { lat: 37.5587, lng: 126.7905 }, PUS: { lat: 35.1795, lng: 128.9381 },
      CJU: { lat: 33.5113, lng: 126.4928 }, TAE: { lat: 35.8941, lng: 128.6588 }, KWJ: { lat: 35.1264, lng: 126.8089 },
      MWX: { lat: 34.9914, lng: 126.3829 }, YNY: { lat: 38.0613, lng: 128.6694 }, ALREADY: null,
    });
  });
  it('대구 출도착·서울 1일 플랜에 저장된 점심 면제 근거(11:04 부터 75분)가 수정 API 와 같은 요청으로 다시 검사를 통과한다', () => {
    const input = { arrival_time: '06:05', departure_time: '18:35', arrival_airport: 'TAE', departure_airport: 'TAE', regions: ['seoul'], arrival_city: 'seoul', durationDays: 1 };
    const req = { regions: ['seoul'], arrival_airport: 'TAE', departure_airport: 'TAE', durationDays: 1, arrival_rest_day: false,
      meal_windows: mealWindowsFromRequest(input), exempt_meal_departure_time: '18:35' };
    const day = { day: 1, city: 'seoul', exempt_meals: ['lunch'], exempt_meal_basis: { lunch: { from: '11:04', stay: 75 } }, stops: [
      { name: 'Gyeongbokgung Palace', category: 'attraction', start_time: '11:10', end_time: '12:10', lat: 37.5796, lng: 126.977 },
      { name: 'Bukchon Hanok Village', category: 'attraction', start_time: '12:20', end_time: '13:00', lat: 37.5826, lng: 126.983 },
      { name: 'Daegu International Airport', category: 'airport', start_time: '15:35', end_time: '15:35', lat: 35.8997, lng: 128.6381 },
    ] };
    const errors = validatePatternStructure({ days: [day] } as never, req as never).map(String);
    expect(errors.filter((e) => e.includes('B-MEAL-LUNCH'))).toEqual([]);
  });
});

describe('도착·출국 안내는 airportPoint 에서 시작·끝난다(행동 잠금 — P275 역 우선 포함)', () => {
  it.each([['ICN_T2', 'seoul', 37.57, 126.98], ['CJU', 'jeju', 33.5, 126.53]])('%s', async (key, city, lat, lng) => {
    const seen: Array<[string, unknown]> = [];
    const routeSpy = vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async (from: unknown, to: unknown, direction: string) => {
      seen.push([direction, direction === 'arrival' ? from : to]);
      return null as never;
    });
    const transitSpy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
      ({ index, durationMin: 10, distanceKm: 1, publicTransit: null, drivingMin: null }) as never);
    try {
      const itin = { arrival_guide: { airport: key }, departure_guide: { airport: key }, days: [
        { day: 1, city, stops: [{ category: 'culture', name: 'Spot', start_time: '13:00', stay_min: 60, lat, lng }] },
        { day: 2, city, stops: [{ category: 'culture', name: 'Spot2', start_time: '10:00', stay_min: 60, lat: lat + 0.01, lng: lng + 0.01 }] },
      ] };
      await enrichItineraryWithRoute(itin as never, { apiKey: null, body: { area: city, regions: [city], language: 'en', arrivalTime: '10:00', departureTime: '18:00' }, language: 'en', hotel_address: '', arrival_airport: key, departure_airport: key, pax: 2, zone_id: null } as never);
    } finally { routeSpy.mockRestore(); transitSpy.mockRestore(); }
    expect(at(seen.find(([d]) => d === 'arrival')?.[1] as never)).toEqual(at(airportPoint(key)));
    expect(at(seen.find(([d]) => d === 'departure')?.[1] as never)).toEqual(at(airportPoint(key)));
  });
});

describe('인천 터미널 — 이름 표시를 따르고, 첫날 같은 공항 비행기는 도착한 터미널에서 시작(P155)', () => {
  it('이름에 터미널 표시가 있으면 그 터미널 역, 없으면 1터미널역(ICN 기본)', () => {
    for (const n of ['인천국제공항 (T2)', '인천국제공항 (ICN T2)', '인천국제공항 T2', '인천공항2터미널역', '인천국제공항 제2여객터미널', 'Incheon Airport Terminal 2']) {
      expect(at(lookupStationCoord(n)), n).toEqual(at(airportPoint('ICN_T2')));
    }
    for (const n of ['인천국제공항 제1여객터미널', '인천공항1터미널역', 'Incheon Airport T1']) expect(at(lookupStationCoord(n)), n).toEqual(at(airportPoint('ICN_T1')));
    for (const n of ['인천국제공항', '인천국제공항 (ICN)', 'ICN']) expect(at(lookupStationCoord(n)), n).toEqual(at(airportPoint('ICN')));
  });

  it.each([['인천국제공항', 'ICN_T2'], ['인천국제공항 (T2)', 'ICN_T2'], ['인천국제공항 (T1)', 'ICN_T1']])('2터미널 도착 + 같은 날 %s 출발 비행기 → 앞 구간 끝 = %s 역', async (fromStation, endKey) => {
    const legs: Array<{ from: unknown; to: unknown }> = [];
    const spy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (prev: unknown, curr: unknown, _a: unknown, _b: unknown, index: number) => {
      if (index === -1) legs.push({ from: prev, to: curr });
      return { index, durationMin: 10, distanceKm: 1, publicTransit: null, drivingMin: null } as never;
    });
    try {
      const hotel = { lat: 35.1631, lng: 129.1635 };
      const itin = { arrival_guide: { airport: 'ICN_T2' }, departure_guide: { airport: 'PUS' }, days: [
        { day: 1, city: 'Busan', intercity_transit: { mode: 'Air', from_city: 'Seoul', to_city: 'Busan', from_station: fromStation, to_station: '김해국제공항', est_min: 60, arrival_at: '15:00' },
          stops: [{ category: 'lodging', name: 'Hotel', start_time: '16:00', stay_min: 30, ...hotel }, { category: 'food', name: 'Dinner', start_time: '18:30', stay_min: 60, lat: 35.16, lng: 129.16 }] },
        { day: 2, city: 'Busan', stops: [{ category: 'lodging', name: 'Hotel', start_time: '09:00', stay_min: 0, ...hotel }, { category: 'culture', name: 'Temple', start_time: '10:00', stay_min: 60, lat: 35.188, lng: 129.223 }] },
      ] };
      await enrichItineraryWithRoute(itin as never, { apiKey: null, body: { area: 'seoul', regions: ['seoul', 'busan'], language: 'en', arrivalTime: '08:00', departureTime: '20:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T2', departure_airport: 'PUS', pax: 2, zone_id: null } as never);
    } finally { spy.mockRestore(); }
    expect(legs.length).toBeGreaterThan(0);
    expect(at(legs[0].from as never)).toEqual(at(airportPoint('ICN_T2')));
    expect(at(legs[0].to as never)).toEqual(at(airportPoint(endKey)));
  });
});

describe('blockMode 출국 stop — 처음부터 안내 점', () => {
  it.each([['PUS', 'busan'], ['CJU', 'jeju'], ['ICN_T2', 'seoul']])('%s', (code, city) => {
    const stops: Stop[] = [{ category: 'lodging', name: 'Hotel', start_time: '08:00', lat: 35.1, lng: 129.0 }];
    applyDepartureDayFlightCap(stops, '18:00', code, 'en', city);
    const added = stops.find((s) => s._departure_airport_stop === true);
    expect(added, code).toBeTruthy();
    expect(at(added as never)).toEqual(at(airportPoint(code)));
  });
});
