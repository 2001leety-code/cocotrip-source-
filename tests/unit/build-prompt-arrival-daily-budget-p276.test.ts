/**
 * P276 + P277 (2026-05-29): buildPrompt 의 arrival_guide / daily_budget_summary 통째 누락 차단 강화.
 *
 * 사용자 신고 패턴: prod plan 6c807c03 등 다수 — Gemini 가 arrival_guide / daily_budget_summary 통째 누락
 *   → backend self-heal (planPersister.selfHealArrivalGuide / selfHealDailyBudget) 가 generic skeleton 합성
 *   → 사용자 personalize 안 된 generic 안내 = quality 저하 + 운영자 환불 risk.
 *
 * Fix: buildPrompt B-16 rule 강화 + P276/P277 section 추가 (arrival_guide 5-step structure 명시 + daily_budget_summary 누락 차단).
 *
 * 회귀 시: prod plan 의 arrival_guide_self_healed / daily_budget_self_healed quality_warning 빈도 ↑.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P276+P277 buildPrompt arrival_guide / daily_budget_summary REQUIRED 강화', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const src = readFileSync(srcPath, 'utf8');

  it('P276 — arrival_guide STEPS 통째 누락 차단 section 존재', () => {
    expect(src).toContain('P276');
    expect(src).toContain('arrival_guide STEPS 통째 누락 차단');
    expect(src).toContain('SAFETY-CRITICAL');
    // 사용자 신고 plan 명시
    expect(src).toContain('6c807c03');
    // 5-step 구조 명시
    expect(src).toContain('반드시 5개 step');
    expect(src).toContain('Immigration');
    expect(src).toContain('T-money');
  });

  it('P277 — daily_budget_summary 통째 누락 차단 section 존재', () => {
    expect(src).toContain('P277');
    expect(src).toContain('daily_budget_summary 통째 누락 차단');
    // 6 field 명시
    expect(src).toContain('transport_krw');
    expect(src).toContain('entry_fees_krw');
    expect(src).toContain('meals_krw');
    expect(src).toContain('activities_krw');
    expect(src).toContain('shopping_estimate_krw');
    expect(src).toContain('total_krw');
  });

  it('B-16 STRICT ENFORCEMENT P276 강화 명시', () => {
    expect(src).toMatch(/B-16 STRICT ENFORCEMENT[^]*P276 강화 2026-05-29/);
  });

  it('BAD/GOOD 예시 명시 (회귀 차단)', () => {
    expect(src).toContain('BAD');
    expect(src).toContain('GOOD');
    // 통째 누락 패턴 명시
    expect(src).toContain('통째 누락');
  });

  it('selfHeal 후 quality 저하 + 환불 risk 명시', () => {
    expect(src).toContain('selfHeal');
    expect(src).toContain('환불 risk');
  });
});
