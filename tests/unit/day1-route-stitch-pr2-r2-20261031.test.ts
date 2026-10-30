/**
 * 첫날 도착 PR2 r2 — Astra 코드 r1(astra-pr2-code-r1) 7건 회귀. 실제 RouteAgent 오프라인(axios·transit·ODsay·캐시·텔레그램·LLM mock,
 *   구간 20분 + 버퍼 5). ICN_T1·서울 준비 = 도착 + 180분. 실호출 0.
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
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { runFinalItineraryValidation, tripTimesFrom, FINAL_GATE_MEAL_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { mealWindowsFromRequest } from '../../api/_ai_core/responseValidator.js';
import { expandBlocksToItinerary } from '../../api/_ai_core/blockMode.js';
import { resolveErrorStateCopy } from '../../src/pages/PlanDetailPage/components/errorStateCopy';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[]; [k: string]: unknown }> };
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const names = (stops: Stop[]) => stops.map((s) => `${s.name} ${s.start_time}`);
const hotel = (t: string) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P });
const lastDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });
const plainDay1 = () => ({ day: 1, city: 'seoul', stops: [hotel('07:00'), { category: 'culture', name: 'Palace', start_time: '09:00', stay_min: 60, ...at(1) }, { category: 'food', name: 'Lunch', start_time: '12:30', stay_min: 60, ...at(2) }, { category: 'food', name: 'Dinner', start_time: '18:30', stay_min: 60, ...at(3) }, hotel('21:00')] });

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  spy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { spy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; });

async function run(days: Plan['days'], body: Record<string, unknown> = {}) {
  const itinerary: Plan = { days };
  await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', ...body }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
  return itinerary;
}

describe('r2-1 (P1) — a day emptied by placement is applied, never revived from the original', () => {
  it('Astra repro: Day2 [Hotel 21:00, sight 22:00·180] → midnight → nothing fits → ROUTE_DAY_INFEASIBLE (not "sight 22:00–01:00, hotel 02:00")', async () => {
    await expect(run([plainDay1(), { day: 2, city: 'seoul', stops: [hotel('21:00'), { category: 'culture', name: 'Late Show', start_time: '22:00', stay_min: 180, ...at(1) }] }, lastDay(3)]))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE' });
  });
  it('Day1 with only sightseeing that all starts after tour end (not midnight) → saved empty, not the original stops', async () => {
    const it1 = await run([{ day: 1, city: 'seoul', stops: [{ category: 'culture', name: 'Night Walk', start_time: '21:30', stay_min: 60, ...at(1) }] }, lastDay(2)], { arrivalTime: '18:30', tourEndTime: '21:00' });
    expect(it1.days[0].stops).toEqual([]);
  });
});

describe('r2-2 — a meal removed by placement is checked by the final gate for every guest (not only dietary ones)', () => {
  it('1-day, end 18:00, lunch 16:50, dinner 17:00 → dinner removed → non-dietary gate fails with B-MEAL-DINNER', async () => {
    const day = { day: 1, city: 'seoul', stops: [hotel('09:00'), { category: 'food', name: 'Lunch', start_time: '16:50', stay_min: 60, ...at(1) }, { category: 'food', name: 'Dinner', start_time: '17:00', stay_min: 60, ...at(2) }, hotel('18:30')] };
    const it2 = await run([day], { tourEndTime: '18:00' });
    expect(it2.days[0].stops.some((s) => s.name === 'Dinner')).toBe(false);
    expect(it2.days[0]._routeMealRemoved).toBe(true);
    const meal_windows = mealWindowsFromRequest({ durationDays: 1, tourEndTime: '18:00', regions: ['seoul'] });
    const gate = runFinalItineraryValidation(it2, { dietary: [], tripTimes: { ...tripTimesFrom({ area: 'seoul', regions: ['seoul'], tourEndTime: '18:00' }), meal_windows } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
    expect(gate.requiredMealIssues.some((m: string) => /B-MEAL-DINNER/.test(m))).toBe(true);
  });
  it('days where placement removed no meal keep the old no-op for non-dietary guests', () => {
    const it0: Plan = { days: [{ day: 1, city: 'seoul', stops: [hotel('09:00'), hotel('21:00')] }] };
    expect(runFinalItineraryValidation(it0, { dietary: [], tripTimes: { area: 'seoul' } })).toMatchObject({ ok: true });
  });
});

describe('r2-3 — no lodging first: lowering the preference to R really moves the first stop', () => {
  it('ready 19:30, end 21:00: [sight 20:00, dinner] → sight 19:30, dinner 20:55 (nothing removed)', async () => {
    const it3 = await run([{ day: 1, city: 'seoul', stops: [{ category: 'culture', name: 'Palace', start_time: '20:00', stay_min: 60, ...at(1) }, { category: 'food', name: 'Dinner', start_time: '20:30', stay_min: 60, ...at(2) }, hotel('22:00')] }, lastDay(2)], { arrivalTime: '16:30', tourEndTime: '21:00' });
    expect(names(it3.days[0].stops).slice(0, 2)).toEqual(['Palace 19:30', 'Dinner 20:55']);
  });
  it('first stop is a restaurant at 22:30 → moved into the dinner window (20:59), not removed', async () => {
    const it3b = await run([{ day: 1, city: 'seoul', stops: [{ category: 'food', name: 'Late Dinner', start_time: '22:30', stay_min: 60, ...at(1) }, hotel('23:00')] }, lastDay(2)], { arrivalTime: '16:30', tourEndTime: '21:00' });
    expect(it3b.days[0].stops[0]).toMatchObject({ name: 'Late Dinner', start_time: '20:59' });
  });
});

describe('r2-4 — a rescued after-midnight dinner keeps its dinner role through placement', () => {
  it('block ready 19:30: restaurant at 01:30 rescued as dinner → RouteAgent places it inside the dinner window (≤ 20:59); the role marker is not saved', async () => {
    const block = { id: 'S1', city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard', stops: [
      { order: 1, name: 'Sight A', category: 'culture', start_time_offset_min: 0, stay_min: 60 },
      { order: 2, name: 'Late Food', category: 'food', start_time_offset_min: 360, stay_min: 60 },
    ] };
    const itin = expandBlocksToItinerary({ day_selections: [{ day: 1, block_id: 'S1', tweak_notes: '' }, { day: 2, block_id: 'S2', tweak_notes: '' }], language: 'en' },
      [block, { ...block, id: 'S2' }], { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2099-12-01', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day: false }) as Plan;
    const food = itin.days[0].stops.find((s) => s.category === 'food');
    expect(food).toBeDefined(); // 전제: 구제됨
    expect(food!._blockMealRole).toBe('dinner');
    await enrichItineraryWithRoute(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    const placed = itin.days[0].stops.find((s) => s.category === 'food')!;
    expect(toMin(placed.start_time)).toBeGreaterThanOrEqual(17 * 60);
    expect(toMin(placed.start_time)).toBeLessThanOrEqual(20 * 60 + 59);
    expect('_blockMealRole' in placed).toBe(false);
  });
});

describe('r2-5 — the stop after a removed one never keeps directions from the removed place', () => {
  it('NightView removed → LateBar\'s "walk 7 min from NightView" is gone; the leg is the re-queried 20 min', async () => {
    const it5 = await run([plainDay1(), { day: 2, city: 'seoul', stops: [hotel('20:00'),
      { category: 'culture', name: 'NightView', start_time: '20:30', stay_min: 90, ...at(1) },
      { category: 'food', name: 'LateBar', start_time: '22:10', stay_min: 60, ...at(2), transit_from_prev: { method: 'walk', est_min: 7, instruction_en: 'Walk 7 min from NightView', step_by_step: ['Leave NightView by exit 2'] } },
      hotel('23:00')] }, lastDay(3)]);
    const bar = it5.days[1].stops.find((s) => s.name === 'LateBar')!;
    expect(it5.days[1].stops.some((s) => s.name === 'NightView')).toBe(false);
    expect(JSON.stringify(bar.transit_from_prev || {})).not.toMatch(/NightView/);
    expect((bar.transit_from_prev as { est_min?: number }).est_min).toBe(20);
    expect('_transitReset' in bar).toBe(false);
  });
});

describe('r2-7 — guest-facing reasons in 4 languages (sync 422 code + async failure screen)', () => {
  it('planner errors have ROUTE_DAY_INFEASIBLE / DIETARY_MEAL_COVERAGE_FAILED in every locale', () => {
    for (const l of ['ko', 'en', 'ja', 'zh']) {
      const errors = JSON.parse(read(`src/i18n/locales/${l}.json`)).planner.errors;
      expect(typeof errors.ROUTE_DAY_INFEASIBLE, l).toBe('string');
      expect(typeof errors.DIETARY_MEAL_COVERAGE_FAILED, l).toBe('string');
    }
  });
  it('async failure screen prepends the reason for the stored code; unknown codes keep the generic copy', () => {
    for (const l of ['ko', 'en', 'ja', 'zh']) {
      const generic = resolveErrorStateCopy(l, {}).desc;
      expect(resolveErrorStateCopy(l, {}, 'ROUTE_DAY_INFEASIBLE').desc).not.toBe(generic);
      expect(resolveErrorStateCopy(l, {}, 'DIETARY_MEAL_COVERAGE_FAILED').desc.endsWith(generic)).toBe(true);
      expect(resolveErrorStateCopy(l, {}, 'SOMETHING_ELSE').desc).toBe(generic);
    }
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toContain('_streaming_error_code: error.code.slice(0, 80)');
    expect(read('src/pages/PlanDetailPage/index.tsx')).toContain('reasonCode={');
  });
  it('sync 422 body carries the code (planCloseout) — the planner page localizes it by code', () => {
    expect(read('api/_ai_core/planCloseout.js')).toContain("const code = error.code || 'INTERNAL_ERROR';");
  });
});
