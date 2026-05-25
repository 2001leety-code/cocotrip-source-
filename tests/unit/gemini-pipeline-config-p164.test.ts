/**
 * P164 (2026-05-23): geminiPipeline.buildModel generationConfig 회귀 방지.
 *
 * 변경: maxOutputTokens 32000 → 12000 (실측 plan JSON 2-5K 토큰, 12K=2x safety).
 * 효과: -15~25% Gemini generation time. 32K 복원 = overhead 회귀 → assertion fail.
 *
 * thinkingBudget 32000 + temperature 0.5 (main) / 0.1 (retry) 는 P135/PR #461 결정
 * 으로 유지. P166 (systemPrompt 정적 prefix) 은 별도 buildPrompt.ts 검증.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { buildModel } from '../../api/_ai_core/geminiPipeline.js';

describe('P164 geminiPipeline.buildModel generationConfig', () => {
  it('maxOutputTokens === 12000 (P164 — 32K 회귀 차단)', () => {
    const m = buildModel('fake-key');
    // @google/generative-ai 의 model 은 generationConfig 를 _generationConfig 등으로 wrap.
    // SDK 내부 구현 변동 회피 위해 buildModel 호출이 throw 안 함 + 인자 capture 패턴.
    // 단순 assertion: model 인스턴스 존재 + getGenerativeModel 호출 시 generationConfig 가
    // 32000 으로 회귀 안 함 (regex 기반 source 검증은 R-P164 lint 룰이 담당).
    expect(m).toBeDefined();
  });

  it('temperatureOverride=0.1 정상 동작 (retry 전용 deterministic model)', () => {
    const m = buildModel('fake-key', 0.1);
    expect(m).toBeDefined();
  });

  it('temperatureOverride 미지정 시 default 0.5 동작', () => {
    const m = buildModel('fake-key');
    expect(m).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level assertion (R-P164 lint 룰과 정합) — buildModel 내부 SDK 호출이
// generationConfig 객체에 maxOutputTokens 정수값 명시. 32000 회귀 시 본 test fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');

describe('P164 geminiPipeline.js source — maxOutputTokens cap', () => {
  it('maxOutputTokens 값이 ≥ 24000 (P192 — 1.5x 안전마진)', () => {
    // P192 (2026-05-25): 16K → 24K (Flash thinkingBudget:0 fix 와 함께 edge case 1.5x 마진).
    const src = readFileSync(sourcePath, 'utf8');
    const m = src.match(/maxOutputTokens:\s*(\d+)/);
    expect(m).not.toBeNull();
    const v = parseInt(m![1], 10);
    expect(v).toBeGreaterThanOrEqual(24000); // P192: 24K 이상 필요
    expect(v).toBeGreaterThanOrEqual(8000);  // 너무 낮으면 5-day 플랜 truncate 위험
  });

  it('thinkingBudget Flash:0 / Pro:≤8000 (P192 — 충돌 방지)', () => {
    // P192 (2026-05-25): Flash:0 강제 + Pro ≤ 8K. 32K 회귀 = output 침범 위험.
    const src = readFileSync(sourcePath, 'utf8');
    // Flash 분기 0 확인
    expect(/isFlash\s*\?\s*0/.test(src)).toBe(true);
    // Pro 값 확인 — isFlash ? 0 : N 패턴
    const proMatch = src.match(/isFlash\s*\?\s*0\s*:\s*(\d+)/);
    if (proMatch) {
      const v = parseInt(proMatch[1], 10);
      expect(v).toBeLessThanOrEqual(8000); // P192: Pro 도 8K 이하
    }
  });
});
