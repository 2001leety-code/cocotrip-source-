/**
 * P276+P277 v2 minimal (2026-05-29): buildPrompt 강화 token 절감 회귀 차단.
 *
 * P276+P277 v1 (PR #675 → revert PR #691) lesson:
 *   ~30 line section 추가 → buildPrompt token 증가 → Gemini 504 timeout (240s 도달).
 *
 * P276+P277 v2 fix:
 *   B-16 STRICT ENFORCEMENT 1줄 추가 (arrival_guide.steps + daily_budget_summary 통째 누락 금지).
 *   별도 section 제거 (token 영향 최소).
 *
 * 회귀 시: section 30+ line 추가 회귀 → Gemini 504 timeout 재발.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P276+P277 v2 minimal — token 절감 buildPrompt 강화', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — P276+P277 v2 minimal reference 명시', () => {
    expect(src).toContain('P276+P277 v2 minimal 2026-05-29');
    expect(src).toContain('P276+P277 추가');
  });

  it('source — arrival_guide.steps + daily_budget_summary 통째 누락 금지 명시', () => {
    expect(src).toContain('arrival_guide.steps');
    expect(src).toContain('daily_budget_summary');
    expect(src).toContain('5개');  // Immigration / SIM / T-money / Currency / Get to Hotel 5 step
    expect(src).toContain('6 field');
    expect(src).toContain('통째 누락 절대 금지');
  });

  it('source — 별도 P276/P277 section 없음 (token 절감)', () => {
    // v1 의 별도 section 회귀 차단
    expect(src).not.toContain('### 🔴 P276 (2026-05-29) — arrival_guide STEPS 통째 누락 차단');
    expect(src).not.toContain('### 🔴 P277 (2026-05-29) — daily_budget_summary 통째 누락 차단');
  });

  it('source — buildPrompt 총 line 수 < 800 (token 영향 측정)', () => {
    const lineCount = src.split('\n').length;
    expect(lineCount).toBeLessThan(800);  // P276+P277 v1 ~825 line. v2 minimal ~795 line.
  });

  it('source — B-16 STRICT ENFORCEMENT 보존 + 강화', () => {
    expect(src).toContain('B-16 STRICT ENFORCEMENT');
    expect(src).toContain('P202 강화 2026-05-26');
    // 본 P276+P277 v2 강화도 같이
    expect(src).toMatch(/B-16 STRICT ENFORCEMENT.*P276\+P277 v2 minimal/);
  });
});
