/**
 * 2026-11-16 — 식이 손님(legacy) 플랜의 좌표 없는 관광 stop 을 장소 검색으로 채운다(RouteAgent 실제 실행, 외부 호출 전부 mock).
 *   운영 할랄·비건 서울 플랜: "Hongdae Mural Street"(주소 "서울 마포구 와우산로29길") 좌표 없음 → 앞뒤 구간 가짜 "25분 · 5 km".
 *   🔴 식이 안전: 채운 좌표의 진짜 구간이 하루를 깨거나(자정·첫날 끼니 창) 식사를 옮기면(끼니 경계·투어 종료·마지막 날 늦어짐)
 *   그 좌표를 지우고 예전(main)과 같은 입력으로 계산한다 — 그날 결과가 검색을 끈 실행과 똑같아야 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const searchMock = vi.hoisted(() => vi.fn());
vi.mock('../../api/_shared/naverLocalSearch.js', () => ({ searchNaverLocal: searchMock }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { AIRPORT_STATION_COORDS } from '../../api/_ai_core/constants.js';
import { RouteAgent, LOCAL_GEO_MAX_LOOKUPS } from '../../api/_ai_core/agents/RouteAgent.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';

type Stop = Record<string, unknown> & { transit_from_prev?: Record<string, unknown> | null };
type Itin = { days: Array<{ stops: Stop[]; last_to_lodging?: unknown }> };

const P = { lat: 37.5636, lng: 126.9826 }; // 명동 숙소
const HIT = { title: '홍대벽화거리', category: '여행,명소', address: '서울특별시 마포구 상수동 72-36', roadAddress: '', lat: 37.5517967, lng: 126.924103 };
const mural = (extra: Stop = {}): Stop => ({ category: 'culture', name: 'Hongdae Mural Street', address: '서울 마포구 와우산로29길', start_time: '10:00', stay_min: 60, ...extra });
const hotel = (t: string): Stop => ({ category: 'lodging', name: 'Seoul Mock Hotel', start_time: t, ...P });
const isHit = (s: unknown) => (s as Stop)?.lat === HIT.lat && (s as Stop)?.lng === HIT.lng;

let legMin: (prev: Stop, curr: Stop) => number;
let transitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  searchMock.mockReset();
  searchMock.mockResolvedValue([HIT]);
  legMin = () => 20;
  transitSpy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (p: unknown, c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: legMin(p as Stop, c as Stop), distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { transitSpy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; delete process.env.ROUTE_LOCAL_GEO_ENABLED; });

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
async function run(days: Stop[][], { departureTime = '18:00', localGeo = true } = {}) {
  if (localGeo) delete process.env.ROUTE_LOCAL_GEO_ENABLED; else process.env.ROUTE_LOCAL_GEO_ENABLED = 'false';
  const itinerary = { days: clone(days).map((stops, i) => ({ day: i + 1, city: 'seoul', stops })) };
  await enrichItineraryWithRoute(itinerary as never, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', departureTime }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null } as never);
  return itinerary as unknown as Itin;
}
const LAST_DAY: Stop[] = [hotel('09:00'), { category: 'food', name: 'Brunch', start_time: '10:00', stay_min: 60, lat: 37.57, lng: 126.98 }, hotel('12:00')];
const muralOf = (it: Itin, d = 0) => it.days[d].stops.find((s) => s.name === 'Hongdae Mural Street') as Stop;

describe('좌표 없는 관광 stop → 장소 검색 좌표', () => {
  it('운영 모양(영어 이름 + 번지 없는 주소) → 홍대벽화거리 좌표, 앞뒤 구간을 그 좌표로 진짜 조회(25분 · 5 km 아님)', async () => {
    const day1 = [hotel('09:00'), mural(), { category: 'food', name: 'Lunch', start_time: '12:00', stay_min: 60, lat: 37.557, lng: 126.925 }, hotel('14:00')];
    const it = await run([day1, LAST_DAY]);
    const s = muralOf(it);
    expect([s.lat, s.lng, s._geocoded, s._geo_source]).toEqual([HIT.lat, HIT.lng, true, 'naver_local']);
    expect([s.name, s.address, s.category]).toEqual(['Hongdae Mural Street', '서울 마포구 와우산로29길', 'culture']); // 좌표만 바꾼다
    expect(searchMock.mock.calls[0][0]).toBe('Hongdae Mural Street');
    expect(transitSpy.mock.calls.some(([, c]) => isHit(c))).toBe(true);
    expect(transitSpy.mock.calls.some(([p]) => isHit(p))).toBe(true);
    expect(s.transit_from_prev?.distance_km).not.toBe(5);
    expect((it.days[0].stops[2] as Stop).transit_from_prev?.distance_km).not.toBe(5);
  });

  it('숙소·공항·이동·식당·하루 첫/마지막·검수 코스(블록)·좌표 있는 stop 은 검색하지 않는다', async () => {
    const day1: Stop[] = [
      mural({ name: 'First Culture', start_time: '09:00' }),
      { category: 'food', name: 'Coordless Lunch', start_time: '11:00', stay_min: 60 },
      { category: 'travel', name: 'Seoul Station', start_time: '12:30', stay_min: 0 },
      { category: 'airport_transfer', name: 'City Airport Terminal', start_time: '13:00', stay_min: 0 },
      { category: 'airport', name: 'Gimpo Airport', start_time: '13:30', stay_min: 0 },
      { category: 'lodging', name: 'Mid Hotel', start_time: '14:00', stay_min: 0 },
      mural({ name: 'Block Mural', start_time: '14:30', source_block_id: 'seoul-hongdae' }),
      mural({ name: 'Has Coords', start_time: '16:00', lat: 37.58, lng: 126.98 }),
      mural({ name: 'Last Culture', start_time: '18:00' }),
    ];
    await run([day1, LAST_DAY]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('식당·다른 구 결과는 받지 않는다 → 예전처럼 좌표 없음 + 기본값 구간, undefined 값을 남기지 않는다', async () => {
    searchMock.mockResolvedValue([{ ...HIT, title: '홍대 벽화 국수', category: '음식점>국수' }, { ...HIT, address: '서울특별시 강남구 신사동 1' }]);
    const day1 = [hotel('09:00'), mural(), hotel('13:00')];
    const it = await run([day1, LAST_DAY]);
    const s = muralOf(it);
    expect(s.lat == null && s.lng == null).toBe(true);
    expect(s._geocoded).toBe(false);
    expect('_geo_source' in s).toBe(false);
    expect(s.transit_from_prev?.distance_km).toBe(5);
    expect(Object.entries(s).filter(([, v]) => v === undefined).map(([k]) => k).filter((k) => ['lat', 'lng', '_geocoded', '_geo_source'].includes(k))).toEqual([]);
  });

  it('검색이 한 번 실패(null)하면 그 플랜은 더 부르지 않는다 · 한 플랜 상한 · 끄기 스위치', async () => {
    const many = (n: number) => [hotel('08:00'), ...Array.from({ length: n }, (_, i) => mural({ name: 'Spot ' + i, start_time: '09:00', stay_min: 10 })), hotel('20:00')];
    searchMock.mockResolvedValue(null);
    await run([many(3), LAST_DAY]);
    expect(searchMock).toHaveBeenCalledTimes(1);

    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
    await run([many(6), many(6), LAST_DAY]);
    expect(searchMock).toHaveBeenCalledTimes(LOCAL_GEO_MAX_LOOKUPS);

    searchMock.mockReset();
    await run([many(3), LAST_DAY], { localGeo: false });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('검색이 throw 해도 플랜은 계속(그 stop 은 예전처럼)', async () => {
    searchMock.mockRejectedValue(new Error('boom'));
    const it = await run([[hotel('09:00'), mural(), hotel('13:00')], LAST_DAY]);
    expect(muralOf(it).lat == null).toBe(true);
  });
});

describe('🔴 식이 안전 — 진짜 구간이 하루를 깨거나 식사를 옮기면 검색을 끈 실행과 똑같이', () => {
  const lunchDay = () => [hotel('09:00'), mural({ start_time: '09:30' }), { category: 'food', name: 'Halal Lunch', start_time: '12:00', stay_min: 60, lat: 37.557, lng: 126.925 },
    { category: 'food', name: 'Halal Dinner', start_time: '19:00', stay_min: 60, lat: 37.56, lng: 126.93 }, hotel('21:00')];

  it('점심이 17시를 넘어가게 하는 긴 구간(220분) → 좌표를 지우고 예전과 같은 하루(아무것도 안 빠짐)', async () => {
    legMin = (p, c) => (isHit(p) || isHit(c) ? 220 : 20);
    const on = await run([lunchDay(), LAST_DAY]);
    const off = await run([lunchDay(), LAST_DAY], { localGeo: false });
    expect(muralOf(on).lat == null).toBe(true);
    expect(on).toEqual(off);
    expect(on.days[0].stops.map((s) => s.name)).toEqual(lunchDay().map((s) => s.name));
  });

  it('자정을 넘기는 구간(600분) → 422 없이 예전과 같은 하루', async () => {
    legMin = (p, c) => (isHit(p) || isHit(c) ? 600 : 20);
    const on = await run([lunchDay(), LAST_DAY]);
    const off = await run([lunchDay(), LAST_DAY], { localGeo: false });
    expect(on).toEqual(off);
  });

  it('마지막 날에는 식사가 조금이라도 늦어지면 되돌린다(출국 컷이 길찾기 뒤에 돈다)', async () => {
    legMin = (p, c) => (isHit(p) || isHit(c) ? 90 : 20);
    const last = [hotel('09:00'), mural({ start_time: '09:30' }), { category: 'food', name: 'Halal Lunch', start_time: '11:00', stay_min: 60, lat: 37.557, lng: 126.925 }, hotel('13:00')];
    const day1 = [hotel('09:00'), { category: 'culture', name: 'Palace', start_time: '10:00', stay_min: 60, lat: 37.5796, lng: 126.977 }, hotel('12:00')];
    const on = await run([day1, last]);
    const off = await run([day1, last], { localGeo: false });
    expect(muralOf(on, 1).lat == null).toBe(true);
    expect(on).toEqual(off);
  });

  it('짧은 진짜 구간(20분) → 좌표 유지, 식당 시각은 예전과 같다', async () => {
    const on = await run([lunchDay(), LAST_DAY]);
    const off = await run([lunchDay(), LAST_DAY], { localGeo: false });
    expect(isHit(muralOf(on))).toBe(true);
    const foods = (it: Itin) => it.days[0].stops.filter((s) => s.category === 'food').map((s) => [s.name, s.start_time]);
    expect(foods(on)).toEqual(foods(off));
  });

  it('순서 정리(TSP)를 켜도 검색으로 채운 날은 원래 순서', async () => {
    delete process.env.ROUTE_TSP_ENABLED;
    // 명동 숙소 → 홍대 → 남산(숙소 옆) → 홍대 옆 공원 지그재그, 가운데는 시각 없음 — 좌표가 처음부터 있으면 순서 정리가 바꾸는 모양(대조군으로 확인)
    const day = (muralCoords: Stop) => [hotel('09:00'), mural({ start_time: undefined, ...muralCoords }),
      { category: 'culture', name: 'Namsan', stay_min: 60, lat: 37.5512, lng: 126.9882 },
      { category: 'culture', name: 'Hongik Park', stay_min: 60, lat: 37.5563, lng: 126.9236 }, hotel('15:00')];
    const control = await run([day({ lat: HIT.lat, lng: HIT.lng }), LAST_DAY], { localGeo: false });
    expect(control.days[0].stops.map((s) => s.name)).not.toEqual(day({}).map((s) => s.name));
    const on = await run([day({}), LAST_DAY]);
    expect(isHit(muralOf(on))).toBe(true);
    expect(on.days[0].stops.map((s) => s.name)).toEqual(day({}).map((s) => s.name));
  });
});

describe('#1505 공항 고정과 함께', () => {
  it('출국일 가운데 관광 stop 을 채워도 좌표 없는 영어 공항 stop 은 예전처럼 안내 점에 고정', async () => {
    const last = [hotel('05:30'), mural({ start_time: '06:00', stay_min: 30 }), { category: 'airport', name: 'Incheon International Airport', address: 'Incheon International Airport', start_time: '08:00', stay_min: 0 }];
    const on = await run([LAST_DAY, last], { departureTime: '11:00' });
    const ap = on.days[1].stops[on.days[1].stops.length - 1];
    expect([ap.lat, ap.lng]).toEqual([AIRPORT_STATION_COORDS.ICN_T1.lat, AIRPORT_STATION_COORDS.ICN_T1.lng]);
    expect(isHit(muralOf(on, 1))).toBe(true);
  });

  it('공항 구간이 자정을 넘기면 — 검색 좌표도 공항 고정도 풀려 예전과 같은 하루(422 없음)', async () => {
    const station = AIRPORT_STATION_COORDS.ICN_T1;
    legMin = (p, c) => ((c as Stop).lat === station.lat ? 62 : 20);
    const last = [hotel('09:00'), mural({ start_time: '19:00', stay_min: 60 }), { category: 'food', name: 'Late Dinner', start_time: '21:30', stay_min: 90, lat: 37.534, lng: 126.994 },
      { category: 'airport', name: 'Incheon International Airport', address: 'Incheon International Airport', start_time: '23:20', stay_min: 0 }];
    const on = await run([LAST_DAY, last], { departureTime: '23:55' });
    const off = await run([LAST_DAY, last], { departureTime: '23:55', localGeo: false });
    expect(on).toEqual(off);
    expect(on.days[1].stops[on.days[1].stops.length - 1].lat == null).toBe(true);
  });
});
