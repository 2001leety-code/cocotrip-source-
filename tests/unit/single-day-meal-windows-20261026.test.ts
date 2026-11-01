/**
 * 2026-10-26 첫날 도착 PR1 — 1일 여행 공통 끼니 창(meal_windows). Astra 설계 PR1 + 구현 지도 회귀 행렬.
 *   계산(constants.singleDayMealWindows) → 검증기는 넘겨받은 meal_windows 만 사용(원시 시각 직접 계산 금지)
 *   → 생성 body·프롬프트·게이트·수정 API·worker·mock 이 같은 값. 이번 PR 은 기준을 풀기만(새 거절 0).
 *   실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { singleDayMealWindows, departureActivityDeadlineMin, AIRPORT_ARRIVE_BEFORE_MIN, estimateAirportTransitMinFrom } from '../../api/_ai_core/constants.js';
import { validatePatternStructure, checkRequiredMeals, mealWindowsFromRequest, mealWindowsFromCtx } from '../../api/_ai_core/responseValidator.js';
import { tripTimesFrom, runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';

type Stop = Record<string, unknown>;
type Win = { from: string; to: string } | null;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const base = { durationDays: 1, arrivalAirport: 'ICN_T1', cityKey: 'seoul', tourStartTime: '09:00' };
const W = (lunch: Win, dinner: Win) => ({ lunch, dinner });
const r = (from: string, to: string) => ({ from, to });

describe('singleDayMealWindows — regression matrix (ICN_T1, seoul, tour start 09:00)', () => {
  it.each([
    ['1 no arrival, end 21:00', { tourEndTime: '21:00' }, W(r('11:00', '16:59'), r('17:00', '20:59'))],
    ['2 13:59 (ready 16:59), end 21:00', { arrivalTime: '13:59', tourEndTime: '21:00' }, W(r('16:59', '16:59'), r('17:00', '20:59'))],
    ['3 14:00 (ready 17:00), end 21:00', { arrivalTime: '14:00', tourEndTime: '21:00' }, W(null, r('17:00', '20:59'))],
    ['4a 18:59 (ready 21:59), end 22:00', { arrivalTime: '18:59', tourEndTime: '22:00' }, W(null, r('21:59', '21:59'))],
    ['4b 18:59 (ready 21:59), end 23:59', { arrivalTime: '18:59', tourEndTime: '23:59' }, W(null, r('21:59', '21:59'))],
    ['5 19:00 (ready 22:00), end 23:59', { arrivalTime: '19:00', tourEndTime: '23:59' }, W(null, null)],
    ['6 22:35 (ready next day 01:35, absolute 1535)', { arrivalTime: '22:35', tourEndTime: '23:59' }, W(null, null)],
    ['7 08:00 arrival, departure 20:00 (deadline 15:30)', { arrivalTime: '08:00', departureTime: '20:00' }, W(r('11:00', '14:30'), null)],
    ['8 08:00 arrival, departure 23:00', { arrivalTime: '08:00', departureTime: '23:00' }, W(r('11:00', '16:59'), r('17:00', '17:30'))],
    ['9 08:00 arrival, departure 16:00', { arrivalTime: '08:00', departureTime: '16:00' }, W(null, null)],
    ['10 ready 17:00, end 17:00', { arrivalTime: '14:00', tourEndTime: '17:00' }, W(null, null)],
  ])('%s', (_label, extra, want) => {
    expect(singleDayMealWindows({ ...base, ...extra })).toEqual(want);
  });
  it('11 numeric / object tourStartTime → default 09:00, no throw', () => {
    const row1 = W(r('11:00', '16:59'), r('17:00', '20:59'));
    expect(singleDayMealWindows({ ...base, tourStartTime: 900 as unknown as string, tourEndTime: '21:00' })).toEqual(row1);
    expect(singleDayMealWindows({ ...base, tourStartTime: {} as unknown as string, tourEndTime: '21:00' })).toEqual(row1);
  });
  it('12 multi-day → null', () => {
    expect(singleDayMealWindows({ ...base, durationDays: 2, arrivalTime: '14:00' })).toBeNull();
    expect(singleDayMealWindows({ ...base, durationDays: undefined as unknown as number })).toBeNull();
  });
  it('departureActivityDeadlineMin is the blockMode formula (shared)', () => {
    expect(departureActivityDeadlineMin(20 * 60, 'ICN_T1', 'seoul')).toBe(20 * 60 - AIRPORT_ARRIVE_BEFORE_MIN - estimateAirportTransitMinFrom('seoul', 'ICN_T1'));
    expect(read('api/_ai_core/blockMode.js')).toContain('const activityDeadlineMin = departureActivityDeadlineMin(depMin, departureAirport, cityKey);');
  });
  it('mealWindowsFromRequest: camel and snake inputs agree; city from the request key', () => {
    const camel = mealWindowsFromRequest({ durationDays: 1, arrivalTime: '14:00', arrival_airport: 'ICN_T1', regions: ['서울'], tourStartTime: '09:00', tourEndTime: '21:00' });
    const snake = mealWindowsFromRequest({ duration_days: 1, arrival_time: '14:00', arrival_airport: 'ICN_T1', regions: ['Seoul'], tour_start_time: '09:00', tour_end_time: '21:00' });
    expect(camel).toEqual(W(null, r('17:00', '20:59')));
    expect(snake).toEqual(camel);
    expect(mealWindowsFromRequest({ durationDays: 3, arrivalTime: '14:00' })).toBeNull();
  });
});

describe('validator — uses only the passed meal_windows (durationDays 1)', () => {
  const lodging = (t: string): Stop => ({ category: 'lodging', name: 'Hotel', start_time: t });
  const food = (t: string): Stop => ({ category: 'food', name: 'Dinner place', start_time: t, stay_min: 60 });
  const sight = (t: string): Stop => ({ category: 'culture', name: 'Palace', start_time: t });
  const one = (stops: Stop[]) => ({ days: [{ day: 1, city: 'seoul', stops }], departure_guide: { airport: 'ICN_T1' } });
  const req = (mw?: unknown) => ({ durationDays: 1, regions: ['seoul'], ...(mw !== undefined ? { meal_windows: mw } : {}) });
  const w3 = W(null, r('17:00', '20:59'));
  const meal = (errs: string[]) => errs.filter((e) => /B-MEAL|B-12/.test(e));

  it('A row-3 window + [lodging 17:00, food 18:00, lodging 20:00] → []', () => {
    expect(validatePatternStructure(one([lodging('17:00'), food('18:00'), lodging('20:00')]), req(w3))).toEqual([]);
  });
  it('B row-3 window + [lodging, sight 17:30, lodging] → only B-MEAL-DINNER (with the start range)', () => {
    const errs = meal(validatePatternStructure(one([lodging('17:00'), sight('17:30'), lodging('20:00')]), req(w3)));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/17:00-20:59 시작.*\(B-MEAL-DINNER\)/);
  });
  it('C both null + [lodging, lodging] → no errors', () => {
    expect(validatePatternStructure(one([lodging('22:00'), lodging('22:30')]), req(W(null, null)))).toEqual([]);
  });
  it('D both null + [lodging] → B-12 (< 2)', () => {
    expect(validatePatternStructure(one([lodging('22:00')]), req(W(null, null))).some((e) => /< 2 minimum \(B-12\)/.test(e))).toBe(true);
  });
  it('E both meals + 3 stops → B-12 (< 4), same as today', () => {
    const both = W(r('11:00', '16:59'), r('17:00', '20:59'));
    expect(validatePatternStructure(one([lodging('09:00'), food('12:00'), lodging('20:00')]), req(both)).some((e) => /< 4 minimum \(B-12\)/.test(e))).toBe(true);
  });
  it('F meal_windows only (no raw times), food at 08:00 → no B-LATE-ARRIVAL / B-EARLY-DEPARTURE', () => {
    const errs = validatePatternStructure(one([lodging('07:00'), food('08:00'), lodging('20:00')]), req(w3));
    expect(errs.filter((e) => /B-LATE-ARRIVAL|B-EARLY-DEPARTURE/.test(e))).toEqual([]);
  });
  it('G multi-day plan: meal_windows is ignored', () => {
    const two = { days: [{ day: 1, city: 'seoul', stops: [lodging('17:00'), sight('17:30'), lodging('20:00')] }, { day: 2, city: 'seoul', stops: [lodging('09:00'), sight('10:00'), lodging('11:00')] }] };
    expect(validatePatternStructure(two, { durationDays: 2, regions: ['seoul'], meal_windows: w3 })).toEqual(validatePatternStructure(two, { durationDays: 2, regions: ['seoul'] }));
  });
  it('H only relaxes: B-MEAL / B-12 errors with meal_windows ⊆ errors without', () => {
    const plans = [
      [lodging('17:00'), sight('17:30'), lodging('20:00')],
      [lodging('22:00'), lodging('22:30')],
      [lodging('09:00'), food('12:00'), lodging('20:00')],
      [lodging('09:00'), sight('10:00'), food('13:00'), sight('15:00'), food('18:30'), lodging('20:00')],
      [lodging('22:00')],
    ];
    const windows = [w3, W(null, null), W(r('11:00', '16:59'), r('17:00', '20:59')), W(r('16:59', '16:59'), null)];
    for (const stops of plans) {
      const without = new Set(meal(validatePatternStructure(one(stops), req())).map((e) => String(e).replace(/\(.*?\)/g, '').split(':')[0] + (/\(B-\w+(-\w+)?\)/.exec(e) || [''])[0]));
      for (const mw of windows) {
        for (const e of meal(validatePatternStructure(one(stops), req(mw)))) {
          const key = String(e).replace(/\(.*?\)/g, '').split(':')[0] + (/\(B-\w+(-\w+)?\)/.exec(e) || [''])[0];
          expect(without.has(key), `${JSON.stringify(stops)} ${JSON.stringify(mw)} → ${e}`).toBe(true);
        }
      }
    }
  });
  it('legacy single-day request without meal_windows keeps today\'s rules (min 4, lunch + dinner required)', () => {
    const errs = validatePatternStructure(one([lodging('17:00'), food('18:00'), lodging('20:00')]), req());
    expect(errs.some((e) => /\(B-MEAL-LUNCH\)/.test(e))).toBe(true);
    expect(errs.some((e) => /< 4 minimum \(B-12\)/.test(e))).toBe(true);
  });
});

describe('wiring', () => {
  const lodging = (t: string): Stop => ({ category: 'lodging', name: 'Hotel', start_time: t });
  const planB = { days: [{ day: 1, city: 'seoul', stops: [lodging('17:00'), { category: 'culture', name: 'Palace', start_time: '17:30' }, lodging('20:00')] }] };
  it('I checkRequiredMeals keeps meal_windows from tripTimesFrom; non-object values are dropped', () => {
    const w3 = W(null, r('17:00', '20:59'));
    const issues = checkRequiredMeals(planB, tripTimesFrom({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', area: 'seoul', meal_windows: w3 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/\(B-MEAL-DINNER\)/);
    expect(tripTimesFrom({ meal_windows: 'x' })).not.toHaveProperty('meal_windows');
    expect(tripTimesFrom({ meal_windows: null })).not.toHaveProperty('meal_windows');
  });
  it('J generation body carries meal_windows only (no raw times); modify / pipeline / worker / pass3 / user message carry it', () => {
    const core = read('api/_ai_core/handlerCore.js');
    const body = /body: \{([\s\S]*?)\n {6}\},/.exec(core.slice(core.indexOf('runGeminiPipeline')))?.[1] || '';
    expect(body).toContain('meal_windows: mealWindows,');
    expect(body).not.toMatch(/arrival_time|departure_time|tour_start_time/);
    expect(core).toContain('const mealWindows = mealWindowsFromRequest(shaped);');
    expect(core).toMatch(/buildUserMessage\(\{[^}]*mealWindows, arrivalRestDay \}\)/);
    expect(core).toMatch(/triggerPass3BackgroundIfPending\(\{[^\n]*styles, mealWindows, tripTimes: tripTimesFrom\(/);
    expect(read('api/_ai_core/backgroundPipelines.js')).toContain('{ ...tripTimesIn, meal_windows: mealWindows }');
    expect(read('api/ai-planner-modify.js')).toContain('meal_windows: mealWindowsFromRequest({ ...(planData.input || {}), durationDays: itinerary.days.length }),');
    expect(read('api/_ai_core/postResponsePipeline.js')).toContain('meal_windows: mealWindowsFromCtx(ctx),');
    const worker = read('api/_inngest/functions/processPlanAfterAI.js');
    expect(worker).toContain('const mealWindows = mealWindowsFromCtx(ctx);');
    expect(worker).toContain('meal_windows: mealWindows,');
    expect(read('api/_ai_core/userMessageBuilder.js')).toContain('meal_windows: (mealWindows !== undefined ? mealWindows : mealWindowsFromRequest(shaped)) || undefined,');
  });
  it('mealWindowsFromCtx: sync value (incl. null) wins; worker recomputes from body + shaped fields', () => {
    expect(mealWindowsFromCtx({ mealWindows: null, body: { durationDays: 1 } })).toBeNull();
    expect(mealWindowsFromCtx({ durationDays: 1, arrival_airport: 'ICN_T1', regions: ['seoul'], body: { arrivalTime: '14:00', tourEndTime: '21:00' } }))
      .toEqual(W(null, r('17:00', '20:59')));
  });
  it('prompt carries the 1-day rule and stays under the 44,000-char cap (p194)', () => {
    const bp = read('api/_ai_core/buildPrompt.js');
    expect(bp).toContain('userInput.meal_windows');
    expect(bp).toContain('1-day trip: follow userInput.meal_windows (precomputed — do NOT compute)');
    expect(read('api/_ai_core/geminiPipeline.js')).toContain('A 1-day trip follows userInput.meal_windows instead');
  });
});

describe('K mock follows meal_windows; generation-shaped and gate-shaped checks pass', () => {
  const w3 = W(null, r('17:00', '20:59'));
  const userText = 'X\n' + JSON.stringify({
    duration_days: 1, regions: ['seoul'], area: 'seoul', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1',
    arrival_time: '14:00', arrival_ready_time: '17:00', tour_start_time: '09:00', tour_end_time: '21:00',
    diet_preferences: ['Vegetarian'], meal_windows: w3,
  });
  const toMin = (t: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : -1; };
  it('Day 1 = [lodging ≥ 17:00, food within 17:00–20:59, lodging]', () => {
    const plan = buildMockPlan({ userText }) as { days: Array<{ stops: Stop[] }> };
    const stops = plan.days[0].stops;
    expect(stops[0].category).toBe('lodging');
    expect(toMin(stops[0].start_time)).toBeGreaterThanOrEqual(17 * 60);
    const foods = stops.filter((s) => s.category === 'food');
    expect(foods).toHaveLength(1);
    expect(toMin(foods[0].start_time)).toBeGreaterThanOrEqual(17 * 60);
    expect(toMin(foods[0].start_time)).toBeLessThanOrEqual(20 * 60 + 59);
    expect(stops[stops.length - 1].category).toBe('lodging');
  });
  it('passes validatePatternStructure with raw times + meal_windows, and the final gate (Vegetarian, tripTimes)', () => {
    const plan = buildMockPlan({ userText }) as { days: Array<{ stops: Stop[] }> };
    const healthBody = { durationDays: 1, regions: ['seoul'], area: 'seoul', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', arrival_time: '14:00', tour_start_time: '09:00', tour_end_time: '21:00' };
    expect(validatePatternStructure(plan, { ...healthBody, meal_windows: w3 }).filter((e) => /B-MEAL|B-12/.test(e))).toEqual([]);
    const foodIndex = JSON.parse(read('api/_food_index.json'));
    const g = runFinalItineraryValidation(plan, { dietary: ['Vegetarian'], language: 'en', foodIndex, tripTimes: tripTimesFrom({ ...healthBody, meal_windows: w3 }) });
    expect(g.requiredMealIssues).toEqual([]);
    expect(g.ok).toBe(true);
  });
  it('without meal_windows the mock keeps the legacy single-day shape', () => {
    const legacy = buildMockPlan({ userText: 'X\n' + JSON.stringify({ duration_days: 1, regions: ['seoul'], area: 'seoul', tour_start_time: '09:00' }) }) as { days: Array<{ stops: Stop[] }> };
    expect(legacy.days[0].stops.filter((s) => s.category === 'food').length).toBe(2);
  });
});
