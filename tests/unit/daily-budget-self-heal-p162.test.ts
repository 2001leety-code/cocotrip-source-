/**
 * P162 (2026-05-23) → P300/B2 (2026-05-29): daily_budget_summary self-heal (root array).
 *
 * Gemini 가 daily_budget_summary 누락하는 회귀 (plan 36c12df2) — UI 빈 칸 차단.
 *
 * P300/B2: SSOT = root level itinerary.daily_budget_summary 배열 (BudgetTable/pdfGenerator/
 *   OutroSlide 가 읽는 곳). 필드명 transport_krw/entry_fees_krw/meals_krw/total_krw.
 *   기존 P162/P289 가 per-day day.daily_budget_summary 에 food/transport (suffix 없음) 채워
 *   frontend 가 못 읽고 예산표 0원 (6월 상용화 audit B2). → root array + 필드명 통일.
 *   Gemini (P291 schema) 가 root array 유효하게 채웠으면 skip (P196 역효과 회피).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { selfHealDailyBudget } from '../../api/_ai_core/planPersister.js';

describe('P162/B2 selfHealDailyBudget (root array + 필드명 통일)', () => {
  it('빈 daily_budget_summary → root array 생성 (pax=1, BudgetTable 필드명)', () => {
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

    const healed = selfHealDailyBudget(itinerary, { pax: 1 });
    expect(healed).toBe(1);
    // root array 에 생성 (per-day 아님)
    const arr = itinerary.daily_budget_summary;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);
    const b = arr[0];
    // BudgetTable 필드명 (transport_krw/entry_fees_krw/meals_krw/total_krw)
    expect(b.meals_krw).toBe(30000); // 2 food × 15000 × pax(1)
    expect(b.entry_fees_krw).toBe(30000); // 3 attraction × 10000 × pax(1)
    expect(b.transport_krw).toBe(0); // server T-money 별도
    expect(b.total_krw).toBe(70000); // 30000+30000+0+10000(misc)
    expect(b._self_healed).toBe(true);
    expect(b.day).toBe(1);
  });

  it('Gemini 가 root array 유효하게 채움 → skip (덮어쓰기 금지, P196 역효과 회피)', () => {
    const itinerary = {
      days: [{ day: 1, stops: [{ category: 'food' }] }],
      daily_budget_summary: [
        { day: 1, transport_krw: 5000, meals_krw: 50000, entry_fees_krw: 0, total_krw: 55000 },
      ],
    } as any;

    const healed = selfHealDailyBudget(itinerary);
    expect(healed).toBe(0);
    // Gemini 값 보존
    expect(itinerary.daily_budget_summary[0].total_krw).toBe(55000);
    expect(itinerary.daily_budget_summary[0]._self_healed).toBeUndefined();
  });

  it('blockMode skeleton (0값 root array) → 재생성 (rootValid=false)', () => {
    const itinerary = {
      days: [{ day: 1, stops: [{ category: 'food' }] }],
      daily_budget_summary: [
        { day: 1, transport_krw: 0, entry_fees_krw: 0, meals_krw: 0, total_krw: 0 },
      ],
    } as any;

    const healed = selfHealDailyBudget(itinerary, { pax: 1 });
    expect(healed).toBe(1);
    expect(itinerary.daily_budget_summary[0].meals_krw).toBe(15000); // 1 food × 15000
  });

  it('빈 stops → misc 만 (total_krw=10000, pax=1)', () => {
    const itinerary = { days: [{ day: 1, stops: [] }] } as any;
    selfHealDailyBudget(itinerary, { pax: 1 });
    const b = itinerary.daily_budget_summary[0];
    expect(b.meals_krw).toBe(0);
    expect(b.entry_fees_krw).toBe(0);
    expect(b.total_krw).toBe(10000); // misc 10000 만
  });

  it('pax 곱셈 (pax=2)', () => {
    const itinerary = { days: [{ day: 1, stops: [{ category: 'food' }] }] } as any;
    selfHealDailyBudget(itinerary, { pax: 2 });
    const b = itinerary.daily_budget_summary[0];
    expect(b.meals_krw).toBe(30000); // 1 × 15000 × 2
    expect(b._pax).toBe(2);
  });

  it('다일 plan → 모든 day root array 생성', () => {
    const itinerary = {
      days: [
        { day: 1, stops: [{ category: 'food' }] },
        { day: 2, stops: [{ category: 'food' }, { category: 'attraction' }] },
      ],
    } as any;
    const healed = selfHealDailyBudget(itinerary, { pax: 1 });
    expect(healed).toBe(2);
    expect(itinerary.daily_budget_summary.length).toBe(2);
    expect(itinerary.daily_budget_summary[1].entry_fees_krw).toBe(10000); // Day2 1 attraction
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
