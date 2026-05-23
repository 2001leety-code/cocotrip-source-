/**
 * P162 (2026-05-23): daily_budget_summary self-heal.
 * Gemini 가 daily_budget_summary 통째 비우는 회귀 (plan 36c12df2) — UI 빈 칸 차단.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { selfHealDailyBudget } from '../../api/_ai_core/planPersister.js';

describe('P162 selfHealDailyBudget', () => {
  it('빈 daily_budget_summary → stop count 기반 추정값', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          stops: [
            { category: 'lodging' },
            { category: 'food' },
            { category: 'food' },
            { category: 'attraction' },
            { category: 'attraction' },
            { category: 'attraction' },
            { category: 'lodging' },
          ],
        },
      ],
    } as any;

    const healed = selfHealDailyBudget(itinerary);
    expect(healed).toBe(1);
    const b = itinerary.days[0].daily_budget_summary;
    // food: 2 × 15000 = 30000
    expect(b.food).toBe(30000);
    // attraction: 3 × 10000 = 30000
    expect(b.attraction).toBe(30000);
    expect(b.transport).toBe(0);
    expect(b.misc).toBe(10000);
    // total = 30000+30000+0+10000 = 70000
    expect(b.total).toBe(70000);
    expect(b._self_healed).toBe(true);
  });

  it('이미 채워진 daily_budget_summary 는 skip', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          daily_budget_summary: { food: 50000, transport: 0, attraction: 30000, misc: 10000, total: 90000 },
          stops: [{ category: 'food' }, { category: 'attraction' }],
        },
      ],
    } as any;

    const healed = selfHealDailyBudget(itinerary);
    expect(healed).toBe(0);
    // 변경 없음
    expect(itinerary.days[0].daily_budget_summary.total).toBe(90000);
    expect(itinerary.days[0].daily_budget_summary._self_healed).toBeUndefined();
  });

  it('여러 day 중 일부만 비어있으면 빈 day 만 heal', () => {
    const itinerary = {
      days: [
        { day: 1, daily_budget_summary: { total: 50000 }, stops: [{ category: 'food' }] },
        { day: 2, stops: [{ category: 'food' }, { category: 'attraction' }] },
        { day: 3, daily_budget_summary: {}, stops: [{ category: 'food' }] },
      ],
    } as any;

    const healed = selfHealDailyBudget(itinerary);
    expect(healed).toBe(2);
    expect(itinerary.days[0].daily_budget_summary._self_healed).toBeUndefined();
    expect(itinerary.days[1].daily_budget_summary._self_healed).toBe(true);
    expect(itinerary.days[2].daily_budget_summary._self_healed).toBe(true);
  });

  it('빈 stops 도 misc 10000 + total 10000 보장', () => {
    const itinerary = { days: [{ day: 1, stops: [] }] } as any;
    selfHealDailyBudget(itinerary);
    const b = itinerary.days[0].daily_budget_summary;
    expect(b.food).toBe(0);
    expect(b.attraction).toBe(0);
    expect(b.misc).toBe(10000);
    expect(b.total).toBe(10000);
  });

  it('quality_warnings 박제 + 기존 보존', () => {
    const itinerary = {
      days: [{ day: 1, stops: [{ category: 'food' }] }],
      quality_warnings: [{ kind: 'existing', message: '기존' }],
    } as any;

    selfHealDailyBudget(itinerary);
    expect(itinerary.quality_warnings).toHaveLength(2);
    expect(itinerary.quality_warnings[1].kind).toBe('daily_budget_self_healed');
    expect(itinerary.quality_warnings[1].healed_days).toBe(1);
  });

  it('itinerary null 안전 (return 0)', () => {
    expect(selfHealDailyBudget(null as any)).toBe(0);
    expect(selfHealDailyBudget({} as any)).toBe(0);
    expect(selfHealDailyBudget({ days: [] } as any)).toBe(0);
  });
});
