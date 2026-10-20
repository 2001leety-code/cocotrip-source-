/**
 * LLM 공급자 전환 (2026-10-13): mock 공급자의 플랜 픽스처가 실제 파이프라인 검증기
 * (B-10/B-12/B-14/B-15/B-DC + 식이 critical) 를 통과해야 한다 — CI(daily-health /
 * validate-planner 5 시나리오)가 mock 으로 돌 때 영원히 빨간불이 되지 않도록.
 */
import { describe, it, expect } from 'vitest';
import { buildMockPlan, buildMockBlockSelection } from '../../api/_shared/llm/mock.js';
import { validatePatternStructure, validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';
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
      for (const d of plan.days) {
        expect(d.stops.filter((x: { category?: string }) => x.category === 'food').length).toBeGreaterThanOrEqual(2);
      }
    });
  }

  it('falls back to a 1-day seoul plan when the text has no user JSON', () => {
    const plan = buildMockPlan({ userText: 'garbage' });
    expect(plan.days).toHaveLength(1);
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
