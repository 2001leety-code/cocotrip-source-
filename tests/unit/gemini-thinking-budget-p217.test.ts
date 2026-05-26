/**
 * P217 (2026-05-26): Gemini thinkingBudget Pro 4000 → -1 (dynamic 기본값) 회귀 방지.
 *
 * 배경 — 3 AI second opinion 합의:
 *   - Gemini AI 직접 권고: thinkingBudget=0 비권장/불안정
 *   - -1 = dynamic (Gemini 자율 결정, 공식 기본값)
 *   - 양수 고정값 (e.g. 4000) 보다 -1 이 응답 안정성 향상
 *
 * P192 와의 관계:
 *   - Flash: thinkingBudget=0 유지 (P192 고정) — Flash 는 thinking 이 maxOutputTokens 안에서
 *     차감 → thinkingBudget > 0 이면 output cap 소진 위험 (GitHub Issue #609/#2062/#1039)
 *   - Pro: 4000 → -1 (dynamic). maxOutputTokens 32K 상한으로 output 침범 위험 제어.
 *
 * assertions:
 *   1. Flash 분기 thinkingBudget = 0 유지 (P192 회귀 방지)
 *   2. Pro 분기 thinkingBudget = -1 (P217 신규)
 *   3. 0이 아님 (Gemini 권고: 0 비권장)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');

describe('P217 geminiPipeline.js — thinkingBudget Flash:0 유지 + Pro:-1 (dynamic)', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(sourcePath, 'utf8');
  });

  it('assertion 1: Flash 분기 thinkingBudget = 0 (P192 고정 유지)', () => {
    // P192: Flash 는 thinking 이 maxOutputTokens 안에서 차감 → 0 강제 필수
    const hasFlashZero = /isFlash\s*\?\s*0/.test(src);
    expect(hasFlashZero).toBe(true);
  });

  it('assertion 2: Pro 분기 thinkingBudget = -1 (P217 dynamic 기본값)', () => {
    // isFlash ? 0 : -1 패턴 확인
    const proMatch = src.match(/isFlash\s*\?\s*0\s*:\s*(-?\d+)/);
    expect(proMatch).not.toBeNull();
    const proVal = parseInt(proMatch![1], 10);
    expect(proVal).toBe(-1); // P217: dynamic 기본값
  });

  it('assertion 3: Pro 분기 0 미사용 (Gemini 공식 비권장)', () => {
    const proMatch = src.match(/isFlash\s*\?\s*0\s*:\s*(-?\d+)/);
    if (proMatch) {
      const proVal = parseInt(proMatch![1], 10);
      expect(proVal).not.toBe(0); // Gemini 직접 권고: 0 = 비권장/불안정
    }
  });
});
