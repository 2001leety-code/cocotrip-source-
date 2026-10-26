/**
 * 2026-10-26 첫날 도착 PR1 r2 — Astra astra-mealwin-pr-r1 + 적대적 프로브(probes/mealwin) 보완 회귀.
 *   1 저장 input 의 출국 시각(snake 포함) → 생성→저장→수정 왕복에서 같은 끼니 창
 *   2 mock 1일: 풀데이 지름길은 두 창이 고정 시각을 품을 때만, 창 기반은 건너뛰지 않고 창 안으로 당겨 넣기
 *   3 mock 자정: 당일 표현 불가 = 명시적 실패(시각을 잘라 거꾸로 만들지 않음)
 *   4 worker 재계산(mealWindowsFromCtx)이 camel 키 body 에도 shaped 공항·시각을 쓴다(sync 창과 같음)
 *   5 정책: 두 창 처음부터 모두 null 인 1일 = 0끼 허용 + 보이는 안내(원인 문구 없음); 창 있는 필수 끼니 누락은 여전히 실패
 *   실호출 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_ai_core/qualityMetrics.js', () => ({
  computeQualityScore: () => ({ score: 80, metrics: { dietary_violation: { count: 0 }, unverified_restaurant: { count: 0 }, language_mismatch: { count: 0 }, route_failure: { count: 0 } } }),
}));

import { shapeRequest } from '../../api/_ai_core/requestShaper.js';
import { validatePatternStructure, mealWindowsFromRequest, mealWindowsFromCtx } from '../../api/_ai_core/responseValidator.js';
import { persistPlan } from '../../api/_ai_core/planPersister.js';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';
import { noMealStopsInfo } from '../../src/pages/PlanDetailPage/lib/userPlanNotices';

type Dict = Record<string, unknown>;
type Stop = Record<string, unknown>;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const toMin = (s: unknown) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

describe('1 — generation → persisted input → modify keep the same one-day meal windows', () => {
  const body = { durationDays: 1, regions: ['Seoul'], destination: 'Seoul', arrival_airport: 'ICN_T1', departure_time: '20:00', tourStartTime: '09:00', tourEndTime: '21:00', dietaryRestrictions: [] };
  // Astra repro: 서울·ICN·출국 20:00 — 숙소 09 → 점심 12 → 공항 17
  const plan = { days: [{ day: 1, city: 'Seoul', stops: [
    { category: 'lodging', name: 'Seoul Hotel', address: 'Seoul', start_time: '09:00' },
    { category: 'food', name: 'Lunch Place', address: 'Seoul', start_time: '12:00', stay_min: 60 },
    { category: 'airport', name: 'Incheon International Airport', address: 'Incheon', start_time: '17:00' },
  ] }], arrival_guide: { airport: 'ICN T1' }, departure_guide: { airport: 'ICN T1' } };

  it('the saved input keeps the normalized departure time and the modify validator accepts the same plan', async () => {
    const shaped = shapeRequest(JSON.parse(JSON.stringify(body)), null, false, null);
    const genWindows = mealWindowsFromRequest(shaped);
    expect(genWindows).toEqual({ lunch: { from: '11:00', to: '14:30' }, dinner: null });
    const gen = validatePatternStructure(plan, { regions: shaped.regions, arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport, durationDays: 1, styles: shaped.styles, arrival_rest_day: false, meal_windows: genWindows });
    expect(gen).toEqual([]);

    const writes: Array<{ collection: string; data: Dict }> = [];
    const doc = (collection: string) => () => ({
      set: vi.fn(async (data: Dict) => { writes.push({ collection, data }); }),
      update: vi.fn(async () => {}),
      get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
      collection: () => ({ doc: () => ({ set: vi.fn(async () => {}) }) }),
    });
    const db = { collection: vi.fn((name: string) => ({ doc: doc(name) })) };
    await persistPlan(db as never, {
      body, itinerary: structuredClone(plan), uid: 'u-r2', vehicle: 'sedan', priceKRW: 0, priceUSD: 0, guestName: 'T', pax: 1, styles: [],
      area: shaped.area, duration: 1, startDate: '2099-12-01', email: 't@e.x', specialRequest: '',
      arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport, hotel_address: null, mobility: null, language: 'en', dietary: [], foodIndex: [],
    } as never);
    const saved = writes.find((w) => w.collection === 'plans' && w.data && w.data.input);
    expect(saved).toBeDefined();
    const input = (saved as { data: { input: Dict } }).data.input;
    expect(input.departure_time).toBe('20:00');

    // ai-planner-modify.js 와 같은 요청 모양(저장 input 으로 재계산)
    const modifyWindows = mealWindowsFromRequest({ ...input, durationDays: 1 });
    expect(modifyWindows).toEqual(genWindows);
    const mod = validatePatternStructure(plan, { regions: input.regions, arrival_airport: input.arrival_airport, departure_airport: input.departure_airport, durationDays: 1, arrival_rest_day: false, meal_windows: modifyWindows });
    expect(mod).toEqual([]);
    expect(read('api/ai-planner-modify.js')).toContain('meal_windows: mealWindowsFromRequest({ ...(planData.input || {}), durationDays: itinerary.days.length }),');
  });
});

describe('2 — mock one-day plan follows the windows', () => {
  const run = (u: Dict) => buildMockPlan({ userText: 'X\n' + JSON.stringify({ duration_days: 1, regions: ['seoul'], area: 'seoul', tour_start_time: '09:00', ...u }) }) as { days: Array<{ stops: Stop[] }> };
  const meals = (p: { days: Array<{ stops: Stop[] }> }) => p.days[0].stops.filter((s) => s.category === 'food').map((s) => toMin(s.start_time));

  it('Astra repro: no arrival, 09:00 start, ICN 23:00 departure → dinner window 17:00–17:30, dinner is NOT at the fixed 18:00', () => {
    const w = { lunch: { from: '11:00', to: '16:59' }, dinner: { from: '17:00', to: '17:30' } };
    const plan = run({ meal_windows: w });
    const [lunch, dinner] = meals(plan);
    expect(lunch).toBeGreaterThanOrEqual(toMin('11:00'));
    expect(lunch).toBeLessThanOrEqual(toMin('16:59'));
    expect(dinner).toBeGreaterThanOrEqual(toMin('17:00'));
    expect(dinner).toBeLessThanOrEqual(toMin('17:30'));
  });
  it('the fixed full day is kept when both windows hold 12:00 and 18:00', () => {
    const plan = run({ meal_windows: { lunch: { from: '11:00', to: '16:59' }, dinner: { from: '17:00', to: '20:59' } } });
    expect(meals(plan)).toEqual([toMin('12:00'), toMin('18:00')]);
  });
  it('probeD repro: a narrow lunch window pushes the cursor past dinner.from — dinner is pulled into its window, not dropped (no B-12 / B-MEAL-DINNER)', () => {
    const w = { lunch: { from: '16:49', to: '16:59' }, dinner: { from: '17:00', to: '17:59' } };
    const plan = run({ meal_windows: w, tour_start_time: '16:49' });
    const [lunch, dinner] = meals(plan);
    expect(lunch).toBe(toMin('16:49'));
    expect(dinner).toBeGreaterThanOrEqual(toMin('17:00'));
    expect(dinner).toBeLessThanOrEqual(toMin('17:59'));
    const errs = validatePatternStructure(plan, { regions: ['seoul'], arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', durationDays: 1, arrival_rest_day: false, meal_windows: w });
    expect(errs.filter((e: string) => /B-12|B-MEAL/.test(e))).toEqual([]);
  });
});

describe('3 — mock midnight: a one-day plan that cannot fit before 23:59 fails explicitly', () => {
  it('Astra repro: 22:35 arrival → ready next day 01:35 → MOCK_DAY_OVERFLOW (no 23:59→23:30 reversed lodging)', () => {
    const userText = 'X\n' + JSON.stringify({ duration_days: 1, regions: ['seoul'], area: 'seoul', tour_start_time: '09:00', arrival_time: '22:35', arrival_ready_time: '01:35', meal_windows: { lunch: null, dinner: null } });
    expect(() => buildMockPlan({ userText })).toThrow(expect.objectContaining({ code: 'MOCK_DAY_OVERFLOW' }));
  });
  it('a late start that still fits keeps both lodging stops in order', () => {
    const plan = buildMockPlan({ userText: 'X\n' + JSON.stringify({ duration_days: 1, regions: ['seoul'], area: 'seoul', tour_start_time: '23:00', meal_windows: { lunch: null, dinner: null } }) }) as { days: Array<{ stops: Stop[] }> };
    const times = plan.days[0].stops.map((s) => toMin(s.start_time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('4 — worker recompute uses the shaped airports/times even when the raw body has camel keys', () => {
  it('e2e (c) repro: body departureAirport GMP (camel) vs shaped ICN_T1 → worker window equals the sync window', () => {
    const body = { durationDays: 1, regions: ['Seoul'], destination: 'Seoul', arrival_airport: 'ICN_T1', departureAirport: 'GMP', departureTime: '22:00', tourStartTime: '09:00', tourEndTime: '21:00' };
    const shaped = shapeRequest(JSON.parse(JSON.stringify(body)), null, false, null);
    const sync = mealWindowsFromRequest(shaped);
    const worker = mealWindowsFromCtx({ body, arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport, area: shaped.area, regions: shaped.regions, durationDays: shaped.durationDays });
    expect(worker).toEqual(sync);
  });
  it('ctx times win over raw camel body times', () => {
    const body = { durationDays: 1, regions: ['Seoul'], arrival_airport: 'ICN_T1', departureTime: '23:00', tourStartTime: '09:00' };
    const fromCtx = mealWindowsFromCtx({ body, departureTime: '20:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', regions: ['Seoul'], durationDays: 1 });
    expect(fromCtx).toEqual(mealWindowsFromRequest({ ...body, departureTime: '20:00' }));
  });
});

describe('5 — policy: both windows null from the start = 0 meals allowed + visible notice; a window that exists is still required', () => {
  const plan = (stops: Stop[]) => ({ days: [{ day: 1, city: 'Seoul', stops }], arrival_guide: { airport: 'ICN T1' }, departure_guide: { airport: 'ICN T1' } });
  const lodging = (t: string) => ({ category: 'lodging', name: 'Seoul Hotel', address: 'Seoul', start_time: t });
  const req = (meal_windows: Dict) => ({ regions: ['Seoul'], arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', durationDays: 1, arrival_rest_day: false, meal_windows });
  it('both null → no meal error; a dinner window with no dinner → B-MEAL-DINNER (no silent exemption)', () => {
    const noMeal = plan([lodging('22:00'), lodging('22:30')]);
    expect(validatePatternStructure(noMeal, req({ lunch: null, dinner: null })).filter((e: string) => /B-MEAL|B-12/.test(e))).toEqual([]);
    expect(validatePatternStructure(noMeal, req({ lunch: null, dinner: { from: '21:59', to: '21:59' } })).some((e: string) => /B-MEAL-DINNER/.test(e))).toBe(true);
  });
  it('plan screen: a one-day plan with no meal stop shows the notice, without a cause', () => {
    expect(noMealStopsInfo({ days: [{ stops: [lodging('22:00'), lodging('22:30')] }] }, { arrival_rest_day: true, departure_time: '10:00' })).toEqual({ show: true, lateArrival: false, earlyDeparture: false });
    expect(noMealStopsInfo({ days: [{ stops: [lodging('09:00'), { category: 'food', name: 'A', start_time: '12:00' }] }] }, {})).toMatchObject({ show: false });
  });
});
