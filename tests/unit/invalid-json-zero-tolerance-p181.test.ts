/**
 * P181 (2026-05-24): INVALID_JSON zero-tolerance — 운영자 "플랜 만들었을때 오류
 * 1도없이" 강조. 측정 시 INVALID_JSON 3건/day 발생 (오늘 알림 누적).
 *
 * Phase 1:
 * - maxOutputTokens 12K → 16K (P164 raise)
 * - buildPrompt OUTPUT SIZE 강화 (tip 1 sentence + 다도시 max 5 stops)
 *
 * Phase 2 (별도 PR): responseValidator JSON repair fallback (last-resort minimal plan).
 *
 * 회귀 시: 다도시 5-day Halal/Meat plan 응답이 12K 근접 + 잘림 → INVALID_JSON.
 * user retry 도 같은 random fail → throw 500. 돈 받는 plan 신뢰 손상.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P181 INVALID_JSON zero-tolerance', () => {
  const geminiPath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');
  const promptPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const geminiSrc = readFileSync(geminiPath, 'utf8');
  const promptSrc = readFileSync(promptPath, 'utf8');

  it('geminiPipeline.js — maxOutputTokens >= 16000 (P164 raise)', () => {
    const m = geminiSrc.match(/maxOutputTokens:\s*(\d+)/);
    expect(m).not.toBeNull();
    const v = parseInt(m![1], 10);
    expect(v).toBeGreaterThanOrEqual(16000);
  });

  it('geminiPipeline.js — P181 reference + 이전 12K 회귀 차단', () => {
    expect(geminiSrc).toMatch(/P181[\s\S]{0,200}16K|P181[\s\S]{0,200}zero/i);
    // 12K hardcoded 회귀 차단
    expect(geminiSrc).not.toMatch(/maxOutputTokens:\s*12000/);
  });

  it('buildPrompt.js — OUTPUT SIZE P181 ZERO TOLERANCE section', () => {
    expect(promptSrc).toMatch(/OUTPUT SIZE[^\n]*P181 ZERO TOLERANCE/);
    expect(promptSrc).toMatch(/tip:\s*1 sentence MAX/i);
  });

  it('buildPrompt.js — 다도시 max 5 stops + recommended_items 4 max', () => {
    expect(promptSrc).toMatch(/다도시[\s\S]{0,100}max\s*5\s*stops/);
    expect(promptSrc).toMatch(/recommended_items[\s\S]{0,80}4 items max|4 max/);
  });
});
