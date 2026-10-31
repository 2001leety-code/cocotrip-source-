/**
 * 첫날 도착 PR2 r5 — Astra 코드 r4(P1 2건) 회귀. 실 ODsay·TMAP·LLM 0(전부 mock, 구간 20분 + 버퍼 5).
 *   1) 경로 실패 정리가 이동 기본값(25분)까지 반영 — 겹친 저장 0, 겹침 없으면 불변(단도시·다도시 Day1).
 *   2) 좌표 없는 같은 예약 숙소 북엔드(출발 표식 stay_min:0 + 그날 마지막 숙소)는 합친다 — 이름은 안 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent, stitchStartMins, isLodgingBookendPair, legTransitMin } from '../../api/_ai_core/agents/RouteAgent.js';
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity, settleUnroutedRescuedMeals } from '../../api/_ai_core/blockMode.js';
import { runRouteEnrichment } from '../../api/_ai_core/postResponsePipeline.js';
import { DEFAULT_LEG_MIN } from '../../api/_ai_core/constants.js';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[]; [k: string]: unknown }> };
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const hotel = (t: string, extra: Stop = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P, ...extra });
const noGeo = { lat: null, lng: null };
const midDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('07:00'), { category: 'food', name: `Lunch ${day}`, start_time: '12:30', stay_min: 60, ...at(1) }, { category: 'food', name: `Dinner ${day}`, start_time: '18:30', stay_min: 60, ...at(2) }, hotel('21:00')] });
const lastDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });
const overlaps = (stops: Stop[]) => stops.some((s, i) => i > 0 && !['lodging', 'airport', 'airport_transfer', 'travel'].includes(String(stops[i - 1].category))
  && toMin(stops[i - 1].start_time) + Number(stops[i - 1].stay_min || 60) + DEFAULT_LEG_MIN + 5 > toMin(s.start_time));

beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });

async function run(days: Plan['days'], body: Record<string, unknown> = {}) {
  const itinerary: Plan = { days };
  await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', ...body }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
  return itinerary;
}

describe('r5-1 — unrouted rescued meals: the overlap check includes the default leg (25 min, same constant as RouteAgent)', () => {
  it('one constant: legTransitMin falls back to DEFAULT_LEG_MIN', () => {
    expect(DEFAULT_LEG_MIN).toBe(25);
    expect(legTransitMin(null, null)).toBe(DEFAULT_LEG_MIN);
  });
  it('Astra repro: sightseeing 19:54–20:54 → dinner 20:59 (arrival 21:24) → sightseeing removed, nothing overlaps', () => {
    const plan: Plan = { days: [{ day: 1, city: 'seoul', stops: [hotel('19:30', { stay_min: 0 }), { category: 'culture', name: 'Palace', start_time: '19:54', stay_min: 60 }, { category: 'food', name: 'Dinner', start_time: '20:59', stay_min: 60, _blockMealRole: 'dinner' }, hotel('22:30')] }] };
    settleUnroutedRescuedMeals(plan);
    expect(plan.days[0].stops.map((s) => s.name)).toEqual(['Hotel', 'Dinner', 'Hotel']);
    expect(overlaps(plan.days[0].stops)).toBe(false);
  });
  it('no overlap (18:00 + 60 + 25 + 5 = 19:30 ≤ 20:59) → unchanged except the marker', () => {
    const plan: Plan = { days: [{ day: 1, city: 'seoul', stops: [hotel('17:30', { stay_min: 0 }), { category: 'culture', name: 'Palace', start_time: '18:00', stay_min: 60 }, { category: 'food', name: 'Dinner', start_time: '20:59', stay_min: 60, _blockMealRole: 'dinner' }] }] };
    settleUnroutedRescuedMeals(plan);
    expect(plan.days[0].stops.map((s) => s.name)).toEqual(['Hotel', 'Palace', 'Dinner']);
    expect('_blockMealRole' in plan.days[0].stops[2]).toBe(false);
  });
  it('Seoul → Busan multi-city Day1: RouteAgent fails → the saved Day1 has no overlap', async () => {
    const block = (city: string, id: string, spec: Array<[string, number]>) => ({ id, city, zone: 'Test', theme: 'T', intensity: 'standard',
      stops: spec.map(([cat, off], i) => ({ order: i + 1, name: `${id} ${cat} ${off}`, category: cat, start_time_offset_min: off, stay_min: 60 })) });
    const spec: Array<[string, number]> = [['culture', 0], ['culture', 60], ['food', 360]];
    const sel = { day_selections: [{ day: 1, city: 'seoul', block_id: 'S1', tweak_notes: '' }, { day: 2, city: 'busan', block_id: 'B1', tweak_notes: '' }], language: 'en' };
    const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day: false, regions: ['seoul', 'busan'], arrival_city: 'seoul', departure_city: 'busan' };
    const itin = expandBlocksToItineraryMultiCity(sel, [{ city: 'seoul', blocks: [block('seoul', 'S1', spec)] }, { city: 'busan', blocks: [block('busan', 'B1', spec)] }], structuredClone(input)) as Plan;
    expect(itin.days[0].stops.some((s) => s._blockMealRole === 'dinner')).toBe(true);
    vi.spyOn(RouteAgent.prototype, 'call').mockRejectedValue(new Error('ODsay down'));
    await runRouteEnrichment(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul', 'busan'], language: 'en', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    expect(overlaps(itin.days[0].stops)).toBe(false);
    expect(itin.days[0].stops.some((s) => '_blockMealRole' in s)).toBe(false);
  });
});

describe('r5-2 — same booked hotel bookends without coordinates are merged by the departure marker, not by name', () => {
  it('Astra repro: ICN 20:35 rest day, [Hotel 23:35 (stay 0), Hotel 23:59], no coordinates → saved (was 422)', async () => {
    const it2 = await run([{ day: 1, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel', start_time: '23:35', stay_min: 0, ...noGeo }, { category: 'lodging', name: 'Hotel', start_time: '23:59', ...noGeo }] }, midDay(2), lastDay(3)], { arrivalTime: '20:35', tourEndTime: '21:00' });
    expect(it2.days[0].stops.map((s) => s.category)).toEqual(['lodging', 'lodging']);
    expect(it2.days[0].stops.every((s) => toMin(s.start_time) >= 0 && toMin(s.start_time) < 1440)).toBe(true);
  });
  it('Day2+ uses the same rule: [Hotel 23:35 (stay 0), Hotel] without coordinates → saved', async () => {
    const it2 = await run([midDay(1), { day: 2, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel', start_time: '23:35', stay_min: 0, ...noGeo }, { category: 'lodging', name: 'Hotel', start_time: '23:59', ...noGeo }] }, lastDay(3)]);
    expect(it2.days[1].stops.length).toBe(2);
  });
  it('a different hotel without coordinates (no departure marker) is not merged → midnight rule → 422', async () => {
    await expect(run([midDay(1), { day: 2, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel A', start_time: '23:35', stay_min: 60, ...noGeo }, { category: 'lodging', name: 'Hotel B', start_time: '23:59', ...noGeo }] }, lastDay(3)]))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE' });
  });
  it.each([
    ['departure marker + last lodging, no coordinates', [{ category: 'lodging', stay_min: 0, ...noGeo }, { category: 'lodging', ...noGeo }], 1, true],
    ['departure marker + last lodging, both coordinates valid (50 m rule only)', [{ category: 'lodging', stay_min: 0, ...P }, { category: 'lodging', lat: P.lat + 0.05, lng: P.lng }], 1, false],
    ['first lodging has a real stay', [{ category: 'lodging', stay_min: 60, ...noGeo }, { category: 'lodging', ...noGeo }], 1, false],
    ['missing stay counts as a departure marker (r5-5: legacy placeholder bookends)', [{ category: 'lodging', ...noGeo }, { category: 'lodging', ...noGeo }], 1, true],
    ['not the last stop of the day', [{ category: 'lodging', stay_min: 0, ...noGeo }, { category: 'lodging', ...noGeo }, { category: 'culture' }], 1, false],
  ] as Array<[string, Stop[], number, boolean]>)('pure: %s → %s', (_n, places, i, want) => {
    expect(isLodgingBookendPair(places, i)).toBe(want);
  });
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const sweep: Array<[string, string, string]> = [];
  for (const arr of ['19:00', '19:30', '20:00', '20:15', '20:30', '20:45']) for (const stay of ['0', 'missing']) for (const geo of ['same', 'none']) sweep.push([arr, stay, geo]);
  it.each(sweep)('r5-5 sweep: ICN %s × stay %s × coordinates %s, same hotel bookends → saved', async (arr, stay, geo) => {
    const ready = toMin(arr) + 180;
    const c = geo === 'same' ? P : noGeo;
    const first: Stop = { category: 'lodging', name: '명동 호텔', start_time: fmt(Math.min(ready, 1439)), ...c, ...(stay === '0' ? { stay_min: 0 } : {}) };
    const it5 = await run([{ day: 1, city: 'seoul', stops: [first, { category: 'lodging', name: '명동 호텔', start_time: '23:59', ...c }] }, midDay(2), lastDay(3)], { arrivalTime: arr, tourEndTime: '21:00' });
    expect(it5.days[0].stops.map((s) => s.category)).toEqual(['lodging', 'lodging']);
  });
  it('r5-5: an optional late dinner between the bookends is removed, then the bookends merge → saved (was 422)', async () => {
    const it5 = await run([{ day: 1, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel', start_time: '23:30', stay_min: 0, ...noGeo }, { category: 'food', name: 'Dinner', start_time: '23:40', stay_min: 60, ...at(1) }, { category: 'lodging', name: 'Hotel', start_time: '23:59', ...noGeo }] }, midDay(2), lastDay(3)], { arrivalTime: '20:30', tourEndTime: '21:00' });
    expect(it5.days[0].stops.map((s) => s.category)).toEqual(['lodging', 'lodging']);
  });
  it('city-change days do not merge (caller passes mergeBookend:false) — chain time with leg + buffer', () => {
    const places = [{ category: 'lodging', stay_min: 0, ...noGeo }, { category: 'lodging', ...noGeo }];
    expect(stitchStartMins(places, { firstMin: 1400, legMins: [20], buffer: 5, mergeBookend: false }).starts).toEqual([1400, 1425]);
    expect(stitchStartMins(places, { firstMin: 1400, legMins: [20], buffer: 5, mergeBookend: true }).starts).toEqual([1400, 1400]);
  });
});

describe('r5-4 — the block-mode Inngest dispatch carries the free coupon too', () => {
  it('both handlerCore dispatches pass consumedCoupon: consumedCouponInfo (legacy + block mode)', () => {
    const core = readFileSync(resolve(process.cwd(), 'api/_ai_core/handlerCore.js'), 'utf8');
    expect((core.match(/consumedCoupon: consumedCouponInfo/g) || []).length).toBe(2);
    const blk = core.slice(core.indexOf('tryBlockModeInngestPath({'), core.indexOf('sendEarlyResponse:'));
    expect(blk).toContain('consumedCoupon: consumedCouponInfo, // PR2 r5-4');
  });
});

describe('r5-6 — ALREADY / unknown airport: the Day1 meal windows start at R (no +160 min)', () => {
  it.each([['ALREADY'], ['']])('arrival 14:30, airport %j → the lunch is kept inside the lunch window', async (airport) => {
    const itinerary: Plan = { days: [{ day: 1, city: 'seoul', stops: [hotel('14:30', { stay_min: 0 }), { category: 'culture', name: 'Palace', start_time: '14:30', stay_min: 60, ...at(1) }, { category: 'food', name: 'Lunch', start_time: '15:30', stay_min: 60, ...at(2) }, hotel('20:00')] }, midDay(2), lastDay(3)] };
    await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', arrivalTime: '14:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: airport, departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    const lunch = itinerary.days[0].stops.find((s) => s.name === 'Lunch');
    expect(lunch).toBeDefined();
    expect(toMin(lunch!.start_time)).toBeGreaterThanOrEqual(11 * 60);
    expect(toMin(lunch!.start_time)).toBeLessThan(17 * 60);
  });
});

describe('r5-7 — P203 timeout, then a late RouteAgent merge after settle shortened the day', () => {
  const origSetTimeout = globalThis.setTimeout;
  afterEach(() => { globalThis.setTimeout = origSetTimeout; });
  it('probe d6: the late merge finds the right original stop (entry fee kept)', async () => {
    const block = (id: string, spec: Array<[string, number]>) => ({ id, city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
      stops: spec.map(([cat, off], i) => ({ order: i + 1, name: `${id} ${cat} ${off}`, category: cat, start_time_offset_min: off, stay_min: 60, entry_fee_krw: (i + 1) * 1000, reservation_note: `res-${i}`, recommended_items: [`item-${i}`], lat: P.lat + (i + 1) * 0.004, lng: P.lng + (i + 1) * 0.004 })) });
    const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day: false };
    const sel = { day_selections: [{ day: 1, block_id: 'S1', tweak_notes: '' }, { day: 2, block_id: 'S2', tweak_notes: '' }], language: 'en' };
    const itin = expandBlocksToItinerary(sel, [block('S1', [['culture', 0], ['culture', 60], ['food', 360]]), block('S2', [['culture', 0], ['food', 180]])], structuredClone(input)) as Plan;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) => {
      if (first) { first = false; await gate; }
      return { index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null } as never;
    });
    let lateDone = false;
    const origCall = RouteAgent.prototype.call;
    vi.spyOn(RouteAgent.prototype, 'call').mockImplementation(function (this: RouteAgent, ...a: Parameters<RouteAgent['call']>) { return origCall.apply(this, a).finally(() => { lateDone = true; }); });
    // P203 180 s 타이머만 60ms 로(RouteAgent 는 실제 시계로 계속 돈다).
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => origSetTimeout(fn, ms === 180_000 ? 60 : ms, ...rest)) as never;
    await runRouteEnrichment(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    globalThis.setTimeout = origSetTimeout;
    release();
    await vi.waitFor(() => { if (!lateDone) throw new Error('route still running'); }, { timeout: 15000, interval: 50 });
    await new Promise((r) => setTimeout(r, 50));
    const food = itin.days[0].stops.find((s) => s.category === 'food')!;
    // 블록 펼침은 entry_fee_krw 만 옮긴다(reservation_note·recommended_items 는 원래 없음 — 프로브 pre 상태와 같음). 수정 전 = undefined.
    expect(food).toMatchObject({ entry_fee_krw: 3000 });
    for (const s of itin.days[0].stops) expect(s.entry_fee_krw, String(s.name)).toBeDefined();
  }, 30000);
});
