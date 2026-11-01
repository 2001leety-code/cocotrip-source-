/**
 * 첫날 도착 PR2 r3 7~9번 — 적대적 r2(블록모드/다른 날/게이트 렌즈) 회귀. 실제 RouteAgent·blockMode 오프라인(전부 mock,
 *   구간 20분 + 버퍼 5). ICN_T1·서울 준비 = 도착 + 180분.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent, findStitchViolation } from '../../api/_ai_core/agents/RouteAgent.js';
import { expandBlocksToItinerary, rescueFirstDayMeal } from '../../api/_ai_core/blockMode.js';
import { runRouteEnrichment, applyTourEndCap } from '../../api/_ai_core/postResponsePipeline.js';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[]; [k: string]: unknown }> };
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const hotel = (t: string, extra: Stop = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P, ...extra });
const midDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('07:00'), { category: 'food', name: `Lunch ${day}`, start_time: '12:30', stay_min: 60, ...at(1) }, { category: 'food', name: `Dinner ${day}`, start_time: '18:30', stay_min: 60, ...at(2) }, hotel('21:00')] });
// PR2 가 붙이는 숨은 키만(_geocoded 등 기존 표식은 이 PR 범위 밖).
const PR2_KEYS = ['_ri', '_transitReset', '_blockMealRole'];
const hidden = (s: Stop) => Object.keys(s).filter((k) => PR2_KEYS.includes(k));

beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });

async function run(days: Plan['days'], body: Record<string, unknown> = {}, arrival_airport = 'ICN_T1') {
  const itinerary: Plan = { days };
  await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', ...body }, language: 'en', hotel_address: '', arrival_airport, departure_airport: 'ICN_T1', pax: 2, zone_id: null });
  return itinerary;
}

describe('r3-7 — departure-day airport / transfer / travel stops are not end-checked against midnight', () => {
  it('2 days, Day2 [Hotel 21:30, 인천국제공항 (no coords, no stay)] → saved (was 422)', async () => {
    const it7 = await run([midDay(1), { day: 2, city: 'seoul', stops: [hotel('21:30'), { category: 'airport', name: '인천국제공항', start_time: '23:00' }] }]);
    expect(it7.days[1].stops.map((s) => s.category)).toEqual(['lodging', 'airport']);
  });
  it('Day2 [Hotel 21:00, Airport stay 120] → saved (was 422)', async () => {
    const it7 = await run([midDay(1), { day: 2, city: 'seoul', stops: [hotel('21:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '22:30', stay_min: 120 }] }]);
    expect(it7.days[1].stops.map((s) => s.category)).toEqual(['lodging', 'airport']);
  });
  it('airport_transfer at 22:55 still passes', async () => {
    const it7 = await run([midDay(1), { day: 2, city: 'seoul', stops: [hotel('21:00'), { category: 'airport_transfer', name: 'Transfer', start_time: '22:55', stay_min: 60, ...at(1) }] }]);
    expect(it7.days[1].stops.some((s) => s.category === 'airport_transfer')).toBe(true);
  });
  it('pure: the airport after a late sightseeing stop is ignored, the sightseeing end is still checked', () => {
    const places = [{ category: 'lodging' }, { category: 'culture', stay_min: 60 }, { category: 'airport', stay_min: 120 }];
    expect(findStitchViolation(places, { starts: [1200, 1300, 1380], meals: [] })).toBeNull();
    expect(findStitchViolation(places, { starts: [1200, 1390, 1420], meals: [] })).toMatchObject({ kind: 'midnight', index: 1 });
  });
});

describe('r3-8 — a rescued Day1 restaurant is provisionally placed inside its window; no hidden key survives a RouteAgent failure', () => {
  const block = (id: string, spec: Array<[string, number]>) => ({
    id, city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
    stops: spec.map(([cat, off], i) => ({ order: i + 1, name: `${id} ${cat} ${off}`, category: cat, start_time_offset_min: off, stay_min: 60 })),
  });
  const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day: false };
  const sel = (n: number) => ({ day_selections: Array.from({ length: n }, (_, i) => ({ day: i + 1, block_id: `S${i + 1}`, tweak_notes: '' })), language: 'en' });

  it('pure: 01:30 dinner, day start 17:00, cap 21:00 → 20:59 + role, stale end_time dropped; day starting after the cap → not rescued', () => {
    const s: Stop = { category: 'food', start_time: '01:30', end_time: '02:30' };
    expect(rescueFirstDayMeal(s, 90, true, 17 * 60, 21 * 60, new Set())).toBe(true);
    expect(s).toMatchObject({ start_time: '20:59', _blockMealRole: 'dinner' });
    expect('end_time' in s).toBe(false);
    const late: Stop = { category: 'food', start_time: '23:00' };
    expect(rescueFirstDayMeal(late, 23 * 60, false, 21 * 60 + 30, 21 * 60, new Set())).toBe(false);
    expect(late).toEqual({ category: 'food', start_time: '23:00' });
  });
  it('probe A6: blocks → RouteAgent.call throws a generic Error → Day1 restaurant inside the dinner window, no _blockMealRole, kept by the tour-end cap', async () => {
    const itin = expandBlocksToItinerary(sel(2), [block('S1', [['culture', 0], ['food', 360]]), block('S2', [['culture', 0], ['food', 180]])], structuredClone(input)) as Plan;
    const food0 = itin.days[0].stops.find((s) => s.category === 'food')!;
    expect(food0._blockMealRole).toBe('dinner');
    expect(toMin(food0.start_time)).toBeGreaterThanOrEqual(17 * 60);
    expect(toMin(food0.start_time)).toBeLessThan(21 * 60);
    vi.spyOn(RouteAgent.prototype, 'call').mockRejectedValue(new Error('ODsay down'));
    await runRouteEnrichment(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    applyTourEndCap(itin, '21:00');
    const food = itin.days[0].stops.find((s) => s.category === 'food');
    expect(food).toBeDefined();
    expect(toMin(food!.start_time)).toBeGreaterThanOrEqual(17 * 60);
    expect(toMin(food!.start_time)).toBeLessThan(21 * 60);
    for (const d of itin.days) for (const s of d.stops) expect(hidden(s), `${d.day}:${s.name}`).toEqual([]);
  });
  it('probe A1: happy path still places the rescued dinner and strips every hidden key', async () => {
    const itin = expandBlocksToItinerary(sel(2), [block('S1', [['culture', 0], ['food', 360]]), block('S2', [['culture', 0], ['food', 180]])], structuredClone(input)) as Plan;
    await runRouteEnrichment(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    const food = itin.days[0].stops.find((s) => s.category === 'food');
    expect(toMin(food!.start_time)).toBeGreaterThanOrEqual(17 * 60);
    expect(toMin(food!.start_time)).toBeLessThan(21 * 60);
    for (const d of itin.days) for (const s of d.stops) expect(hidden(s), `${d.day}:${s.name}`).toEqual([]);
  });
});

describe('r3-9 — Day1 floor adds no immigration / airport leg for ALREADY or an unknown airport', () => {
  const day1 = () => ({ day: 1, city: 'seoul', stops: [hotel('14:00', { stay_min: 0 }), { category: 'culture', name: 'Palace', start_time: '14:30', stay_min: 60, ...at(1) }, hotel('20:00')] });
  it.each([['ALREADY', '14:30'], ['already_in_korea', '14:30'], ['', '14:30'], ['ICN_T1', '17:00']])('arrival 14:00, airport %j → Palace %s', async (airport, want) => {
    const it9 = await run([day1(), midDay(2)], { arrivalTime: '14:00', tourEndTime: '21:00' }, airport);
    expect(it9.days[0].stops.find((s) => s.name === 'Palace')).toMatchObject({ start_time: want });
  });
});
