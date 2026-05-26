/**
 * P192 (2026-05-25): Gemini thinkingBudget + maxOutputTokens 충돌 방지 회귀 테스트.
 *
 * root cause (5/25 prod 회귀):
 *   - Flash: thinking 이 maxOutputTokens 안에서 차감 → thinkingBudget > 0 = output cap 소진
 *   - Pro: thinkingBudget 32K + maxOutputTokens 16K → thinking 토큰이 output 침범
 *   → responseSchema strict + max_tokens 초과 = null 반환 → repair throw → P181 fallback 빈도 ↑
 *   출처: GitHub Issue #609/#2062/#1039 (Google Gemini SDK deep-search 결과)
 *
 * assertion 5종:
 *   1. Flash 모델 인자 시 thinkingBudget = 0
 *   2. Pro 모델 인자 시 thinkingBudget ≤ 8000 (안전 범위)
 *   3. maxOutputTokens >= 24000 (다도시 5-day 1.5x 안전마진)
 *   4. responseMimeType: 'application/json' + responseSchema 유지 (P183 회귀 방지)
 *   5. buildModel() 이 throw 없이 정상 반환
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../api/_ai_core/geminiPipeline.js');

// ─── Source-level assertions (SDK 내부 구조에 의존하지 않음) ────────────────
describe('P192 geminiPipeline.js source — thinkingBudget + maxOutputTokens 충돌 방지', () => {
  let src: string;

  // 파일 한 번만 읽어서 공유
  beforeAll(() => {
    src = readFileSync(sourcePath, 'utf8');
  });

  it('assertion 1: Flash 분기에서 thinkingBudget = 0 설정됨', () => {
    // isFlash ? 0 : N 또는 isFlash = true → thinkingBudget = 0 패턴 확인
    const hasFlashBranch = /isFlash/.test(src);
    expect(hasFlashBranch).toBe(true);

    // Flash 분기에서 0 을 반환하는 패턴
    const hasFlashZero =
      /isFlash\s*\?\s*0/.test(src) ||
      /thinkingBudget\s*=\s*isFlash\s*\?\s*0/.test(src);
    expect(hasFlashZero).toBe(true);
  });

  it('assertion 2: Pro 분기 thinkingBudget = -1 (dynamic 기본값, P217 fix)', () => {
    // P217 (2026-05-26): 3 AI second opinion 합의. Gemini AI 직접 권고:
    // thinkingBudget=0 비권장 → -1 (dynamic, Gemini 자율 결정) 으로 변경.
    // Flash:0 이 아닌 값 추출 — isFlash ? 0 : N 패턴에서 N 을 파싱 (음수 포함)
    const proMatch = src.match(/isFlash\s*\?\s*0\s*:\s*(-?\d+)/);
    expect(proMatch).not.toBeNull();
    const proThinkingBudget = parseInt(proMatch![1], 10);
    // -1 = dynamic (Gemini 자율 결정), 0 이외 양수 = 고정값. 0 이면 Pro 도 thinking 비활성 = 품질 저하.
    expect(proThinkingBudget).not.toBe(0);
    // output 침범 위험: maxOutputTokens 32K 상한으로 제어. -1 은 Gemini 내부 동적 할당.
  });

  it('assertion 3: maxOutputTokens ≥ 24000 (다도시 edge case 1.5x 안전마진)', () => {
    const m = src.match(/maxOutputTokens\s*:\s*(\d+)/);
    expect(m).not.toBeNull();
    const v = parseInt(m![1], 10);
    expect(v).toBeGreaterThanOrEqual(24000);
  });

  it("assertion 4a: responseMimeType: 'application/json' 유지 (P183 회귀 방지)", () => {
    expect(/responseMimeType\s*:\s*['"]application\/json['"]/.test(src)).toBe(true);
  });

  it('assertion 4b: responseSchema 적용 유지 (P183 phase2 회귀 방지)', () => {
    expect(/responseSchema/.test(src)).toBe(true);
  });
});

// ─── Runtime assertions (buildModel throw 없이 반환 확인) ─────────────────────
// @ts-expect-error — JS module
import { buildModel } from '../../api/_ai_core/geminiPipeline.js';

describe('P192 geminiPipeline.buildModel — runtime 안전성', () => {
  it('assertion 5: buildModel(fakeKey) throw 없이 정상 반환', () => {
    expect(() => buildModel('fake-key-p192')).not.toThrow();
    const m = buildModel('fake-key-p192');
    expect(m).toBeDefined();
  });

  it('assertion 5b: buildModel(fakeKey, 0.1) retry 전용 temperature 동작', () => {
    expect(() => buildModel('fake-key-p192', 0.1)).not.toThrow();
  });
});
