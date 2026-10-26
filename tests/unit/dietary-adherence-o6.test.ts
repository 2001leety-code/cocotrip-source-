/**
 * 2026-10-24 — 식이 준수 보강(Astra dietary-adherence r1, P1·P3·P4). 실호출 0.
 *   P1: 식사 도시 집합 하나로 사전 검사·목록 주입 / 목록이 비면 모델 호출 전 422 / 프롬프트 식이 최우선·체인 예외 조건화
 *   P3: 필수 끼니(B-MEAL) 판정을 종단 게이트에서도 — 활동 3개 미만 면제로 빠지던 출국일 조식 누락 차단
 *   P4: 비교 하네스 시나리오·안전 집계
 * P2(쉼표 앞 별칭)는 tests/unit/dietary-selected-meal-evidence.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));

import { mealCitiesForTrip, buildTripFoodContext, enforceDietaryCoverage, hasSafetyDiet, canonicalDietPrefs } from '../../api/_ai_core/dietaryCoverageGate.js';
import { getFoodContext } from '../../api/_food_helper.js';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';
import { findSelectedFoodRow } from '../../api/_shared/food-name-match.js';
import { buildSystemPrompt } from '../../api/_ai_core/buildPrompt.js';
import { buildDietarySafetyBlock } from '../../api/_ai_core/userMessageBuilder.js';
import { checkRequiredMeals } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation, buildFinalGateError, tripTimesFrom, failureDetailsOf, FINAL_GATE_MEAL_CODE, FINAL_GATE_DIETARY_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { summarizeSafety, formatOutcome, evaluateCompareRun, foodNameCompliance } from '../../scripts/integration/llm-compare-outcome.mjs';
import { SCENARIOS } from '../../scripts/integration/llm-compare-free.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('P1 — meal cities: one set for coverage gate and list injection', () => {
  it('single city, multi-city, explicit entry/exit cities; an arrival airport alone adds nothing', () => {
    expect(mealCitiesForTrip({ regions: ['busan'], area: 'busan' })).toEqual(['busan']);
    expect(mealCitiesForTrip({ regions: [], area: 'jeju' })).toEqual(['jeju']);
    expect(mealCitiesForTrip({ regions: ['seoul', 'busan'], area: 'seoul' })).toEqual(['seoul', 'busan']);
    // ICN 도착(공항)은 식사 도시가 아니다 — arrivalCity 가 명시될 때만 추가
    expect(mealCitiesForTrip({ regions: ['busan'], area: 'busan', arrivalCity: '', departureCity: '' })).toEqual(['busan']);
    expect(mealCitiesForTrip({ regions: ['busan'], area: 'busan', arrivalCity: 'seoul' })).toEqual(['busan', 'seoul']);
    expect(mealCitiesForTrip({ regions: ['seoul', 'busan'], area: 'seoul', arrivalCity: 'seoul', departureCity: 'busan' })).toEqual(['seoul', 'busan']);
  });

  it('Vegetarian is a safety diet like Halal/Vegan', () => {
    expect(hasSafetyDiet(['Vegetarian'])).toBe(true);
    expect(hasSafetyDiet(['Meat', 'Seafood'])).toBe(false);
  });

  it('dietary request: one list per meal city, joined', () => {
    const getContext = vi.fn((city: string) => `[LIST ${city}]`);
    expect(buildTripFoodContext({ cities: ['seoul', 'busan'], area: 'seoul', dietaryAll: ['Halal'], priceRange: 'Any', maxItems: 12, getContext }))
      .toBe('[LIST seoul][LIST busan]');
    expect(getContext.mock.calls.map((c) => c[0])).toEqual(['seoul', 'busan']);
    expect(getContext.mock.calls[0].slice(1)).toEqual([['Halal'], 'Any', 12]);
  });

  it.each([
    ['an empty list for one city', (city: string) => (city === 'seoul' ? '' : `[LIST ${city}]`)],
    ['a list builder that throws', (city: string) => { if (city === 'seoul') throw new Error('boom'); return `[LIST ${city}]`; }],
  ])('dietary request with %s → DIETARY_COVERAGE_UNAVAILABLE before any model call', (_label, impl) => {
    const callModel = vi.fn();
    const run = () => {
      buildTripFoodContext({ cities: ['busan', 'seoul'], area: 'busan', dietaryAll: ['Vegetarian'], priceRange: 'Any', maxItems: 10, getContext: vi.fn(impl) });
      callModel();
    };
    expect(run).toThrowError(expect.objectContaining({ code: 'DIETARY_COVERAGE_UNAVAILABLE', statusCode: 422, details: 'seoul:vegetarian' }));
    expect(callModel).not.toHaveBeenCalled();
  });

  it('non-dietary request keeps the old single-city injection (area), and a builder error is just an empty list', () => {
    const getContext = vi.fn(() => '[GENERAL]');
    expect(buildTripFoodContext({ cities: ['seoul', 'busan'], area: 'seoul', dietaryAll: ['Meat'], priceRange: 'Any', maxItems: 10, getContext })).toBe('[GENERAL]');
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0][0]).toBe('seoul');
    expect(buildTripFoodContext({ cities: ['seoul'], area: 'seoul', dietaryAll: [], priceRange: 'Any', maxItems: 10, getContext: () => { throw new Error('x'); } })).toBe('');
  });

  it('coverage gate uses the same set: an explicit arrival city without trusted rows fails closed', () => {
    const busanHalal = { name: 'B', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', address: '부산광역시 해운대구 1' };
    expect(() => enforceDietaryCoverage({ foodIndex: [busanHalal], regions: ['busan'], area: 'busan', dietaryAll: ['Halal'] })).not.toThrow();
    expect(() => enforceDietaryCoverage({ foodIndex: [busanHalal], regions: ['busan'], area: 'busan', dietaryAll: ['Halal'], arrivalCity: 'seoul' }))
      .toThrowError(expect.objectContaining({ code: 'DIETARY_COVERAGE_UNAVAILABLE', details: 'seoul:halal' }));
  });

  it('handlerCore: the same mealCities feed the gate and the list, both before any model call', () => {
    const src = read('api/_ai_core/handlerCore.js');
    const citiesAt = src.indexOf('const mealCities = mealCitiesForTrip({ regions, area, arrivalCity, departureCity })');
    const gateAt = src.indexOf('enforceDietaryCoverage({ foodIndex: await loadFoodIndex(), regions, area, dietaryAll, arrivalCity, departureCity })');
    const listAt = src.indexOf('buildTripFoodContext({');
    expect(citiesAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(citiesAt);
    expect(listAt).toBeGreaterThan(gateAt);
    for (const call of ['tryRunBlockMode({', 'runGeminiPipeline({']) expect(listAt, call).toBeLessThan(src.indexOf(call));
    expect(src).not.toMatch(/getFoodContext\(area,/);
  });
});

// ── r1 (Astra dietary-code r1) ─────────────────────────────────────────────
describe('r1 — coverage = intersection of all requested diets, real city keys, normalized diet values', () => {
  const row = (over: object) => ({ name: 'R', city: 'seoul', address: '서울특별시 종로구 1', ...over });
  const seoulHalal = row({ name: 'H', tag: 'halal', verification_status: 'muslim_friendly' });
  const seoulVegan = row({ name: 'V', tag: 'vegan', verification_status: 'vegan_restaurant' });

  it('Halal+Vegan: one halal row and one vegan row are not enough — a single row must satisfy both', () => {
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulHalal, seoulVegan], regions: ['seoul'], area: 'seoul', dietaryAll: ['Halal'] })).not.toThrow();
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulHalal, seoulVegan], regions: ['seoul'], area: 'seoul', dietaryAll: ['Halal', 'Vegan'] }))
      .toThrowError(expect.objectContaining({ code: 'DIETARY_COVERAGE_UNAVAILABLE', details: 'seoul:halal+vegan' }));
    // vegan 행은 vegetarian 도 충족(SSOT acceptTagsForDiet) — 교집합 통과
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulVegan], regions: ['seoul'], area: 'seoul', dietaryAll: ['Vegan', 'Vegetarian'] })).not.toThrow();
  });

  it('lowercase diet values are the same request (gate and list)', () => {
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulVegan], regions: ['seoul'], area: 'seoul', dietaryAll: ['halal'] }))
      .toThrowError(expect.objectContaining({ details: 'seoul:halal' }));
    expect(canonicalDietPrefs(['halal', 'VEGAN', 'Meat'])).toEqual(['Halal', 'Vegan', 'Meat']);
    const getContext = vi.fn(() => '[LIST]');
    buildTripFoodContext({ cities: ['seoul'], area: 'seoul', dietaryAll: ['halal'], priceRange: 'Any', maxItems: 10, getContext });
    expect(getContext.mock.calls[0][1]).toEqual(['Halal']);
  });

  it('getFoodContext itself normalizes: lowercase "halal" on the real index lists only [HALAL] rows (never the general list)', () => {
    const ctx = getFoodContext('seoul', ['halal'], 'Any', 10);
    const lines = ctx.split('\n').filter((l) => l.trim().startsWith('•'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toContain('[HALAL]');
  });

  it('incheon / suwon / unknown cities keep their own key (never Seoul) and are blocked when they have no trusted list', () => {
    expect(mealCitiesForTrip({ regions: ['busan'], area: 'busan', arrivalCity: 'incheon' })).toEqual(['busan', 'incheon']);
    expect(mealCitiesForTrip({ regions: ['수원'], area: '수원' })).toEqual(['suwon']);
    expect(mealCitiesForTrip({ regions: ['seoul', 'gangneung', 'atlantis'], area: 'seoul' })).toEqual(['seoul', 'gangneung', 'atlantis']);
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulHalal], regions: ['incheon'], area: 'incheon', dietaryAll: ['Halal'] }))
      .toThrowError(expect.objectContaining({ details: 'incheon:halal' }));
    // 목록 주입: 목록 함수가 다른 도시(서울)로 resolve 할 도시는 호출조차 하지 않고 차단
    const getContext = vi.fn((city: string) => `[LIST ${city}]`);
    expect(() => buildTripFoodContext({ cities: ['busan', 'incheon'], area: 'busan', dietaryAll: ['Halal'], priceRange: 'Any', maxItems: 10, getContext }))
      .toThrowError(expect.objectContaining({ details: 'incheon:halal' }));
    expect(getContext.mock.calls.map((c) => c[0])).toEqual(['busan']);
  });
});

// ── r2 ─────────────────────────────────────────────────────────────────────
describe('r2 — localized city names resolve through the UI city SSOT; cities without their own list are blocked', () => {
  const seoulHalal = { name: 'H', city: 'seoul', address: '서울특별시 종로구 1', tag: 'halal', verification_status: 'muslim_friendly' };
  const incheonHalal = { name: 'I', city: 'incheon', address: '인천광역시 중구 1', tag: 'halal', verification_status: 'muslim_friendly' };

  it.each(['ソウル', '首尔', '首爾', '서울', 'Seoul ', 'SEOUL'])('%s → seoul, and the Seoul trusted row satisfies the gate', (name) => {
    expect(mealCitiesForTrip({ regions: [name], area: name })).toEqual(['seoul']);
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulHalal], regions: [name], area: name, dietaryAll: ['Halal'] })).not.toThrow();
  });

  it.each(['인천', 'incheon', 'インチョン'])('%s → incheon is blocked even with an incheon trusted row (its list would be Seoul\'s)', (name) => {
    expect(mealCitiesForTrip({ regions: [name], area: name })).toEqual(['incheon']);
    expect(() => enforceDietaryCoverage({ foodIndex: [seoulHalal, incheonHalal], regions: [name], area: name, dietaryAll: ['Halal'] }))
      .toThrowError(expect.objectContaining({ code: 'DIETARY_COVERAGE_UNAVAILABLE', details: 'incheon:halal' }));
  });

  it('non-dietary requests are untouched (no gate, single-city list by area)', () => {
    expect(() => enforceDietaryCoverage({ foodIndex: [], regions: ['ソウル'], area: 'ソウル', dietaryAll: ['Meat'] })).not.toThrow();
    const getContext = vi.fn(() => '[GENERAL]');
    expect(buildTripFoodContext({ cities: mealCitiesForTrip({ regions: ['ソウル'], area: 'ソウル' }), area: 'ソウル', dietaryAll: [], priceRange: 'Any', maxItems: 10, getContext })).toBe('[GENERAL]');
    expect(getContext.mock.calls[0][0]).toBe('ソウル');
  });
});

describe('r3 — legacy region keys with a "_" suffix (seoul_city — requestShaper default area)', () => {
  it.each([
    ['seoul_city', 'seoul'], ['SEOUL_CITY', 'seoul'], ['busan_haeundae', 'busan'], ['jeju_island', 'jeju'], ['ソウル_x', 'seoul'], ['incheon_songdo', 'incheon'],
  ])('%s → %s', (token, key) => {
    expect(mealCitiesForTrip({ regions: [token], area: token })).toEqual([key]);
  });

  it('one path: shapeRequest without regions (area seoul_city) → gate passes → the Seoul trusted list is injected', () => {
    const shaped = shapeRequest({ dietPrefs: ['Halal'], email: 'x@example.com' }, 'x@example.com', false, null);
    expect(shaped.area).toBe('seoul_city');
    const cities = mealCitiesForTrip({ regions: shaped.regions, area: shaped.area, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
    expect(cities).toEqual(['seoul']);
    const foodIndex = JSON.parse(read('api/_food_index.json'));
    expect(() => enforceDietaryCoverage({ foodIndex, regions: shaped.regions, area: shaped.area, dietaryAll: ['Halal'], arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity })).not.toThrow();
    const ctx = buildTripFoodContext({ cities, area: shaped.area, dietaryAll: ['Halal'], priceRange: 'Any', maxItems: 10 });
    expect(ctx).toMatch(/Restaurants in Seoul/);
    expect((ctx.match(/\[HALAL\]/g) || []).length).toBeGreaterThan(0);
  });
});

describe('r2 — worker failure details survive Inngest error serialization (cause.details)', () => {
  // inngest/helpers/errors.js copiedErrorProperties: name / message / stack / code / cause 만 보존 — 그대로 흉내.
  const inngestRoundTrip = (e: Error & Record<string, unknown>) => {
    const copy = Object.assign(new Error(e.message), { name: e.name, stack: e.stack, code: e.code, cause: JSON.parse(JSON.stringify(e.cause)) });
    return copy as Error & Record<string, unknown>;
  };
  it('a final-gate meal error keeps its day/meal/reason through the round trip', () => {
    const issue = 'Day 2 (출국일): departure_time=10:00 이른 출국 — 조식(06-10시) 누락 (B-MEAL, P137)';
    const err = buildFinalGateError({ code: FINAL_GATE_MEAL_CODE, zeroFoodDays: [], requiredMealIssues: [issue], violations: [] }, ['Vegan'], 'post_response') as Error & Record<string, unknown>;
    const after = inngestRoundTrip(err);
    expect(after.details).toBeUndefined(); // details 자체는 직렬화에서 사라진다
    expect(failureDetailsOf(after)).toEqual([issue]);
    expect(after.code).toBe(FINAL_GATE_MEAL_CODE);
    expect(after.message).toBe(err.message); // message 그대로
  });
  it('a direct details field still wins; malformed cause is ignored', () => {
    expect(failureDetailsOf({ details: ['a'], cause: { details: ['b'] } })).toEqual(['a']);
    expect(failureDetailsOf({ cause: 'text' })).toBeUndefined();
    expect(failureDetailsOf({ cause: { details: [{}, 3] } })).toBeUndefined();
  });
  it('the worker onFailure writes failureDetailsOf(error) (not error.details) into the plan doc', () => {
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/failureDetailsOf\(error\) \? \{ _streaming_error_details: failureDetailsOf\(error\) \}/);
  });
});

describe('r1 — compare tally: exact means stop.name equals the listed identity name', () => {
  const row = { name: '무채색, 홍대 연남동 맛집 & 술집', nameEn: 'Muchaesaek', city: 'seoul', tag: 'vegan', verification_status: 'vegan_restaurant', lat: 37.5, lng: 126.9 };
  const planOf = (stop: object) => ({ days: [{ day: 1, city: 'seoul', stops: [{ category: 'food', start_time: '12:00', ...stop }] }] });
  it.each([
    [{ name: '무채색, 홍대 연남동 맛집 & 술집' }, 'exact'],
    [{ name: '무채색', display_name: 'Muchaesaek' }, 'aliasOnly'], // 쉼표 뒤 원문 누락 — display_name 이 영문명과 맞아도 exact 아님
    [{ name: 'Muchaesaek' }, 'aliasOnly'],
    [{ name: '무채색 홍대점' }, 'unmatched'],
  ])('%j → %s', (stop, kind) => {
    const out = foodNameCompliance(planOf(stop), [row], 'seoul', findSelectedFoodRow);
    expect(out).toEqual({ exact: kind === 'exact' ? 1 : 0, aliasOnly: kind === 'aliasOnly' ? 1 : 0, unmatched: kind === 'unmatched' ? 1 : 0 });
  });
});

// ── r5 (유료 run 4: Claude 이름 규칙 오해 2종) ───────────────────────────────
describe('r5 — identifier-first matching: stop.name decides before display_name', () => {
  const haepo = { name: '해포', nameEn: 'Haepo', city: 'seoul', tag: 'vegan', verification_status: 'vegan_restaurant', address: '서울특별시 마포구 1' };
  const naver = { name: '나마스테 해운대점', nameEn: '', city: 'busan', tag: 'halal', verification_status: 'muslim_friendly', address: '부산광역시 해운대구 1' };
  const google = { name: '나마스테 인도 레스토랑', nameEn: 'Namaste Haeundae', city: 'busan', tag: 'general', source: 'google_places', address: '부산광역시 해운대구 2' };
  const planOf = (city: string, stop: object) => ({ days: [{ day: 1, city, stops: [{ category: 'food', start_time: '12:00', ...stop }] }] });

  it('"해포 (Haepo)" copied whole from the list line matches the 해포 row; the harness counts it aliasOnly (exact = name before the parenthesis)', () => {
    expect(findSelectedFoodRow({ name: '해포 (Haepo)' }, [haepo], { dayCity: 'seoul' })).toBe(haepo);
    expect(findSelectedFoodRow({ name: '해포 (Haepo) [VEGAN]' }, [haepo], { dayCity: 'seoul' })).toBeNull(); // 모델 출력은 자르지 않는다
    expect(foodNameCompliance(planOf('seoul', { name: '해포 (Haepo)' }), [haepo], 'seoul', findSelectedFoodRow)).toEqual({ exact: 0, aliasOnly: 1, unmatched: 0 });
    expect(foodNameCompliance(planOf('seoul', { name: '해포', display_name: 'Haepo' }), [haepo], 'seoul', findSelectedFoodRow)).toEqual({ exact: 1, aliasOnly: 0, unmatched: 0 });
  });

  it('name matches one row and display_name matches another row\'s nameEn → the name row wins (not ambiguous)', () => {
    const rows = [naver, google];
    expect(findSelectedFoodRow({ name: '나마스테 해운대점', display_name: 'Namaste Haeundae' }, rows, { dayCity: 'busan' })).toBe(naver);
    expect(findSelectedFoodRow({ name: '나마스테 해운대점', display_name: 'Namaste Haeundae' }, [...rows].reverse(), { dayCity: 'busan' })).toBe(naver);
  });

  it('a name exactly matching two rows stays ambiguous (null), whatever display_name says', () => {
    const twin = { ...haepo, verification_status: 'unverified', source: 'naver_local' };
    expect(findSelectedFoodRow({ name: '해포', display_name: 'Haepo' }, [haepo, twin], { dayCity: 'seoul' })).toBeNull();
    expect(findSelectedFoodRow({ name: '해포 (Haepo)' }, [haepo, twin], { dayCity: 'seoul' })).toBeNull();
  });

  it('name unmatched → display_name still finds the row (step 2)', () => {
    expect(findSelectedFoodRow({ name: '해포 망원점', display_name: 'Haepo' }, [haepo], { dayCity: 'seoul' })).toBe(haepo);
    expect(findSelectedFoodRow({ name: '', display_name: 'Namaste Haeundae' }, [naver, google], { dayCity: 'busan' })).toBe(google);
  });

  // Astra r5 ① — 의도된 변경: 이름이 한 행을 정하면 display_name 의 모순(다른 행 nameEn)은 무시한다.
  //   이전 매처는 두 이름을 한 집합으로 봐서 A·B 둘 다 후보 → 모호 → null 이었다.
  it('name decides: stop {name:"해포 (Haepo)", display_name:"Alpha"} → B (the contradicting display_name is ignored, by design)', () => {
    const a = { name: '가', nameEn: 'Alpha', city: 'seoul', address: '서울특별시 중구 1' };
    const b = { name: '해포', nameEn: 'Haepo', city: 'seoul', address: '서울특별시 중구 2' };
    expect(findSelectedFoodRow({ name: '해포 (Haepo)', display_name: 'Alpha' }, [a, b], { dayCity: 'seoul' })).toBe(b);
    expect(findSelectedFoodRow({ name: '해포 (Haepo)', display_name: 'Alpha' }, [b, a], { dayCity: 'seoul' })).toBe(b);
  });
});

// ── r6: DB 원문 이름에 괄호가 든 실제 행 모양(api/_food_index.json 의 name·nameEn·city 그대로, 주소는 합성) ──
describe('r6 — raw DB names containing parentheses', () => {
  const eid = { name: '이드 할랄 한식 (홍대점)', nameEn: 'Eid Halal Korean Food (Hongdae Branch)', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', address: '서울특별시 마포구 1' };
  const sammimi = { name: '(삼미미식당)', nameEn: 'SAMMiMi KBBQ - HALAL Hanwoo KBBQ & Handon', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', address: '서울특별시 강남구 1' };
  const cherry = { name: 'Cherry Garden Restaurant (Halal)', nameEn: 'Cherry Garden Restaurant (Halal)', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', address: '서울특별시 종로구 1' };
  const rows = [eid, sammimi, cherry];
  const find = (name: string) => findSelectedFoodRow({ name }, rows, { dayCity: 'seoul' });
  const planOf = (name: string) => ({ days: [{ day: 1, city: 'seoul', stops: [{ category: 'food', start_time: '12:00', name }] }] });

  it('raw name as listed → match, counted exact', () => {
    for (const row of rows) {
      expect(find(row.name)).toBe(row);
      expect(foodNameCompliance(planOf(row.name), rows, 'seoul', findSelectedFoodRow)).toEqual({ exact: 1, aliasOnly: 0, unmatched: 0 });
    }
  });

  // Cherry Garden 은 nameEn == name 이라 합성 별칭이 없다 — 원문 그대로 매칭만 위에서 검사.
  it.each([
    ['이드 할랄 한식 (홍대점) (Eid Halal Korean Food (Hongdae Branch))', eid],
    ['(삼미미식당) (SAMMiMi KBBQ - HALAL Hanwoo KBBQ & Handon)', sammimi],
  ])('whole list-line copy %s → matched through the DB-side alias, counted aliasOnly', (copied, row) => {
    expect(find(copied)).toBe(row);
    expect(foodNameCompliance(planOf(copied), rows, 'seoul', findSelectedFoodRow)).toEqual({ exact: 0, aliasOnly: 1, unmatched: 0 });
  });

  it('a name cut before the raw parenthesis ("이드 할랄 한식") → null, so the dietary check reports a violation', () => {
    expect(find('이드 할랄 한식')).toBeNull();
    expect(foodNameCompliance(planOf('이드 할랄 한식'), rows, 'seoul', findSelectedFoodRow)).toEqual({ exact: 0, aliasOnly: 0, unmatched: 1 });
    const result = runFinalItineraryValidation({ days: [{ day: 1, city: 'seoul', stops: [
      { name: 'Synthetic Culture A', category: 'culture', start_time: '10:00' },
      { name: '이드 할랄 한식', category: 'food', start_time: '12:00', stay_min: 60 },
      { name: 'Synthetic Culture B', category: 'culture', start_time: '14:00' },
      { name: 'Synthetic Culture C', category: 'culture', start_time: '16:00' },
    ] }] }, { language: 'en', dietary: ['Halal'], foodIndex: rows });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(FINAL_GATE_DIETARY_CODE);
  });
});

describe('P1 — prompt contract', () => {
  const sys = buildSystemPrompt('en');
  it('top-level dietary rule (Astra wording), Vegetarian included', () => {
    expect(sys).toContain('Halal/Vegan/Vegetarian 요청은 식이 안전이 지역 대표 음식·특별 요청·다양성보다 우선한다. 해당 식사 도시의 제공 목록에서 모든 요청 식이 조건을 충족하는 식당만 선택한다. 목록이 없거나 부족해도 일반 체인·범주형 식당·호텔·편의점으로 대체하지 않는다.');
    expect(sys.indexOf('DIETARY SAFETY — TOP RULE')).toBeLessThan(sys.indexOf('MEAL PLANNING'));
    expect(sys).toMatch(/If diet_preferences includes "Vegetarian":/);
  });
  it('exact-name rule; the "reuse a restaurant" instruction is gone (the duplicate gate rejects it)', () => {
    expect(sys).toContain('"name" 은 목록에 표시된 원문 식별 이름이다. 쉼표 뒤 수식어·지점명·구두점까지 그대로 복사하고 줄이거나 번역하지 않는다. 번역은 "display_name" 에만 한다.');
    expect(sys).not.toMatch(/REUSE a DB restaurant/);
  });
  it('r6: "name" keeps the raw DB name (its own parentheses included); only the list-appended "(nameEn)", markers and rating are dropped (source string)', () => {
    const rule = '"name" 은 목록 줄의 **원문 식당명 그대로** — 원문 안의 괄호·영문·지점명은 보존한다. 제외하는 것은 목록이 원문 **뒤에 덧붙인** 표시용 영문 괄호 "(…)", [HALAL]/[VEGAN] 표식, 별점만. 예: "• 이드 할랄 한식 (홍대점) (Eid Halal Korean Food (Hongdae Branch)) [HALAL] ⭐4.5" → "name": "이드 할랄 한식 (홍대점)"; "• 해포 (Haepo) [VEGAN]" → "name": "해포"; "• Cherry Garden Restaurant (Halal) (Cherry Garden Restaurant (Halal)) [HALAL]" → "name": "Cherry Garden Restaurant (Halal)". 영문·번역은 "display_name" 에만.';
    expect(read('api/_ai_core/buildPrompt.js')).toContain(rule);
    expect(sys).toContain(rule);
    expect(sys).not.toContain('괄호 앞 한국어 식별 이름만');
  });
  it('nationwide-chain exception and Busan signature dishes are conditioned on NO safety diet', () => {
    expect(sys).toMatch(/If NO "VERIFIED RESTAURANT DATABASE" appears in the message AND diet_preferences includes none of Halal\/Vegan\/Vegetarian/);
    expect(sys).toMatch(/When the destination includes Busan AND diet_preferences includes none of Halal\/Vegan\/Vegetarian/);
  });
  it('departure-day breakfast instruction (2026-10-24: no restaurant breakfast before an 11:00 departure)', () => {
    expect(sys).toContain('출국 11:00 전에는 식당 조식을 넣지 않는다. 안내 문장은 백엔드가 자동으로 붙이므로 직접 쓰지 않는다. 지어내기 금지.');
    expect(sys).toContain('<11:00 → no restaurant breakfast (no breakfast stop; the backend appends the guest notice automatically — do NOT write it); 11-16:59 → breakfast OR lunch/snack; ≥17:00 → both');
    expect(sys).not.toMatch(/checkout stop tip|체크아웃 stop tip/); // 안내는 후처리 단일 책임(applyDepartureBreakfastNote)
    expect(sys).not.toContain('09:00–10:59 출국일에는 조식이 필요하다');
  });
  it('per-request block: present only for safety diets, and it says the chain fallback does not apply', () => {
    expect(buildDietarySafetyBlock(['Halal'])).toMatch(/nationwide-chain \/ category fallback does NOT apply/);
    expect(buildDietarySafetyBlock(['Vegetarian', 'Meat'])).toMatch(/\(Vegetarian\)/);
    expect(buildDietarySafetyBlock(['Meat'])).toBe('');
    expect(buildDietarySafetyBlock([])).toBe('');
  });
});

// ── P3 ─────────────────────────────────────────────────────────────────────
const trustedRows = [
  { name: '합성 저녁', nameEn: 'Synthetic Dinner', city: 'seoul', tag: 'vegan', verification_status: 'vegan_restaurant', address: '서울특별시 종로구 1', lat: 37.57, lng: 126.98 },
  { name: '합성 아침', nameEn: 'Synthetic Breakfast', city: 'seoul', tag: 'vegan', verification_status: 'vegan_restaurant', address: '서울특별시 종로구 2', lat: 37.57, lng: 126.98 },
];
const twoDayPlan = (departureStops: object[]) => ({ days: [
  { day: 1, city: 'seoul', stops: [
    { name: 'Hotel', category: 'lodging', start_time: '15:00' },
    { name: '합성 저녁', category: 'food', start_time: '18:00' },
    { name: 'Hotel', category: 'lodging', start_time: '20:00' },
  ] },
  { day: 2, city: 'seoul', stops: departureStops },
] });
const checkout = { name: 'Hotel', category: 'lodging', start_time: '06:00' };
const airport = { name: 'Incheon International Airport', category: 'airport', start_time: '07:30' };
const breakfast = (over: object = {}) => ({ name: '합성 아침', category: 'food', start_time: '06:30', ...over });

describe('P3 — required meals (B-MEAL) shared with the final gate', () => {
  it.each([
    ['08:59', 0], // red-eye — 조식 면제
    ['09:00', 0], // 2026-10-24: 출국 11:00 전 식당 조식 면제(안내는 체크아웃 tip)
    ['10:59', 0],
    ['11:00', 1], // 낮 출국 — 조식 또는 점심 필요
  ])('departure %s with no food on the last day → %i required-meal issue(s)', (departure, count) => {
    const issues = checkRequiredMeals(twoDayPlan([checkout, airport]), { departure_time: departure });
    expect(issues).toHaveLength(count);
    if (count) expect(issues[0]).toMatch(new RegExp(`^Day 2 \\(출국일\\): departure_time=${departure}.*\\(B-MEAL`));
  });

  // 2026-10-24: 출국 11:00 전은 식당 조식 면제 → 이 블록의 "끼니 누락" 의도는 13:00(낮 출국 — 조식 또는 점심) 로 검사.
  const DEP = '13:00';
  it('final gate: a 10:00 departure with checkout + airport only now passes (restaurant breakfast exempt)', () => {
    expect(runFinalItineraryValidation(twoDayPlan([checkout, airport]), { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: '10:00' } }).ok).toBe(true);
  });

  it('final gate with tripTimes: a missing 13:00-departure meal fails (it slipped past the <3-activity exemption before)', () => {
    const plan = twoDayPlan([checkout, airport]);
    const legacy = runFinalItineraryValidation(plan, { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows });
    expect(legacy.ok).toBe(true); // tripTimes 없는 호출은 기존 판정 그대로
    const gate = runFinalItineraryValidation(plan, { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: DEP } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
    expect(gate.requiredMealIssues).toEqual([expect.stringMatching(/^Day 2 \(출국일\): departure_time=13:00 낮 출국 — 조식\(06-10시\)\/오후식사\(11-16시\) 모두 누락 \(B-MEAL, P137\)$/)]);
    const err = buildFinalGateError(gate, ['Vegan'], 'post_response');
    expect(err).toMatchObject({ code: FINAL_GATE_MEAL_CODE, statusCode: 422 });
    expect(err.details).toEqual(gate.requiredMealIssues);
  });

  it('a trusted breakfast satisfies it', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast(), airport]), { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: DEP } });
    expect(gate.ok).toBe(true);
  });

  it('a placeholder breakfast is not a completed meal (dietary evidence fails)', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ name: '[추천 식당 준비 중]', verified: false }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: DEP } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });

  it('hiding the breakfast under another category does not count as a meal', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ category: 'cafe' }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: DEP } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
  });

  it('a forged dietary_tags on the stop (now allowed by the schema) is not evidence — the DB row decides', () => {
    const generalRow = { ...trustedRows[1], tag: 'general', verification_status: undefined };
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ dietary_tags: ['vegan'], verified: true }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: [trustedRows[0], generalRow], tripTimes: { departure_time: DEP } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });

  it('non-dietary guests: final gate stays a no-op even with tripTimes', () => {
    expect(runFinalItineraryValidation(twoDayPlan([checkout, airport]), { dietary: ['Meat'], tripTimes: { departure_time: DEP } }).ok).toBe(true);
  });

  it('tripTimesFrom reads camel or snake, HH:MM', () => {
    expect(tripTimesFrom({ departureTime: '10:00:00', arrival_time: '14:00' })).toEqual({ departure_time: '10:00', arrival_time: '14:00' });
    expect(tripTimesFrom(undefined)).toEqual({ departure_time: undefined, arrival_time: undefined });
  });

  it('wiring: post-response gate passes tripTimes; sync and worker callers hand it the times', () => {
    expect(read('api/_ai_core/postResponsePipeline.js')).toMatch(/foodIndex: foodIndexForQuality, tripTimes \}/);
    // 2026-10-26: 도착 휴식일 판정 입력(arrival_airport·tourEndTime)도 함께 넘긴다.
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/applyRecommendedRestaurants\(itinerary, \{[^}]*departureTime, arrivalTime, arrival_airport, tourEndTime \}\)/);
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/applyRecommendedRestaurants\(itinAfterBackfill, \{[\s\S]*?body: ctx\.body,[\s\S]*?\}\);/);
  });
});

describe('P4 — compare harness scenarios and safety tally', () => {
  // 2026-10-24: 시나리오·입력 조립은 scripts/integration/llm-compare-free.mjs (유료 하네스와 무료 루프 공용).
  const freeSrc = read('scripts/integration/llm-compare-free.mjs');
  it('exactly the four dietary scenarios, with regions and entry/exit wired through the production list builder', () => {
    expect(Object.keys(SCENARIOS)).toEqual(['busan-halal-local', 'seoul-busan-halal', 'seoul-ja', 'jeju-vegan']);
    expect(SCENARIOS['busan-halal-local']).toMatchObject({ arrival_airport: 'PUS', departure_airport: 'PUS', departureTime: '15:00' }); // 조식 또는 점심 경로
    expect(SCENARIOS['seoul-busan-halal']).toMatchObject({ regions: ['seoul', 'busan'], arrival_airport: 'ICN_T1', departure_airport: 'PUS', arrivalCity: 'seoul', departureCity: 'busan' });
    expect(SCENARIOS['jeju-vegan']).toMatchObject({ arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'CJU', departure_airport: 'CJU' });
    expect(freeSrc).toMatch(/buildTripFoodContext\(\{ cities: mealCities,/);
    expect(freeSrc).not.toMatch(/getFoodContext\(/);
    expect(freeSrc).not.toMatch(/regions: \[p\.s\.area\]/);
    expect(read('scripts/llm-compare-providers.mjs')).toMatch(/const ALL = SCENARIOS;/);
  });

  it('summarizeSafety tallies exact / alias-only / unmatched names, dietary-violation and missing-meal rows per provider', () => {
    const rows = [
      { provider: 'gemini', nameCompliance: { exact: 3, aliasOnly: 1, unmatched: 0 }, dietaryCritical: false, mealCoverage: { checked: true, missing: [] } },
      { provider: 'gemini', nameCompliance: { exact: 1, aliasOnly: 0, unmatched: 2 }, dietaryCritical: true, mealCoverage: { checked: true, missing: ['x (B-MEAL)'] } },
      { provider: 'claude', nameCompliance: { exact: 4, aliasOnly: 0, unmatched: 0 }, dietaryCritical: false, mealCoverage: { checked: true, missing: ['y (B-MEAL)'] } },
      { provider: 'claude', error: 'boom' }, // 집계 필드 없는 행은 세지 않는다
    ];
    expect(summarizeSafety(rows)).toEqual({
      gemini: { rows: 2, exactNames: 4, aliasOnlyNames: 1, unmatchedNames: 2, dietaryViolationRows: 1, mealMissingRows: 1 },
      claude: { rows: 1, exactNames: 4, aliasOnlyNames: 0, unmatchedNames: 0, dietaryViolationRows: 0, mealMissingRows: 1 },
    });
    const o = evaluateCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1'], results: rows.map((r) => ({ ...r, scenarioId: 's1' })) });
    expect(o.ok).toBe(false); // 끼니 누락·식이 위반 행은 판정에서 실패 — 안전 실패를 성공으로 세지 않는다
    expect(formatOutcome(o)).toMatch(/safety claude: exact=4 aliasOnly=0 unmatched=0 dietaryViolationRows=0 mealMissingRows=1/);
  });

  it('old artifacts without the tally print no safety line', () => {
    expect(summarizeSafety([{ provider: 'gemini' }])).toEqual({});
  });
});
