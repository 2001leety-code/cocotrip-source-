/**
 * 첫날 도착 PR2 r3 — 적대적 r1 스티칭 렌즈(pr2-adversarial-r1) + Astra 코드 r2 회귀. 실제 RouteAgent 오프라인(전부 mock,
 *   구간 20분 + 버퍼 5). ICN_T1·서울 준비 = 도착 + 180분. Inngest 직렬화는 설치된 SDK 의 실제 serializeError/StepError 로 왕복.
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
import { RouteAgent, stitchStartMins, routeDayInfeasibleError } from '../../api/_ai_core/agents/RouteAgent.js';
import { runFinalItineraryValidation, tripTimesFrom, buildFinalGateError, failureCodeOf, FINAL_GATE_MEAL_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { checkRequiredMeals } from '../../api/_ai_core/responseValidator.js';
// @ts-expect-error — 설치된 Inngest SDK 내부 모듈(실제 직렬화 왕복 검증용)
import { serializeError } from '../../node_modules/inngest/helpers/errors.js';
// @ts-expect-error — 설치된 Inngest SDK 내부 모듈
import { StepError } from '../../node_modules/inngest/components/StepError.js';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[]; [k: string]: unknown }> };
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const hotel = (t: string, extra: Stop = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P, ...extra });
const lastDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });
const midDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('07:00'), { category: 'food', name: `Lunch ${day}`, start_time: '12:30', stay_min: 60, ...at(1) }, { category: 'food', name: `Dinner ${day}`, start_time: '18:30', stay_min: 60, ...at(2) }, hotel('21:00')] });
const monotonic = (stops: Stop[]) => { const m = stops.map((s) => toMin(s.start_time)); return m.every((v, i) => i === 0 || v >= m[i - 1]) && m.every((v) => v >= 0 && v < 1440); };

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  spy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { spy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; });

async function run(days: Plan['days'], body: Record<string, unknown> = {}) {
  const itinerary: Plan = { days };
  await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', ...body }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
  return itinerary;
}

describe('r3-1 — the meal gate matches days by number (arrival / departure / middle prefixes)', () => {
  it('adversarial repro: ICN 16:35, Day1 hotel (no stay) + Palace 20:00 + Dinner 20:30 → both removed → the gate now FAILS (was ok:true)', async () => {
    const it1 = await run([{ day: 1, city: 'seoul', stops: [hotel('19:35'), { category: 'culture', name: 'Palace', start_time: '20:00', stay_min: 60, ...at(1) }, { category: 'food', name: 'Dinner', start_time: '20:30', stay_min: 60, ...at(2) }, hotel('22:00')] }, midDay(2), lastDay(3)], { arrivalTime: '16:35', tourEndTime: '21:00' });
    expect(it1.days[0]._routeMealRemoved).toBe(true);
    const trip = tripTimesFrom({ arrivalTime: '16:35', arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '10:00', tourEndTime: '21:00' });
    expect(checkRequiredMeals(it1, trip).some((m: string) => /^Day 1 \(/.test(m))).toBe(true); // 접두어 "Day 1 (도착일):"
    expect(runFinalItineraryValidation(it1, { dietary: [], tripTimes: trip })).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
  });
  it('departure-day and middle-day prefixes are matched too', () => {
    const plan: Plan = { days: [
      { day: 1, city: 'seoul', stops: [hotel('09:00'), { category: 'food', name: 'L', start_time: '12:00', stay_min: 60 }, { category: 'food', name: 'D', start_time: '18:00', stay_min: 60 }, hotel('21:00')] },
      { day: 2, city: 'seoul', _routeMealRemoved: true, stops: [hotel('09:00'), { category: 'culture', name: 'A', start_time: '10:00' }, { category: 'culture', name: 'B', start_time: '14:00' }, hotel('21:00')] },
      { day: 3, city: 'seoul', _routeMealRemoved: true, stops: [hotel('08:00'), { category: 'culture', name: 'C', start_time: '10:00' }, { category: 'airport', name: 'Incheon International Airport', start_time: '15:00' }] },
    ] };
    const trip = tripTimesFrom({ arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '19:00', tourEndTime: '21:00' });
    const issues = checkRequiredMeals(plan, trip);
    expect(issues.some((m: string) => /^Day 2:/.test(m))).toBe(true);
    expect(issues.some((m: string) => /^Day 3 \(/.test(m))).toBe(true);
    const gate = runFinalItineraryValidation(plan, { dietary: [], tripTimes: trip });
    expect(gate.ok).toBe(false);
    expect(gate.requiredMealIssues.some((m: string) => /^Day 3 \(/.test(m))).toBe(true);
    expect(gate.requiredMealIssues.some((m: string) => /^Day 2:/.test(m))).toBe(true);
  });
});

describe('r3-2 — an explicit 0-minute hotel marker stays 0 (the only dinner is kept in the (end−85, end−60] ready band)', () => {
  const day1 = (ready: string) => ({ day: 1, city: 'seoul', stops: [hotel(ready, { stay_min: 0 }), { category: 'culture', name: 'Palace', start_time: '20:00', stay_min: 60, ...at(1) }, { category: 'food', name: 'Dinner', start_time: '20:30', stay_min: 60, ...at(2) }, hotel('22:00')] });
  it.each([['16:34', '19:34'], ['16:35', '19:35'], ['16:45', '19:45'], ['16:59', '19:59']])('arrival %s (ready %s) → Dinner kept inside the window', async (arrivalTime, ready) => {
    const it2 = await run([day1(ready), midDay(2), lastDay(3)], { arrivalTime, tourEndTime: '21:00' });
    const dinner = it2.days[0].stops.find((s) => s.name === 'Dinner');
    expect(dinner).toBeDefined();
    expect(toMin(dinner!.start_time)).toBeLessThanOrEqual(20 * 60 + 59);
    expect(monotonic(it2.days[0].stops)).toBe(true);
  });
  it('a real positive stay is still counted (normal Day1 hotel 08:30 with stay 60 → first activity after 09:55)', async () => {
    const it2b = await run([{ day: 1, city: 'seoul', stops: [hotel('08:30', { stay_min: 60 }), { category: 'culture', name: 'Palace', start_time: '09:30', stay_min: 60, ...at(1) }, { category: 'food', name: 'Lunch', start_time: '12:30', stay_min: 60, ...at(2) }, hotel('20:00')] }, midDay(2), lastDay(3)]);
    expect(it2b.days[0].stops[1]).toMatchObject({ name: 'Palace', start_time: '09:55' });
  });
});

describe('r3-3 — consecutive markers of the same hotel never fail at midnight; a real hotel change still does', () => {
  it('E1 Day1 [Hotel 22:35, Hotel 23:30], arrival 19:35 → saved, times in order', async () => {
    const it3 = await run([{ day: 1, city: 'seoul', stops: [hotel('22:35'), hotel('23:30')] }, midDay(2), lastDay(3)], { arrivalTime: '19:35', tourEndTime: '21:00' });
    expect(monotonic(it3.days[0].stops)).toBe(true);
  });
  it('E2 Day1 [Hotel 23:00, LateDinner 23:30, Hotel 00:30], arrival 20:00 → dinner removed, hotels kept, no 422', async () => {
    const it3 = await run([{ day: 1, city: 'seoul', stops: [hotel('23:00'), { category: 'food', name: 'LateDinner', start_time: '23:30', stay_min: 60, ...at(1) }, hotel('00:30')] }, midDay(2), lastDay(3)], { arrivalTime: '20:00', tourEndTime: '21:00' });
    expect(it3.days[0].stops.map((s) => s.category)).toEqual(['lodging', 'lodging']);
    expect(monotonic(it3.days[0].stops)).toBe(true);
  });
  it('E3 Day2 [Hotel 22:40, Hotel 23:30] → saved', async () => {
    const it3 = await run([midDay(1), { day: 2, city: 'seoul', stops: [hotel('22:40'), hotel('23:30')] }, lastDay(3)]);
    expect(monotonic(it3.days[1].stops)).toBe(true);
  });
  it('E4 a different hotel (name and coordinates differ) keeps the leg and the midnight rule → 422', async () => {
    await expect(run([midDay(1), { day: 2, city: 'seoul', stops: [hotel('22:40'), { category: 'lodging', name: 'Other Hotel', start_time: '23:30', lat: P.lat + 0.05, lng: P.lng + 0.05 }] }, lastDay(3)]))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE' });
  });
});

describe('r3-4 — a second restaurant of the same role on Day1 (cafe) is removable, not a required meal', () => {
  it('G1: ready 18:30 [Hotel(0), Market 18:30, Dinner 20:00, Cafe 20:40] → Market and Dinner kept, Cafe removed (it used to push Market out)', async () => {
    const it4 = await run([{ day: 1, city: 'seoul', stops: [hotel('18:30', { stay_min: 0 }), { category: 'culture', name: 'Market', start_time: '18:30', stay_min: 60, ...at(1) },
      { category: 'food', name: 'Dinner', start_time: '20:00', stay_min: 60, ...at(2) }, { category: 'food', name: 'Cafe', start_time: '20:40', stay_min: 40, ...at(3) }, hotel('22:30')] }, midDay(2), lastDay(3)], { arrivalTime: '15:30', tourEndTime: '21:00' });
    const names = it4.days[0].stops.map((s) => s.name);
    expect(names).toContain('Market');
    expect(names).toContain('Dinner');
    expect(names).not.toContain('Cafe');
  });
});

describe('r3-5/6 — stay sanity and the floor target', () => {
  it('negative / zero / missing / non-numeric stay: 0, 0, 60, 60 — never runs backwards', () => {
    const places = [{ category: 'lodging', stay_min: -30 }, { category: 'culture', stay_min: 0 }, { category: 'culture' }, { category: 'culture', stay_min: 'abc' }, { category: 'lodging' }];
    const { starts } = stitchStartMins(places, { firstMin: 600, legMins: [10, 10, 10, 10], buffer: 5 });
    expect(starts).toEqual([600, 615, 630, 705, 780]);
  });
  it('H11: Day1 [Transfer 15:30 (airport_transfer), Palace] ready 17:00 → Transfer keeps its chain time, the floor lands on Palace', async () => {
    const it6 = await run([{ day: 1, city: 'seoul', stops: [{ category: 'airport_transfer', name: 'Transfer', start_time: '15:30', stay_min: 30, ...at(1) }, { category: 'culture', name: 'Palace', start_time: '16:00', stay_min: 60, ...at(2) }, hotel('19:00')] }, midDay(2), lastDay(3)], { arrivalTime: '14:00', tourEndTime: '21:00' });
    expect(it6.days[0].stops[0]).toMatchObject({ name: 'Transfer', start_time: '15:30' });
    expect(it6.days[0].stops[1]).toMatchObject({ name: 'Palace', start_time: '17:00' });
  });
});

describe('r3 new-4 — the failure code survives the real Inngest StepError serialization', () => {
  it.each([
    ['ROUTE_DAY_INFEASIBLE', () => routeDayInfeasibleError(['Day 2: x'])],
    [FINAL_GATE_MEAL_CODE, () => buildFinalGateError({ code: FINAL_GATE_MEAL_CODE, violations: [], zeroFoodDays: [], requiredMealIssues: ['Day 1: …'] }, [], 'post_response')],
  ])('%s → serializeError → JSON → StepError → failureCodeOf', (code, make) => {
    const wire = JSON.parse(JSON.stringify(serializeError(make())));
    const stepErr = new StepError('routeEnrich', wire);
    expect(stepErr.code).toBeUndefined(); // SDK 는 최상위 code 를 복사하지 않는다(원인)
    expect(failureCodeOf(stepErr)).toBe(code);
  });
  it('only allow-listed codes are stored', () => {
    expect(failureCodeOf({ code: 'SOME_INTERNAL', cause: { code: 'ANOTHER' } })).toBeUndefined();
    expect(failureCodeOf({ cause: { code: 'ROUTE_DAY_INFEASIBLE' } })).toBe('ROUTE_DAY_INFEASIBLE');
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toContain('...(failureCodeOf(error) ? { _streaming_error_code: failureCodeOf(error) } : {}),');
  });
});
