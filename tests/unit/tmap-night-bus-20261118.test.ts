/**
 * 2026-11-18: TMAP ranked Seoul night buses first for daytime legs.
 *
 * Prod vegan plan e00efd46 (scenario run 44060149028, generated 18:59 KST) day 1:
 *   18:35 leg  "지선:7011 홍익대학교 → 서울역버스환승센터" + "일반:N16 서울역 → 동대문역사문화공원"
 *   20:26 leg  "일반:N73 을지로6가 → 을지로입구"
 * N buses run roughly 23:30–04:00, so the traveller would wait hours for a bus that isn't running.
 * The legs carried TMAP-only `walk_guide` → TMAP, not ODsay, produced them, even though
 * buildSearchDttm sent 18:59 (no night correction). Fix: daytime legs take the first TMAP candidate
 * without a night bus; airport legs (departure-morning N6701 is real) and legs with no known time
 * keep TMAP's first candidate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { itineraryHasNightBus, searchTransitRouteTmap } from '../../api/_tmap_helper.js';
import { legAvoidsNightBus } from '../../api/_shared/nightBusLeg.js';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const walk = (from: string, to: string) => ({ mode: 'WALK', sectionTime: 120, distance: 150, start: { name: from }, end: { name: to } });
const bus = (route: string, from: string, to: string) => ({
  mode: 'BUS', sectionTime: 900, distance: 3000, route, start: { name: from }, end: { name: to }, passStopList: { stationList: [] },
});
const subway = (route: string, from: string, to: string) => ({
  mode: 'SUBWAY', sectionTime: 1200, distance: 6000, route, start: { name: from }, end: { name: to }, passStopList: { stationList: [] },
});
const itinerary = (legs: unknown[], totalTime: number) => ({
  pathType: 2, totalTime, transferCount: 1, totalWalkDistance: 300, totalDistance: 9000,
  fare: { regular: { totalFare: 1500 } }, legs,
});

// Same shape as the prod leg: day bus then N16, ranked first by TMAP.
const NIGHT_FIRST = itinerary([walk('출발지', '홍익대학교'), bus('지선:7011', '홍익대학교', '서울역버스환승센터'),
  bus('일반:N16', '서울역버스환승센터', '동대문역사문화공원역9번출구'), walk('동대문역사문화공원역9번출구', '도착지')], 2760);
const DAY_SECOND = itinerary([walk('출발지', '홍대입구'), subway('수도권2호선', '홍대입구', '동대문역사문화공원'), walk('동대문역사문화공원', '도착지')], 3000);
const NIGHT_ONLY = itinerary([walk('출발지', '을지로6가'), bus('일반:N73', '을지로6가', '을지로입구'), walk('을지로입구', '도착지')], 1080);

describe('itineraryHasNightBus', () => {
  it('spots N-numbered buses with or without a type prefix', () => {
    expect(itineraryHasNightBus(NIGHT_FIRST)).toBe(true);
    expect(itineraryHasNightBus(NIGHT_ONLY)).toBe(true);
    expect(itineraryHasNightBus(itinerary([bus('공항:N6701', '을지로입구', '인천공항1층')], 3700))).toBe(true);
    expect(itineraryHasNightBus(itinerary([bus('N16', 'a', 'b')], 900))).toBe(true);
  });
  it('leaves day buses, subways and odd input alone', () => {
    expect(itineraryHasNightBus(DAY_SECOND)).toBe(false);
    expect(itineraryHasNightBus(itinerary([bus('지선:7011', 'a', 'b'), bus('간선:N버스아님', 'b', 'c')], 900))).toBe(false);
    expect(itineraryHasNightBus(itinerary([subway('N16', 'a', 'b')], 900))).toBe(false); // only BUS legs count
    expect(itineraryHasNightBus(null)).toBe(false);
    expect(itineraryHasNightBus({})).toBe(false);
  });
});

describe('legAvoidsNightBus', () => {
  it('daytime legs avoid night buses (the prod 18:35 and 20:26 legs)', () => {
    expect(legAvoidsNightBus({ end_time: '18:35' }, { start_time: '19:21' })).toBe(true);
    expect(legAvoidsNightBus({ end_time: '20:21' }, { start_time: '20:44', category: 'lodging' })).toBe(true);
    expect(legAvoidsNightBus({ end_time: '05:00' }, {})).toBe(true);
    expect(legAvoidsNightBus({ end_time: '22:59' }, {})).toBe(true);
  });
  it('late-night legs may use them', () => {
    expect(legAvoidsNightBus({ end_time: '23:00' }, {})).toBe(false);
    expect(legAvoidsNightBus({ end_time: '00:40' }, {})).toBe(false);
    expect(legAvoidsNightBus({ end_time: '04:59' }, {})).toBe(false);
  });
  it('early airport legs keep TMAP first pick (departure-morning N6701 to ICN is real)', () => {
    // blockMode departure stop = category travel + _departure_airport_stop; the hotel side has no times,
    // so the only known time is the airport arrival.
    const hotel = { category: 'lodging', name: 'Hotel' };
    expect(legAvoidsNightBus(hotel, { category: 'travel', name: '인천국제공항 T1', start_time: '05:00', _departure_airport_stop: true })).toBe(false);
    expect(legAvoidsNightBus(hotel, { category: 'travel', name: '인천국제공항 T1', start_time: '06:30' })).toBe(false);
    expect(legAvoidsNightBus(hotel, { category: 'airport', start_time: '06:59' })).toBe(false);
    expect(legAvoidsNightBus({ category: 'airport', end_time: '22:10' }, hotel)).toBe(false); // late arrival
  });
  it('daytime airport legs skip night buses too', () => {
    expect(legAvoidsNightBus({ category: 'lodging', start_time: '10:00', end_time: '10:00' }, { category: 'airport', start_time: '12:00' })).toBe(true);
    expect(legAvoidsNightBus({ category: 'airport', end_time: '14:00' }, { category: 'lodging' })).toBe(true);
    expect(legAvoidsNightBus({ category: 'lodging' }, { category: 'travel', name: 'Incheon Airport', start_time: '07:00' })).toBe(true);
  });
  it('leaving time = start_time + stay_min first (generation has no end_time; recalc leaves it stale)', () => {
    expect(legAvoidsNightBus({ start_time: '18:00', stay_min: 35 }, { start_time: '19:21' })).toBe(true);
    expect(legAvoidsNightBus({ start_time: '03:30', stay_min: 50 }, { start_time: '05:10' })).toBe(false); // leaves 04:20
    expect(legAvoidsNightBus({ start_time: '15:10', stay_min: 40, end_time: '23:50' }, {})).toBe(true); // stale end_time
    expect(legAvoidsNightBus({ start_time: '22:30', stay_min: 60 }, {})).toBe(false); // leaves 23:30
    expect(legAvoidsNightBus({ start_time: '18:00', stay_min: '' }, { start_time: '19:21' })).toBe(true); // blank stay → next start
  });
  it('falls back to the next stop start, then the stop start; unknown time = old behaviour', () => {
    expect(legAvoidsNightBus({}, { start_time: '13:10' })).toBe(true);
    expect(legAvoidsNightBus({ start_time: '13:10' }, {})).toBe(true);
    expect(legAvoidsNightBus({ end_time: 'evening' }, {})).toBe(false);
    expect(legAvoidsNightBus({}, {})).toBe(false);
    expect(legAvoidsNightBus(null, null)).toBe(false);
  });
});

describe('searchTransitRouteTmap — picks among TMAP candidates', () => {
  const ORIGINAL_KEY = process.env.TMAP_APP_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.TMAP_APP_KEY; else process.env.TMAP_APP_KEY = ORIGINAL_KEY;
  });
  const stubTmap = (itineraries: unknown[]) => {
    process.env.TMAP_APP_KEY = 'test-key';
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metaData: { plan: { itineraries } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  // 홍대 → 동대문 (~8 km, not the <300 m walk shortcut)
  const HONGDAE = [126.9241, 37.5518] as const;
  const DDP = [127.0070, 37.5652] as const;
  const busNos = (r: { steps?: Array<{ busNo?: string; line?: string }> } | null) => (r?.steps || []).map((s) => s.busNo || s.line).filter(Boolean);

  it('daytime leg skips the night-bus candidate', async () => {
    stubTmap([NIGHT_FIRST, DAY_SECOND]);
    const r = await searchTransitRouteTmap(HONGDAE[0], HONGDAE[1], DDP[0], DDP[1], { avoidNightBus: true });
    expect(busNos(r)).toEqual(['수도권2호선']);
  });
  it('without the flag TMAP first pick stays (byte-identical old behaviour)', async () => {
    stubTmap([NIGHT_FIRST, DAY_SECOND]);
    const r = await searchTransitRouteTmap(HONGDAE[0], HONGDAE[1], DDP[0], DDP[1]);
    expect(busNos(r)).toEqual(['7011', 'N16']);
  });
  it('every candidate needs a night bus → still the first one (a route beats none)', async () => {
    stubTmap([NIGHT_ONLY, NIGHT_FIRST]);
    const r = await searchTransitRouteTmap(HONGDAE[0], HONGDAE[1], DDP[0], DDP[1], { avoidNightBus: true });
    expect(busNos(r)).toEqual(['N73']);
  });
  it('the flag does not leak into the TMAP request', async () => {
    const fetchMock = stubTmap([DAY_SECOND]);
    await searchTransitRouteTmap(HONGDAE[0], HONGDAE[1], DDP[0], DDP[1], { avoidNightBus: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(Object.keys(body).sort()).toEqual(['count', 'endX', 'endY', 'format', 'searchDttm', 'startX', 'startY']);
  });
});

describe('every TMAP caller passes the daytime hint (no sibling left on the old pick)', () => {
  it('plan generation (RouteAgent) — stop-to-stop legs', () => {
    const s = src('api/_ai_core/agents/RouteAgent.js');
    expect(s).toMatch(/_searchOdsayWithRetry\(prev\.lng, prev\.lat, curr\.lng, curr\.lat, \{ avoidNightBus: legAvoidsNightBus\(prev, curr\) \}\)/);
    expect(s).toMatch(/async _searchOdsayWithRetry\(sx, sy, ex, ey, opts = \{\}\)[\s\S]{0,300}searchTransit\(sx, sy, ex, ey, opts\)/);
  });
  it('plan re-calculation (recalc-transit)', () => {
    expect(src('api/recalc-transit.js')).toMatch(/searchTransit\(prev\.lng, prev\.lat, curr\.lng, curr\.lat, \{ avoidNightBus: legAvoidsNightBus\(prev, curr\) \}\)/);
  });
  it('course builder (course-route) — daytime courses, no times', () => {
    expect(src('api/course-route.js')).toMatch(/searchTransitRouteTmap\(a\.lng, a\.lat, b\.lng, b\.lat, \{ avoidNightBus: true \}\)/);
  });
});
