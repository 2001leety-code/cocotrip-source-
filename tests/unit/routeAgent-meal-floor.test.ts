/**
 * 2026-10-25 meal floor — RouteAgent Time Stitch 가 food stop 을 원본 시각보다 앞당기지 않는다.
 *
 * 배경: Time Stitch 는 하루 stop 을 `시작 + stay + transit + buffer` 로 순차 재계산해 start_time 을 덮어쓴다.
 *   stop 이 적거나 stay 가 짧은 날은 하루가 압축돼 저녁 18:00 식당이 15:12 로 당겨졌다(주간 시나리오 매트릭스 mock:
 *   Day2/3 [12:00,18:00] → [12:00,15:12]·[11:44,15:00]). 종단 게이트의 필수 끼니(B-MEAL — 중간일 저녁 17–22시)가
 *   그 플랜을 DIETARY_MEAL_COVERAGE_FAILED 로 거부했다. floor 는 당기지 않을 뿐 늦추지 않는다.
 *   실호출 0(순수 함수 + 종단 게이트 + 소스 배선).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMealFloor, parseMealOriginMin } from '../../api/_ai_core/agents/RouteAgent.js';
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';

const hm = (h: number, m = 0) => h * 60 + m;

describe('applyMealFloor (pure)', () => {
  it('a meal pulled earlier than its original time is lifted back (15:12 → 18:00)', () => {
    expect(applyMealFloor(hm(15, 12), hm(18))).toBe(hm(18));
  });
  it('never delays: a stitched time later than the original stays (19:00 stays 19:00)', () => {
    expect(applyMealFloor(hm(19), hm(18))).toBe(hm(19));
    expect(applyMealFloor(hm(18), hm(18))).toBe(hm(18));
  });
  it('no original time (NaN) or an after-midnight original (≥ 1440) → current unchanged', () => {
    expect(applyMealFloor(hm(15, 12), NaN)).toBe(hm(15, 12));
    expect(applyMealFloor(hm(15, 12), 24 * 60)).toBe(hm(15, 12));
    expect(applyMealFloor(hm(15, 12), 25 * 60)).toBe(hm(15, 12));
  });
});

describe('parseMealOriginMin (pure) — strict HH:MM on food stops only', () => {
  it.each([
    [{ category: 'food', start_time: '18:00' }, 1080],
    [{ category: 'food', start_time: '7:05' }, 425],
    [{ category: 'Food', start_time: ' 12:30 ' }, 750],
  ])('%j → %i', (place, expected) => {
    expect(parseMealOriginMin(place)).toBe(expected);
  });
  it.each([
    [{ category: 'food' }],
    [{ category: 'food', start_time: '18:00:00' }],
    [{ category: 'food', start_time: '6pm' }],
    [{ category: 'food', start_time: '25:00' }],
    [{ category: 'food', start_time: '18:60' }],
    [{ category: 'culture', start_time: '18:00' }],
    [null],
  ])('%j → NaN', (place) => {
    expect(Number.isNaN(parseMealOriginMin(place as never))).toBe(true);
  });
});

describe('RouteAgent wiring (source)', () => {
  const src = readFileSync(resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
  it('food-only original times are captured next to the P150 Gemini times', () => {
    expect(src).toMatch(/const _mealOriginMins = places\.map\(\(p\) => parseMealOriginMin\(p\)\);/);
    expect(src.indexOf('const _mealOriginMins')).toBeGreaterThan(src.indexOf('const _p150GeminiTimes'));
  });
  it('the floor runs after the stay+transit+buffer step and the P239 floor, before the P150 wrap fallback', () => {
    const step = src.indexOf('currentTime += prevStayMin + realTransitMin + BUFFER_MIN;');
    const p239 = src.indexOf('currentTime = dayPlan._p239TourStartMin;', step);
    const floor = src.indexOf('applyMealFloor(currentTime, _mealOriginMins[i])', step);
    const wrap = src.indexOf('P150 (2026-05-22): 24h wrap', step);
    expect(step).toBeGreaterThan(-1);
    expect(p239).toBeGreaterThan(step);
    expect(floor).toBeGreaterThan(p239);
    expect(wrap).toBeGreaterThan(floor);
  });
});

describe('why the floor is needed — the final gate (B-MEAL) on a 3-day Halal plan', () => {
  const row = (name: string, n: number) => ({
    name, nameEn: `${name} EN`, city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly',
    address: `서울특별시 중구 ${n}`, lat: 37.56 + n / 1000, lng: 126.98,
  });
  const foodIndex = ['합성할랄1', '합성할랄2', '합성할랄3', '합성할랄4'].map((n, i) => row(n, i + 1));
  const food = (name: string, start_time: string) => ({ category: 'food', name, start_time, stay_min: 60, verified: true });
  const plan = (day2Dinner: string) => ({ days: [
    { day: 1, city: 'seoul', stops: [
      { category: 'lodging', name: 'Hotel', start_time: '15:00' }, { category: 'culture', name: 'Spot A', start_time: '16:00' },
      food('합성할랄1', '18:00'), { category: 'lodging', name: 'Hotel', start_time: '20:00' },
    ] },
    { day: 2, city: 'seoul', stops: [
      { category: 'lodging', name: 'Hotel', start_time: '09:00' }, { category: 'culture', name: 'Spot B', start_time: '10:00' },
      food('합성할랄2', '12:00'), { category: 'culture', name: 'Spot C', start_time: '14:00' },
      food('합성할랄3', day2Dinner), { category: 'lodging', name: 'Hotel', start_time: '20:30' },
    ] },
    { day: 3, city: 'seoul', stops: [
      { category: 'lodging', name: 'Hotel', start_time: '07:00' }, food('합성할랄4', '08:00'),
      { category: 'airport', name: 'Incheon International Airport', start_time: '10:00' },
    ] },
  ] });
  const tripTimes = { arrival_time: '13:00', departure_time: '13:00' };

  it('dinner kept at 18:00 (floor applied) → the final gate passes', () => {
    expect(runFinalItineraryValidation(plan('18:00'), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes })).toMatchObject({ ok: true, code: null });
  });
  it('the same plan with dinner pulled to 15:12 (no floor) → DIETARY_MEAL_COVERAGE_FAILED with B-MEAL-DINNER', () => {
    const r = runFinalItineraryValidation(plan('15:12'), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DIETARY_MEAL_COVERAGE_FAILED');
    expect(r.requiredMealIssues.some((m: string) => m.includes('B-MEAL-DINNER'))).toBe(true);
  });
});
