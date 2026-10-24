/**
 * LLM 공급자 전환 (2026-10-13): mock 공급자의 플랜 픽스처가 실제 파이프라인 검증기
 * (B-10/B-12/B-14/B-15/B-DC + 식이 critical) 를 통과해야 한다 — CI(daily-health /
 * validate-planner 5 시나리오)가 mock 으로 돌 때 영원히 빨간불이 되지 않도록.
 */
import { describe, it, expect } from 'vitest';
import { buildMockPlan, buildMockBlockSelection } from '../../api/_shared/llm/mock.js';
import { validatePatternStructure, validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';
import { runDuplicateStopGate, runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';
import { arrivalReadyHHMM } from '../../api/_ai_core/constants.js';
import { getExactCityTrustedDietaryCandidates } from '../../api/_food_helper.js';
import { loadFoodIndex } from '../../api/_ai_core/geminiPipeline.js';

const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

// validate-planner.cjs 의 5 시나리오와 동일 조건 (출국일 공항 포함).
const SCENARIOS = [
  { area: 'seoul', durationDays: 2, dietPrefs: ['Meat'], language: 'ko', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  { area: 'busan', durationDays: 3, dietPrefs: ['Halal'], language: 'ko', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  { area: 'jeju', durationDays: 2, dietPrefs: ['Vegan'], language: 'en' },
  { area: 'seoul', durationDays: 5, dietPrefs: ['Meat'], language: 'ja' },
  { area: 'seoul', durationDays: 1, dietPrefs: ['Vegetarian'], language: 'zh' },
];

function userText(s: typeof SCENARIOS[number]) {
  // userMessageBuilder: staticPrefix + middle + JSON.stringify(userInput) + tail
  const json = JSON.stringify({
    guest_name: 'Validate-Test', guest_count: 2, date: FUTURE, duration_days: s.durationDays,
    styles: ['Food'], area: s.area, regions: [s.area],
    arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    diet_preferences: s.dietPrefs.filter((d) => /halal|vegan|vegetarian/i.test(d)),
    tour_start_time: '09:00', tour_end_time: '21:00',
  });
  return 'SPOT CONTEXT...\n' + json + '\n=== VARIATION ===';
}

describe('buildMockPlan', () => {
  for (const s of SCENARIOS) {
    it(`${s.area} ${s.durationDays}d ${s.dietPrefs[0]} ${s.language}: passes structural + dietary validators`, async () => {
      const plan = buildMockPlan({ userText: userText(s) });
      expect(plan.days).toHaveLength(s.durationDays);
      expect(plan.arrival_guide).toBeTruthy();
      expect(plan.departure_guide).toBeTruthy();
      const errors = validatePatternStructure(plan, {
        durationDays: s.durationDays, regions: [s.area], area: s.area,
        arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
      });
      expect(errors).toEqual([]);
      const issues = validateResponse(plan, { dietary: s.dietPrefs, language: s.language, area: s.area, regions: [s.area] }, await loadFoodIndex());
      expect(hasCriticalDietaryViolation(issues)).toBe(false);
      // 2026-10-23: 끼니 수는 B-MEAL(위 validatePatternStructure)이 판정한다 — "매일 2끼" 고정은 trusted 풀이
      //   작은 도시에서 같은 식당 반복을 강요했다(종단 중복 게이트 422). 대신 중복 0 을 단언한다.
      expect(runDuplicateStopGate(plan)).toMatchObject({ ok: true, duplicates: [] });
    });
  }

  it('falls back to a 1-day seoul plan when the text has no user JSON', () => {
    const plan = buildMockPlan({ userText: 'garbage' });
    expect(plan.days).toHaveLength(1);
  });
});

// 2026-10-23: daily-health 의 실제 validate 입력(도착 14:00 · 출국 10:00 포함)으로 **종단 게이트**를 그대로 돌린다.
//   매일 13:02 3종 알림(AI 플래너 실패 / Daily Health 실패 / sweep stuck)의 원인 = mock 플랜의 같은 stop 반복 →
//   finalItineraryGate 중복 게이트 422 → plan 'streaming' 고착. 이 테스트가 그 회귀를 잠근다.
type HealthScenario = {
  id: string; area: string; durationDays: number; pax: number; dietPrefs: string[]; language: string; styles?: string[];
  arrivalTime?: string; departureTime?: string; arrival_airport?: string; departure_airport?: string;
};
// scripts/validate-planner.cjs · llm-compare-providers.mjs 와 같은 입력(도착 14:00 · 출국 10:00 · pax · language).
// 2026-10-24: trusted 풀 = 부산 할랄 6(기존 3 + Naver 승격 3), 제주 비건 2. 중복 제거 복구 행(dietary_restored)은
//   unverified 격리라 풀에 들어오지 않는다. 실데이터로 필수 끼니가 다 찬다(부산 3일 = 4끼 ≤ 6).
//   부족 상황은 buildMockPlan({ foodPool }) 로 풀 크기를 예전 값(3·1)에 고정해 계속 잠근다.
const DIET_SCENARIOS: Array<HealthScenario & { shortagePool: number }> = [
  { id: 'busan-halal', area: 'busan', durationDays: 3, pax: 4, dietPrefs: ['Halal'], language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', shortagePool: 3 },
  { id: 'jeju-vegan', area: 'jeju', durationDays: 2, pax: 2, dietPrefs: ['Vegan'], language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'CJU', departure_airport: 'CJU', shortagePool: 1 },
];
const NON_DIET: HealthScenario[] = [
  { id: 'seoul-meat', area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'], language: 'ko', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  { id: 'seoul-food-photo-1d', area: 'seoul', durationDays: 1, pax: 2, dietPrefs: [], language: 'en', styles: ['Food', 'Photo'] },
];

function healthUserText(s: HealthScenario) {
  // userMessageBuilder 와 같은 userInput 필드 — arrival_ready_time 도 같은 함수(arrivalReadyHHMM)로 계산.
  const json = JSON.stringify({
    guest_name: 'Validate-Test', guest_count: s.pax, date: FUTURE, duration_days: s.durationDays,
    styles: s.styles || ['culture', 'food'], area: s.area, regions: [s.area],
    arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    arrival_time: s.arrivalTime, departure_time: s.departureTime,
    arrival_ready_time: s.arrivalTime ? arrivalReadyHHMM(s.arrivalTime, s.arrival_airport, s.area) : undefined,
    diet_preferences: s.dietPrefs.filter((d) => /halal|vegan|vegetarian/i.test(d)),
    tour_start_time: '09:00',
  });
  return 'SPOT CONTEXT...\n' + json + '\n=== VARIATION ===';
}

/** 구조 검증에 넘기는 요청 body — 실제 요청 시각을 실어 B-LATE-ARRIVAL / B-EARLY-DEPARTURE 가 돈다. */
function healthBody(s: HealthScenario) {
  return {
    durationDays: s.durationDays, regions: [s.area], area: s.area, pax: s.pax, language: s.language, dietPrefs: s.dietPrefs,
    arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    arrival_time: s.arrivalTime, departure_time: s.departureTime,
  };
}

const SAFETY = /halal|vegan|vegetarian/i;
type PoolRow = { name: string };
const trustedRows = (s: HealthScenario): PoolRow[] => {
  const diets = s.dietPrefs.filter((d) => SAFETY.test(d)).map((d) => d.toLowerCase());
  const rows = getExactCityTrustedDietaryCandidates(s.area, diets, 40).map((c: { row: PoolRow }) => c.row);
  return rows.filter((r: PoolRow, i: number) => rows.findIndex((x: PoolRow) => x.name === r.name) === i); // mock 과 같은 이름 중복 제거
};
const trustedPool = (s: HealthScenario) => new Set(trustedRows(s).map((r) => r.name));
type Stop = { category?: string; name: string };
const foodsOf = (plan: { days: Array<{ stops: Stop[] }> }) => plan.days.flatMap((d) => d.stops.filter((x) => x.category === 'food'));

async function hardGates(plan: object, s: HealthScenario) {
  const foodIndex = await loadFoodIndex();
  const dup = runDuplicateStopGate(plan);
  expect(dup.duplicates).toEqual([]);
  expect(dup.ok).toBe(true);
  const final = runFinalItineraryValidation(plan, { dietary: s.dietPrefs, language: s.language, foodIndex });
  expect(final.ok).toBe(true);
  expect(hasCriticalDietaryViolation(validateResponse(plan, { dietary: s.dietPrefs, language: s.language }, foodIndex))).toBe(false);
}

describe('buildMockPlan — daily-health 식이 시나리오 (실데이터): 필수 끼니 전부 trusted, 반복 0, B-MEAL 0', () => {
  it('busan-halal 3일: 필수 끼니 4개 전부 trusted 할랄 식당, 반복 0, 구조 이슈 0', async () => {
    const s = DIET_SCENARIOS[0];
    const plan = buildMockPlan({ userText: healthUserText(s) });
    expect(plan.days).toHaveLength(s.durationDays);
    await hardGates(plan, s);
    const pool = trustedPool(s);
    expect(pool.size).toBeGreaterThanOrEqual(4); // 필수 4끼 이상 — 격리 후 기대 6
    const foods = foodsOf(plan);
    expect(foods).toHaveLength(4); // 도착일 1 + 중간일 2 + 출국 10:00 조식 1
    for (const f of foods) expect(pool.has(f.name), f.name).toBe(true);
    expect(validatePatternStructure(plan, healthBody(s))).toEqual([]);
  });
  it('jeju-vegan 2일: 끼니 2개 모두 trusted(AND유CAFE·비건테이블바람), 반복 0, 구조 이슈 0', async () => {
    const s = DIET_SCENARIOS[1];
    const plan = buildMockPlan({ userText: healthUserText(s) });
    expect(plan.days).toHaveLength(s.durationDays);
    await hardGates(plan, s);
    expect(trustedPool(s)).toEqual(new Set(['AND유CAFE', '비건테이블바람']));
    expect(foodsOf(plan).map((f) => f.name).sort()).toEqual(['AND유CAFE', '비건테이블바람']);
    expect(validatePatternStructure(plan, healthBody(s))).toEqual([]);
  });
});

describe('buildMockPlan — 식이 후보 부족(foodPool 로 풀 고정): 부족은 부족으로 남긴다(성공으로 꾸미지 않음)', () => {
  for (const s of DIET_SCENARIOS) {
    it(`${s.id}: trusted ${s.shortagePool}곳만 — 반복·지어내기 0, 출국일 조식 B-MEAL 부족 1건만 남음`, async () => {
      const poolRows = trustedRows(s).slice(0, s.shortagePool);
      expect(poolRows).toHaveLength(s.shortagePool);
      const plan = buildMockPlan({ userText: healthUserText(s), foodPool: poolRows });
      expect(plan.days).toHaveLength(s.durationDays);
      await hardGates(plan, s);

      const pool = new Set(poolRows.map((r) => r.name));
      const foods = foodsOf(plan);
      expect(foods.length).toBe(s.shortagePool); // 풀 전부 쓰고, 그 이상은 지어내지 않는다
      for (const f of foods) expect(pool.has(f.name)).toBe(true);

      // 필수 끼니(도착일 1 + 중간일 2 + 출국 10:00 조식 1) > trusted 수 → 출국일 조식 한 끼만 빈다. 그 외 이슈 0.
      const pattern = validatePatternStructure(plan, healthBody(s));
      expect(pattern).toHaveLength(1);
      expect(pattern[0]).toMatch(new RegExp(`^Day ${s.durationDays} \\(출국일\\): departure_time=10:00 이른 출국 — 조식\\(06-10시\\) 누락 \\(B-MEAL, P137\\)$`));

      // 2026-10-24 (식이 준수 P3): 운영 종단 게이트는 여행 시각을 받는다 → 이 빈 조식이 저장 전에 막힌다
      //   (예전엔 출국일 활동 3개 미만 면제로 통과). 같은 끼니가 details 로 남는다.
      const final = runFinalItineraryValidation(plan, { dietary: s.dietPrefs, language: s.language, foodIndex: await loadFoodIndex(), tripTimes: { departure_time: s.departureTime, arrival_time: s.arrivalTime } });
      expect(final).toMatchObject({ ok: false, code: 'DIETARY_MEAL_COVERAGE_FAILED' });
      expect(final.requiredMealIssues).toEqual([pattern[0]]);
    });
  }
});

describe('buildMockPlan — daily-health 비식이 시나리오: 실제 요청 시각으로 구조 검증 이슈 0', () => {
  for (const s of NON_DIET) {
    it(`${s.id}: zero duplicates, zero dietary critical, zero structural issues`, async () => {
      const plan = buildMockPlan({ userText: healthUserText(s) });
      expect(plan.days).toHaveLength(s.durationDays);
      await hardGates(plan, s);
      expect(validatePatternStructure(plan, healthBody(s))).toEqual([]);
    });
  }
  // block 경로(buildMockBlockSelection → 블록 펼치기 → 게이트)는 오프라인 공용 헬퍼가 없어 여기 포함하지 않는다.
  it('B-MEAL passes in full whenever the trusted pool covers the required meals (seoul vegetarian 3 days, 14:00 / 10:00)', () => {
    const s: HealthScenario = { id: 'seoul-veg-3d', area: 'seoul', durationDays: 3, pax: 2, dietPrefs: ['Vegetarian'], language: 'ja', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' };
    const plan = buildMockPlan({ userText: healthUserText(s) });
    expect(validatePatternStructure(plan, healthBody(s))).toEqual([]);
    expect(runDuplicateStopGate(plan).ok).toBe(true);
  });

  it('no spot pool → unique synthesized landmarks (never "Busan Landmark" ×N)', () => {
    const plan = buildMockPlan({ userText: healthUserText({ id: 'b', area: 'busan', durationDays: 3, pax: 2, dietPrefs: ['Meat'], language: 'en' }) });
    const spots = plan.days.flatMap((d: { stops: Array<{ category?: string; name: string }> }) => d.stops.filter((x) => x.category === 'culture').map((x) => x.name));
    expect(spots.length).toBeGreaterThan(0);
    expect(new Set(spots.map((n: string) => n.toLowerCase())).size).toBe(spots.length);
  });
});

describe('buildMockBlockSelection', () => {
  it('picks one available block per day, cycling, with the day city', () => {
    const msg = JSON.stringify({
      duration_days: 3, styles: [],
      available_blocks: [{ id: 'b1', city: 'seoul' }, { id: 'b2', city: 'seoul' }],
    });
    const out = buildMockBlockSelection({ userText: msg });
    expect(out.day_selections.map((d: { block_id?: string }) => d.block_id)).toEqual(['b1', 'b2', 'b1']);
    expect(out.day_selections[0]).toMatchObject({ day: 1, city: 'seoul' });
  });
  it('multi-city: respects per-day city map when present', () => {
    const msg = JSON.stringify({
      duration_days: 2,
      day_schedule: [
        { day: 1, city: 'seoul', available_blocks: [{ id: 's1' }] },
        { day: 2, city: 'busan', available_blocks: [{ id: 'p1' }] },
      ],
    });
    const out = buildMockBlockSelection({ userText: msg });
    expect(out.day_selections).toEqual([
      { day: 1, city: 'seoul', block_id: 's1' }, { day: 2, city: 'busan', block_id: 'p1' },
    ]);
  });
});
