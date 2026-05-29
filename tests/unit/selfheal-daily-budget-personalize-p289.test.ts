/**
 * P289 (2026-05-29): selfHealDailyBudget pax personalize 회귀 차단.
 * P300/B2 (2026-05-29): root array + 필드명 통일 (meals_krw/entry_fees_krw/transport_krw/total_krw).
 *
 * P277 buildPrompt 대안 — backend self_heal 시 pax 인원 곱셈으로 personalize.
 * Gemini prompt 변경 0 (cache miss risk 0).
 *
 * 회귀 시: pax=1 default (인원 무관) 또는 per-day/구필드명 (frontend 0원).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — JS module
import { selfHealDailyBudget } from '../../api/_ai_core/planPersister.js';

describe('P289/B2 selfHealDailyBudget pax personalize (root array)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/planPersister.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — ctx 인자 + pax 활용', () => {
    expect(src).toMatch(/selfHealDailyBudget\(itinerary,\s*ctx\s*=\s*\{\}\)/);
    expect(src).toContain('P289');
    expect(src).toMatch(/pax\s*=\s*Math\.max\(1,\s*Math\.min\(20,\s*Number\(ctx\?\.pax\)\s*\|\|\s*2\)\)/);
  });

  it('source — pax 곱셈 (meals_krw / entry_fees_krw / misc_krw)', () => {
    expect(src).toMatch(/meals_krw\s*=\s*foodCount\s*\*\s*15000\s*\*\s*pax/);
    expect(src).toMatch(/entry_fees_krw\s*=\s*attrCount\s*\*\s*10000\s*\*\s*pax/);
    expect(src).toMatch(/misc_krw\s*=\s*10000\s*\*\s*pax/);
  });

  it('source — root array 할당 + _pax 박제', () => {
    expect(src).toMatch(/itinerary\.daily_budget_summary\s*=\s*rows/);
    expect(src).toMatch(/_pax:\s*pax/);
  });

  // ── runtime (root array) ──────────────────────────────────────────────────

  function makeItinerary(stops: Array<any>) {
    return { days: [{ day: 1, stops }] } as any;
  }

  it('runtime — pax=2 + 2 food + 1 attraction → root array 곱셈', () => {
    const it = makeItinerary([
      { category: 'food' },
      { category: 'food' },
      { category: 'attraction' },
    ]);
    selfHealDailyBudget(it, { pax: 2 });
    const summary = it.daily_budget_summary[0]; // root array
    expect(summary.meals_krw).toBe(2 * 15000 * 2); // 60000
    expect(summary.entry_fees_krw).toBe(1 * 10000 * 2); // 20000
    expect(summary.transport_krw).toBe(0);
    expect(summary.total_krw).toBe(60000 + 20000 + 0 + 20000); // 100000 (misc 20000 포함)
    expect(summary._pax).toBe(2);
    expect(summary._self_healed).toBe(true);
  });

  it('runtime — pax=4 → 4명 곱셈', () => {
    const it = makeItinerary([{ category: 'food' }, { category: 'attraction' }]);
    selfHealDailyBudget(it, { pax: 4 });
    const summary = it.daily_budget_summary[0];
    expect(summary.meals_krw).toBe(1 * 15000 * 4); // 60000
    expect(summary.entry_fees_krw).toBe(1 * 10000 * 4); // 40000
    expect(summary._pax).toBe(4);
  });

  it('runtime — pax 없음 → default 2', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it);
    const summary = it.daily_budget_summary[0];
    expect(summary._pax).toBe(2);
    expect(summary.meals_krw).toBe(15000 * 2);
  });

  it('runtime — pax > 20 → cap 20', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it, { pax: 100 });
    expect(it.daily_budget_summary[0]._pax).toBe(20);
  });

  it('runtime — pax = 0 → default 2', () => {
    const it = makeItinerary([{ category: 'food' }]);
    selfHealDailyBudget(it, { pax: 0 });
    expect(it.daily_budget_summary[0]._pax).toBe(2);
  });

  it('runtime — Gemini root array 유효 → no-op (덮어쓰기 금지)', () => {
    const it = makeItinerary([{ category: 'food' }]);
    it.daily_budget_summary = [{ day: 1, meals_krw: 30000, transport_krw: 0, entry_fees_krw: 0, total_krw: 30000 }];
    selfHealDailyBudget(it, { pax: 4 });
    expect(it.daily_budget_summary[0].meals_krw).toBe(30000); // 보존
    expect(it.daily_budget_summary[0]._pax).toBeUndefined();
  });
});
