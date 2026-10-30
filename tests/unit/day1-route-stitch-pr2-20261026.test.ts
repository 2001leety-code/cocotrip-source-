/**
 * 2026-10-26 첫날 도착 PR2 — 동선 계산: 도착 시각 반영 + 식사 자리 먼저 확보 + 자정 명시 실패 (구현 지도 day1-map-pr2 §6·§7).
 *   실제 RouteAgent 오프라인 실행: axios·transit·ODsay·transitCache·텔레그램·LLM 전부 mock, 구간 이동 20분 고정(+ 버퍼 5).
 *   ICN_T1·서울 준비 시각 = 도착 + 180분. 실호출 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
const alerts = vi.hoisted(() => [] as string[]);
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async (a: { key: string }) => { alerts.push(a.key); }) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent, stitchStartMins, findStitchViolation } from '../../api/_ai_core/agents/RouteAgent.js';
import { applyTourEndCap } from '../../api/_ai_core/postResponsePipeline.js';
import { checkRequiredMeals } from '../../api/_ai_core/responseValidator.js';
import { tripTimesFrom } from '../../api/_ai_core/finalItineraryGate.js';
import { resolveTourStartTime, resolveArrivalTime, resolveDepartureTime } from '../../api/_ai_core/constants.js';
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity, rescueFirstDayMeal } from '../../api/_ai_core/blockMode.js';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[] }> };
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const names = (stops: Stop[]) => stops.map((s) => `${s.name} ${s.start_time}`);

let transitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  alerts.length = 0;
  process.env.ROUTE_TSP_ENABLED = 'false';
  transitSpy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { transitSpy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; });

// Day1 기본 픽스처(지도 §7): Hotel 16:30 → Palace(60) → Market(60) → Dinner(음식, 원래 19:30, 60) → Hotel. 3일 여행.
const lateDay1 = (): Stop[] => [
  { category: 'lodging', name: 'Hotel', start_time: '16:30', ...P },
  { category: 'culture', name: 'Palace', start_time: '16:40', stay_min: 60, ...at(1) },
  { category: 'culture', name: 'Market', start_time: '18:00', stay_min: 60, entry_fee_krw: 5000, reservation_note: 'book ahead', ...at(2) },
  { category: 'food', name: 'Dinner', start_time: '19:30', stay_min: 60, ...at(3) },
  { category: 'lodging', name: 'Hotel', start_time: '21:00', ...P },
];
// r2: 숙소 07:00 — 체류 60 + 구간 25 = 08:25 이 09:00 바닥보다 이르다(바닥이 보이는 픽스처).
const morningDay1 = (): Stop[] => [
  { category: 'lodging', name: 'Hotel', start_time: '07:00', ...P },
  { category: 'culture', name: 'Palace', start_time: '08:30', stay_min: 60, ...at(1) },
  { category: 'food', name: 'Lunch', start_time: '12:30', stay_min: 60, ...at(2) },
  { category: 'lodging', name: 'Hotel', start_time: '20:00', ...P },
];
const normalDay = (day: number): { day: number; city: string; stops: Stop[] } => ({ day, city: 'seoul', stops: [
  { category: 'lodging', name: 'Hotel', start_time: '09:00', ...P },
  { category: 'food', name: `Lunch ${day}`, start_time: '12:30', stay_min: 60, ...at(1) },
  { category: 'food', name: `Dinner ${day}`, start_time: '18:30', stay_min: 60, ...at(2) },
  { category: 'lodging', name: 'Hotel', start_time: '21:00', ...P },
] });
const lastDay = (day: number) => ({ day, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel', start_time: '06:00', ...P }, { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });

async function run(day1: Stop[], body: Record<string, unknown>, extraDays: Plan['days'] = [normalDay(2), lastDay(3)]) {
  const itinerary: Plan = { days: [{ day: 1, city: 'seoul', stops: day1 }, ...extraDays] };
  await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', ...body }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
  return itinerary;
}

describe('M1–M6 — Day1 arrival floor + meal placed first (legacy late first day)', () => {
  // r2 (편차① 철회): 첫 활동 = max(바닥, 숙소 시각 + 체류 60 + 구간 + 버퍼) — 16:30 숙소면 17:55 가 17:00 바닥보다 늦다.
  it('M1 arrivalTime 14:00 (camel, ready 17:00) → Palace 17:55 / Market 19:20 / Dinner 20:45 / Hotel 22:10 (hotel stay kept); tour-end cap changes nothing', async () => {
    const it1 = await run(lateDay1(), { arrivalTime: '14:00', tourEndTime: '21:00' });
    expect(names(it1.days[0].stops)).toEqual(['Hotel 16:30', 'Palace 17:55', 'Market 19:20', 'Dinner 20:45', 'Hotel 22:10']);
    const before = JSON.stringify(it1.days[0].stops);
    applyTourEndCap(it1, '21:00', { arrivalRestDay: false });
    expect(JSON.stringify(it1.days[0].stops)).toBe(before);
  });
  it('M2 13:59 (ready 16:59) → hotel stay wins: 17:55 / 19:20 / 20:45 / 22:10; an earlier hotel (15:30) shows the floor: 16:59 / 18:24 / 19:49 / 21:14', async () => {
    const it2 = await run(lateDay1(), { arrivalTime: '13:59', tourEndTime: '21:00' });
    expect(it2.days[0].stops.slice(1).map((s) => s.start_time)).toEqual(['17:55', '19:20', '20:45', '22:10']);
    const early = lateDay1(); early[0].start_time = '15:30';
    const it2b = await run(early, { arrivalTime: '13:59', tourEndTime: '21:00' });
    expect(it2b.days[0].stops.slice(1).map((s) => s.start_time)).toEqual(['16:59', '18:24', '19:49', '21:14']);
  });
  it('M3 16:30 (ready 19:30) → Market removed, one re-queried leg; Dinner 20:55; Day1 meal requirement satisfied; Dinner keeps its own fields', async () => {
    const m1Calls = (await (async () => { transitSpy.mockClear(); await run(lateDay1(), { arrivalTime: '14:00', tourEndTime: '21:00' }); return transitSpy.mock.calls.length; })());
    transitSpy.mockClear();
    const it3 = await run(lateDay1(), { arrivalTime: '16:30', tourEndTime: '21:00' });
    expect(names(it3.days[0].stops)).toEqual(['Hotel 16:30', 'Palace 19:30', 'Dinner 20:55', 'Hotel 22:20']);
    expect(transitSpy.mock.calls.length).toBe(m1Calls + 1);
    const trip = tripTimesFrom({ arrivalTime: '16:30', arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '10:00', tourEndTime: '21:00' });
    expect(checkRequiredMeals(it3, trip).filter((m: string) => /^Day 1/.test(m))).toEqual([]);
    const dinner = it3.days[0].stops.find((s) => s.name === 'Dinner')!;
    expect(dinner.entry_fee_krw).toBeUndefined(); // M15 (Market 의 입장료·예약 정보를 받지 않음)
    expect(dinner.reservation_note).toBeUndefined();
    expect(it3.days[0].stops.every((s) => !('_ri' in s))).toBe(true);
  });
  it('M4 end 22:00, 17:59 (ready 20:59, not a rest day) → both sightseeing stops removed, Dinner 20:59, Hotel 22:24', async () => {
    const it4 = await run(lateDay1(), { arrivalTime: '17:59', tourEndTime: '22:00' });
    expect(names(it4.days[0].stops)).toEqual(['Hotel 16:30', 'Dinner 20:59', 'Hotel 22:24']);
  });
  it('M5 one-day, end 23:59, 18:59 (ready 21:59) → Dinner 21:59, Hotel 23:24', async () => {
    const it5 = await run(lateDay1(), { arrivalTime: '18:59', tourEndTime: '23:59' }, []);
    expect(names(it5.days[0].stops)).toEqual(['Hotel 16:30', 'Dinner 21:59', 'Hotel 23:24']);
  });
  it('M6 one-day, end 23:59, 19:00 (ready 22:00) → Dinner removed (no window), Market removed (midnight) → Hotel, Palace 22:00, Hotel 23:25', async () => {
    const it6 = await run(lateDay1(), { arrivalTime: '19:00', tourEndTime: '23:59' }, []);
    expect(names(it6.days[0].stops)).toEqual(['Hotel 16:30', 'Palace 22:00', 'Hotel 23:25']);
  });
});

describe('M7–M10 — midnight: absolute minutes, no wrap-back; explicit failure when nothing can be removed', () => {
  const day2 = (stops: Stop[]) => [{ day: 2, city: 'seoul', stops }, lastDay(3)];
  const hotel = (t: string) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P });
  it('M7 Day2 [Hotel 21:00, Food 22:34, Hotel] → Hotel 23:59 (1439) passes', async () => {
    const it7 = await run(morningDay1(), {}, day2([hotel('21:00'), { category: 'food', name: 'Late', start_time: '22:34', stay_min: 60, ...at(1) }, hotel('23:00')]));
    expect(names(it7.days[1].stops)).toEqual(['Hotel 21:00', 'Late 22:34', 'Hotel 23:59']);
  });
  it('M8 same day with 22:35 → 1440 → ROUTE_DAY_INFEASIBLE rejected (422), no route-enrich-fail alert', async () => {
    await expect(run(morningDay1(), {}, day2([hotel('21:00'), { category: 'food', name: 'Late', start_time: '22:35', stay_min: 60, ...at(1) }, hotel('23:00')])))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE', statusCode: 422, stage: 'routeEnrich' });
    expect(alerts.filter((k) => /route-enrich|route_enrich/i.test(k))).toEqual([]);
  });
  it('M9 Day2 [Hotel 20:00, NightView(90), LateBar 22:10, Hotel] → NightView removed, LateBar 22:10, Hotel 23:35, times increase', async () => {
    const it9 = await run(morningDay1(), {}, day2([hotel('20:00'), { category: 'culture', name: 'NightView', start_time: '20:30', stay_min: 90, ...at(1) }, { category: 'food', name: 'LateBar', start_time: '22:10', stay_min: 60, ...at(2) }, hotel('23:00')]));
    expect(names(it9.days[1].stops)).toEqual(['Hotel 20:00', 'LateBar 22:10', 'Hotel 23:35']);
    const mins = it9.days[1].stops.map((s) => toMin(s.start_time));
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });
  it('M10 LateBar 23:20 with no sightseeing → 1485 → throw (never "23:20 → Hotel 23:00")', async () => {
    await expect(run(morningDay1(), {}, day2([hotel('20:00'), { category: 'food', name: 'LateBar', start_time: '23:20', stay_min: 60, ...at(2) }, hotel('23:00')])))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE' });
  });
});

describe('M11–M14 — input normalization at the boundary and inside RouteAgent', () => {
  it('M11 snake arrival_time "16:30:00" → same as M3', async () => {
    const it11 = await run(lateDay1(), { arrival_time: '16:30:00', tourEndTime: '21:00' });
    expect(names(it11.days[0].stops)).toEqual(['Hotel 16:30', 'Palace 19:30', 'Dinner 20:55', 'Hotel 22:20']);
  });
  it.each([[1630], [{}]])('M12 arrivalTime %j → no exception, floor 09:00', async (arrivalTime) => {
    const it12 = await run(morningDay1(), { arrivalTime });
    expect(it12.days[0].stops[1].start_time).toBe('09:00');
  });
  it.each([[930], [{ h: 9 }], ['25:00'], ['9:3']])('M13 tourStartTime %j → "09:00" at the boundary and in a direct RouteAgent call', async (tourStartTime) => {
    expect(resolveTourStartTime({ tourStartTime })).toBe('09:00');
    const it13 = await run(morningDay1(), { tourStartTime });
    expect(it13.days[0].stops[1].start_time).toBe('09:00');
    const direct = JSON.parse((await new RouteAgent('').call(JSON.stringify({ itinerary: { days: [{ day: 1, city: 'seoul', places: morningDay1() }] }, regions: ['seoul'], area: 'seoul', language: 'en', tour_start_time: tourStartTime }))).rawOutput);
    expect(direct.itinerary.days[0].places[1].start_time).toBe('09:00');
  });
  it('M14 tourStartTime 12:00 (camel or snake), arrival 06:00 → first activity 12:00', async () => {
    expect((await run(morningDay1(), { tourStartTime: '12:00', arrivalTime: '06:00' })).days[0].stops[1].start_time).toBe('12:00');
    expect((await run(morningDay1(), { tour_start_time: '12:00', arrivalTime: '06:00' })).days[0].stops[1].start_time).toBe('12:00');
  });
  it('resolvers: camel first, then snake; strict HH:MM', () => {
    expect(resolveArrivalTime({ arrivalTime: '14:00', arrival_time: '09:00' })).toBe('14:00');
    expect(resolveArrivalTime({ arrival_time: '16:30:00' })).toBe('16:30');
    expect(resolveArrivalTime({ arrivalTime: 1630 })).toBe('');
    expect(resolveDepartureTime({ departure_time: '20:00' })).toBe('20:00');
  });
});

describe('M15 — enriched fields stay with their own stop after TSP reorder', () => {
  it('TSP on, no times: Far 9000 / Near 1000 keep their own fee; no _ri in the output', async () => {
    process.env.ROUTE_TSP_ENABLED = 'true';
    const far = { category: 'culture', name: 'Far', stay_min: 60, entry_fee_krw: 9000, lat: P.lat + 0.2, lng: P.lng + 0.2 };
    const near = { category: 'culture', name: 'Near', stay_min: 60, entry_fee_krw: 1000, ...at(1) };
    const it15 = await run(morningDay1(), {}, [{ day: 2, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel', ...P }, far, near, { category: 'lodging', name: 'Hotel', ...P }] }, lastDay(3)]);
    const d2 = it15.days[1].stops;
    expect(d2.map((s) => s.name)).toEqual(['Hotel', 'Near', 'Far', 'Hotel']); // 재정렬됨(전제)
    expect(d2.find((s) => s.name === 'Near')!.entry_fee_krw).toBe(1000);
    expect(d2.find((s) => s.name === 'Far')!.entry_fee_krw).toBe(9000);
    expect(it15.days.flatMap((d) => d.stops).every((s) => !('_ri' in s))).toBe(true);
  });
});

describe('M16–M18 — block mode first-day meal kept for placement (single + multi city)', () => {
  const block = (city: string, id: string, cats: string[], offsets: number[]) => ({ id, city, zone: 'Test', theme: 'T', intensity: 'standard',
    stops: offsets.map((off, i) => ({ order: i + 1, name: `${city} ${cats[i]} ${off}`, category: cats[i], start_time_offset_min: off, stay_min: 60 })) });
  const cats = ['culture', 'culture', 'food', 'culture'];
  const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00' };
  const day1Of = (itin: { days: Array<{ stops: Stop[] }> }) => itin.days[0].stops;
  it('M16 single city, ready 19:30, block [0,120,240,360] → Day1 food kept, the 21:30 sightseeing removed', () => {
    const itin = expandBlocksToItinerary({ day_selections: [{ day: 1, block_id: 'S1', tweak_notes: '' }], language: 'en' }, [block('seoul', 'S1', cats, [0, 120, 240, 360])], input) as { days: Array<{ stops: Stop[] }> };
    const stops = day1Of(itin);
    expect(stops.some((s) => s.category === 'food' || /food/.test(String(s.name)))).toBe(true);
    expect(stops.some((s) => s.start_time === '21:30')).toBe(false);
  });
  it('M16 multi city — same rule', () => {
    const itin = expandBlocksToItineraryMultiCity(
      { day_selections: [{ day: 1, city: 'seoul', block_id: 'S1', tweak_notes: '' }, { day: 2, city: 'busan', block_id: 'B1', tweak_notes: '' }], language: 'en' },
      [{ city: 'seoul', blocks: [block('seoul', 'S1', cats, [0, 120, 240, 360])] }, { city: 'busan', blocks: [block('busan', 'B1', ['culture', 'culture'], [0, 120])] }],
      { ...input, regions: ['seoul', 'busan'], arrival_rest_day: false },
    ) as { days: Array<{ stops: Stop[] }> };
    const stops = day1Of(itin);
    expect(stops.some((s) => s.category === 'food' || /food/.test(String(s.name)))).toBe(true);
    expect(stops.some((s) => s.start_time === '21:30')).toBe(false);
  });
  it('M17 arrival_rest_day:true → no food and no sightseeing on Day1 (unchanged)', () => {
    const itin = expandBlocksToItineraryMultiCity(
      { day_selections: [{ day: 1, city: 'seoul', block_id: 'S1', tweak_notes: '' }, { day: 2, city: 'busan', block_id: 'B1', tweak_notes: '' }], language: 'en' },
      [{ city: 'seoul', blocks: [block('seoul', 'S1', cats, [0, 120, 240, 360])] }, { city: 'busan', blocks: [block('busan', 'B1', ['culture', 'culture'], [0, 120])] }],
      { ...input, regions: ['seoul', 'busan'], arrival_rest_day: true },
    ) as { days: Array<{ stops: Stop[] }> };
    expect(day1Of(itin).filter((s) => !['lodging', 'airport', 'travel'].includes(String(s.category)))).toHaveLength(0);
  });
  it('M18 Day2 food after the cap → removed (unchanged)', () => {
    const itin = expandBlocksToItinerary(
      { day_selections: [{ day: 1, block_id: 'S1', tweak_notes: '' }, { day: 2, block_id: 'S2', tweak_notes: '' }], language: 'en' },
      [block('seoul', 'S1', ['culture'], [0]), block('seoul', 'S2', ['culture', 'food'], [0, 780])],
      { ...input, arrival_time: '', tour_start_time: '09:00' },
    ) as { days: Array<{ stops: Stop[] }> };
    expect(itin.days[1].stops.some((s) => toMin(s.start_time) > 21 * 60 && s.category === 'food')).toBe(false);
  });
  it('rescueFirstDayMeal: dinner role overlapping [dayStart, tourEnd) kept once per role; breakfast role never rescued', () => {
    const roles = new Set<string>();
    expect(rescueFirstDayMeal({ category: 'food' }, 23 * 60 + 30, false, 19 * 60 + 30, 21 * 60, roles)).toBe(true);
    expect(rescueFirstDayMeal({ category: 'food' }, 23 * 60 + 50, false, 19 * 60 + 30, 21 * 60, roles)).toBe(false);
    expect(rescueFirstDayMeal({ category: 'food' }, 60, true, 19 * 60 + 30, 21 * 60, new Set())).toBe(true); // 01:00 → 25:00 dinner role
    expect(rescueFirstDayMeal({ category: 'food' }, 10 * 60, false, 9 * 60, 21 * 60, new Set())).toBe(false);
    expect(rescueFirstDayMeal({ category: 'culture' }, 23 * 60, false, 19 * 60, 21 * 60, new Set())).toBe(false);
  });
});

describe('pure helpers', () => {
  it('findStitchViolation ordering: meal → midnight → Day1 tour end', () => {
    const places = [{ category: 'lodging' }, { category: 'culture' }, { category: 'food' }, { category: 'lodging' }];
    expect(findStitchViolation(places, { starts: [990, 1170, 1340, 1500], meals: [{ i: 2, infeasible: true, noWindow: false }] }, {})).toMatchObject({ kind: 'meal', index: 2 });
    expect(findStitchViolation(places, { starts: [990, 1170, 1240, 1450], meals: [] }, {})).toMatchObject({ kind: 'midnight', index: 3 });
    expect(findStitchViolation(places, { starts: [990, 1270, 1340, 1430], meals: [] }, { day1TourEndMin: 1260 })).toMatchObject({ kind: 'tour_end', index: 1 });
  });
  it('r2: stitchStartMins Day1 floor = max(floor, lodging time + stay + leg + buffer) (hotel stay kept)', () => {
    const places = [{ category: 'lodging' }, { category: 'culture', stay_min: 60 }];
    expect(stitchStartMins(places, { firstMin: 990, legMins: [20], buffer: 5, floorIdx: 1, floorMin: 1020 }).starts).toEqual([990, 1075]);
    expect(stitchStartMins(places, { firstMin: 900, legMins: [20], buffer: 5, floorIdx: 1, floorMin: 1020 }).starts).toEqual([900, 1020]);
  });
  it('r2: a first non-lodging stop starts at the floor itself (so lowering pref to R really moves it)', () => {
    const places = [{ category: 'culture', start_time: '20:00', stay_min: 60 }];
    expect(stitchStartMins(places, { firstMin: 1200, legMins: [], buffer: 5, floorIdx: 0, floorMin: 1170 }).starts).toEqual([1170]);
  });
});
