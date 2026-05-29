/**
 * P289 (2026-05-29): selfHealDailyBudget pax personalize 회귀 차단.
 *
 * P277 buildPrompt 대안 — backend self_heal 시 pax 인원 곱셈으로 personalize.
 * Gemini prompt 변경 0 (cache miss risk 0).
 *
 * 회귀 시: pax=1 default → 인원 무관 generic 추정 회귀.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selfHealDailyBudget } from '../../api/_ai_core/planPersister.js';

describe('P289 selfHealDailyBudget pax personalize', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/planPersister.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — P289 ctx 인자 추가 + pax 활용', () => {
    expect(src).toMatch(/selfHealDailyBudget\(itinerary,\s*ctx\s*=\s*\{\}\)/);
    expect(src).toContain('P289');
    expect(src).toMatch(/pax\s*=\s*Math\.max\(1,\s*Math\.min\(20,\s*Number\(ctx\?\.pax\)\s*\|\|\s*2\)\)/);
  });

  it('source — pax 곱셈 (food / attraction / misc 모두)', () => {
    expect(src).toMatch(/food\s*=\s*foodCount\s*\*\s*15000\s*\*\s*pax/);
    expect(src).toMatch(/attraction\s*=\s*attrCount\s*\*\s*10000\s*\*\s*pax/);
    expect(src).toMatch(/misc\s*=\s*10000\s*\*\s*pax/);
  });

  it('source — _pax 박제 (admin panel 추적용)', () => {
    expect(src).toMatch(/_pax:\s*pax/);
  });

  // ── runtime ────────────────────────────────────────────────────────────────

  function makeItinerary(stops: Array<any>) {
    return { days: [{ day: 1, stops }] };
  }

  it('runtime — pax=2 + 2 food stops + 1 attraction → personalize 곱셈', () => {
    const it = makeItinerary([
      { category: 'food' },
      { category: 'food' },
      { category: 'attraction' },
    ]);
    selfHealDailyBudget(it, { pax: 2 });
    const summary = it.days[0].daily_budget_summary;
    expect(summary.food).toBe(2 * 15000 * 2);  // 60000
    expect(summary.attraction).toBe(1 * 10000 * 2);  // 20000
    expect(summary.misc).toBe(10000 * 2);  // 20000
    expect(summary.total).toBe(60000 + 20000 + 0 + 20000);  // 100000
    expect(summary._pax).toBe(2);
    expect(summary._self_healed).toBe(true);
  });

  it('runtime — pax=4 → 4명 곱셈', () => {
    const it = makeItinerary([
      { category: 'food' },
      { category: 'attraction' },
    ]);
    selfHealDailyBudget(it, { pax: 4 });
    const summary = it.days[0].daily_budget_summary;
    expect(summary.food).toBe(1 * 15000 * 4);  // 60000
    expect(summary.attraction).toBe(1 * 10000 * 4);  // 40000
    expect(summary._pax).toBe(4);
  });

  it('runtime — pax 없음 → default 2', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it);  // ctx 없음
    const summary = it.days[0].daily_budget_summary;
    expect(summary._pax).toBe(2);
    expect(summary.food).toBe(15000 * 2);
  });

  it('runtime — pax > 20 → cap 20 (overflow 차단)', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it, { pax: 100 });  // invalid
    const summary = it.days[0].daily_budget_summary;
    expect(summary._pax).toBe(20);
  });

  it('runtime — pax = 0 또는 negative → default min 1', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it, { pax: 0 });
    const summary = it.days[0].daily_budget_summary;
    expect(summary._pax).toBe(2);  // 0 || 2 fallback
  });

  it('runtime — daily_budget 이미 있음 → no-op', () => {
    const it = makeItinerary([{ category: 'food' }]);
    it.days[0].daily_budget_summary = { food: 30000, total: 30000 };
    selfHealDailyBudget(it, { pax: 4 });
    expect(it.days[0].daily_budget_summary.food).toBe(30000);  // 보존
  });
});
