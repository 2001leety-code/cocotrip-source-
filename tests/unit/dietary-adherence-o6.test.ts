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

import { mealCitiesForTrip, buildTripFoodContext, enforceDietaryCoverage, hasSafetyDiet } from '../../api/_ai_core/dietaryCoverageGate.js';
import { buildSystemPrompt } from '../../api/_ai_core/buildPrompt.js';
import { buildDietarySafetyBlock } from '../../api/_ai_core/userMessageBuilder.js';
import { checkRequiredMeals } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation, buildFinalGateError, tripTimesFrom, FINAL_GATE_MEAL_CODE, FINAL_GATE_DIETARY_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { summarizeSafety, formatOutcome, evaluateCompareRun } from '../../scripts/integration/llm-compare-outcome.mjs';

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
  it('nationwide-chain exception and Busan signature dishes are conditioned on NO safety diet', () => {
    expect(sys).toMatch(/If NO "VERIFIED RESTAURANT DATABASE" appears in the message AND diet_preferences includes none of Halal\/Vegan\/Vegetarian/);
    expect(sys).toMatch(/When the destination includes Busan AND diet_preferences includes none of Halal\/Vegan\/Vegetarian/);
  });
  it('departure-day breakfast instruction (Astra wording)', () => {
    expect(sys).toContain('09:00–10:59 출국일에는 조식이 필요하다. 제공된 신뢰 후보로 해결할 수 없으면 식당·영업시간·호텔 조식·편의점 대안을 지어내지 말고 해당 끼니를 미충족으로 남겨라. 다른 category 로 바꾸어 숨기지 말라. DB 신뢰 등급은 아침 영업을 보장하지 않는다.');
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
    ['09:00', 1],
    ['10:59', 1],
    ['11:00', 1], // 낮 출국 — 조식 또는 점심 필요
  ])('departure %s with no food on the last day → %i required-meal issue(s)', (departure, count) => {
    const issues = checkRequiredMeals(twoDayPlan([checkout, airport]), { departure_time: departure });
    expect(issues).toHaveLength(count);
    if (count) expect(issues[0]).toMatch(new RegExp(`^Day 2 \\(출국일\\): departure_time=${departure}.*\\(B-MEAL`));
  });

  it('final gate with tripTimes: a missing 10:00-departure breakfast fails (it slipped past the <3-activity exemption before)', () => {
    const plan = twoDayPlan([checkout, airport]);
    const legacy = runFinalItineraryValidation(plan, { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows });
    expect(legacy.ok).toBe(true); // tripTimes 없는 호출은 기존 판정 그대로
    const gate = runFinalItineraryValidation(plan, { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: '10:00' } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
    expect(gate.requiredMealIssues).toEqual([expect.stringMatching(/^Day 2 \(출국일\): departure_time=10:00 이른 출국 — 조식\(06-10시\) 누락 \(B-MEAL, P137\)$/)]);
    const err = buildFinalGateError(gate, ['Vegan'], 'post_response');
    expect(err).toMatchObject({ code: FINAL_GATE_MEAL_CODE, statusCode: 422 });
    expect(err.details).toEqual(gate.requiredMealIssues);
  });

  it('a trusted breakfast satisfies it', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast(), airport]), { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: '10:00' } });
    expect(gate.ok).toBe(true);
  });

  it('a placeholder breakfast is not a completed meal (dietary evidence fails)', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ name: '[추천 식당 준비 중]', verified: false }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: '10:00' } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });

  it('hiding the breakfast under another category does not count as a meal', () => {
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ category: 'cafe' }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: trustedRows, tripTimes: { departure_time: '10:00' } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_MEAL_CODE });
  });

  it('a forged dietary_tags on the stop (now allowed by the schema) is not evidence — the DB row decides', () => {
    const generalRow = { ...trustedRows[1], tag: 'general', verification_status: undefined };
    const gate = runFinalItineraryValidation(twoDayPlan([checkout, breakfast({ dietary_tags: ['vegan'], verified: true }), airport]),
      { dietary: ['Vegan'], language: 'en', foodIndex: [trustedRows[0], generalRow], tripTimes: { departure_time: '10:00' } });
    expect(gate).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });

  it('non-dietary guests: final gate stays a no-op even with tripTimes', () => {
    expect(runFinalItineraryValidation(twoDayPlan([checkout, airport]), { dietary: ['Meat'], tripTimes: { departure_time: '10:00' } }).ok).toBe(true);
  });

  it('tripTimesFrom reads camel or snake, HH:MM', () => {
    expect(tripTimesFrom({ departureTime: '10:00:00', arrival_time: '14:00' })).toEqual({ departure_time: '10:00', arrival_time: '14:00' });
    expect(tripTimesFrom(undefined)).toEqual({ departure_time: undefined, arrival_time: undefined });
  });

  it('wiring: post-response gate passes tripTimes; sync and worker callers hand it the times', () => {
    expect(read('api/_ai_core/postResponsePipeline.js')).toMatch(/foodIndex: foodIndexForQuality, tripTimes \}/);
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/applyRecommendedRestaurants\(itinerary, \{[^}]*departureTime, arrivalTime \}\)/);
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/applyRecommendedRestaurants\(itinAfterBackfill, \{[\s\S]*?body: ctx\.body,[\s\S]*?\}\);/);
  });
});

describe('P4 — compare harness scenarios and safety tally', () => {
  const src = read('scripts/llm-compare-providers.mjs');
  it('exactly the four dietary scenarios, with regions and entry/exit wired through the production list builder', () => {
    const allBlock = src.slice(src.indexOf('const ALL = {'), src.indexOf('};', src.indexOf('const ALL = {')));
    expect([...allBlock.matchAll(/^\s+'([a-z-]+)':/gm)].map((m) => m[1])).toEqual(['busan-halal-local', 'seoul-busan-halal', 'seoul-ja', 'jeju-vegan']);
    expect(allBlock).toMatch(/'busan-halal-local':[^\n]*arrival_airport: 'PUS', departure_airport: 'PUS'/);
    expect(allBlock).toMatch(/'seoul-busan-halal':[^\n]*regions: \['seoul', 'busan'\][^\n]*arrival_airport: 'ICN_T1', departure_airport: 'PUS', arrivalCity: 'seoul', departureCity: 'busan'/);
    expect(allBlock).toMatch(/'jeju-vegan':[^\n]*arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'CJU', departure_airport: 'CJU'/);
    expect(src).toMatch(/buildTripFoodContext\(\{ cities: mealCities,/);
    expect(src).not.toMatch(/getFoodContext\(/);
    expect(src).not.toMatch(/regions: \[p\.s\.area\]/);
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
