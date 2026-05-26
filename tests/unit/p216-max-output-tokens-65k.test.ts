/**
 * P216 (2026-05-26): Gemini Flash maxOutputTokens 32K → 65K 회귀 차단.
 *
 * 배경:
 *   Gemini 2.5 Flash 공식 최대 한도 = 65,535 tokens (Google AI Docs).
 *   P214 까지 32,000 사용 = 공식 한도의 49% 만 활용.
 *   3 AI second opinion (Claude + GPT-thinking + Gemini) 합의:
 *     다도시 5일 plan 시 MAX_TOKENS finishReason 으로 truncation 지속 가능.
 *   P215 fix (finishReason 감지 + retry) 와 함께 한도 자체를 65K 로 올려
 *   retry 횟수 감소 + truncation 발생 근본 빈도 낮춤.
 *
 * fix:
 *   maxOutputTokens 32,000 → 65,535 (공식 한도 전체 활용).
 *
 * 비용 영향: Flash free tier → 0원 (output token 비용 없음).
 *   실제 출력 ~12K 토큰 수준이면 latency 동일.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// geminiPipeline.js 의 소스 텍스트를 직접 grep — buildModel() 이 Google API key 없이
// import 불가하므로 정적 검증 방식 사용. P200/P192/P214 test 와 동일 패턴.
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const PIPELINE_PATH = path.join(ROOT, 'api/_ai_core/geminiPipeline.js');
const pipelineSrc = readFileSync(PIPELINE_PATH, 'utf-8');

describe('P216 maxOutputTokens 65K 회귀 차단', () => {

  // ── 핵심: maxOutputTokens 값 검증 ────────────────────────────────────────

  it('P216-A1: buildModel generationConfig 의 maxOutputTokens 가 65535 이어야 함', () => {
    const match = pipelineSrc.match(/generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(\d+)/);
    expect(match, 'buildModel generationConfig 에 maxOutputTokens 없음').toBeTruthy();
    const tokenValue = Number(match![1]);
    expect(tokenValue).toBe(65535);
  });

  it('P216-A2: maxOutputTokens 가 32000 이하로 다운그레이드됐으면 실패 (P216 회귀 차단)', () => {
    // generationConfig 블록 내 maxOutputTokens: 32000 이하 값 = P216 rollback
    const downgradeRe = /generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(8000|12000|16000|24000|32000)\b/;
    expect(downgradeRe.test(pipelineSrc)).toBe(false);
  });

  it('P216-A3: maxOutputTokens 가 Gemini 2.5 Flash 공식 한도 65535 이내여야 함', () => {
    const match = pipelineSrc.match(/generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(\d+)/);
    expect(match, 'maxOutputTokens 파싱 불가').toBeTruthy();
    const tokenValue = Number(match![1]);
    // 공식 한도: 65,535 — 초과 설정 시 Gemini 오류 반환
    expect(tokenValue).toBeLessThanOrEqual(65535);
  });

  // ── P192 안전장치 보존 (thinkingBudget:0) ────────────────────────────────

  it('P216-B1: Flash thinkingBudget = 0 안전장치 보존 (P192 fix — thinking 토큰 competing 방지)', () => {
    expect(pipelineSrc).toMatch(/isFlash\s*\?\s*0\s*:/);
  });

  it('P216-B2: Pro thinkingBudget 가 0 이 아님 유지 (Flash 만 0, Pro 는 사고 추론 활성)', () => {
    // P217 (2026-05-26): Pro thinkingBudget 4000 → -1 (dynamic, Gemini 자율 결정).
    // Pro 가 0 이면 P192 fix 가 Pro 까지 잘못 적용된 회귀 — -1 또는 양수 허용.
    const match = pipelineSrc.match(/isFlash\s*\?\s*0\s*:\s*(-?\d+)/);
    expect(match, 'Pro thinkingBudget 값 파싱 불가').toBeTruthy();
    const proThinking = Number(match![1]);
    expect(proThinking).not.toBe(0);
  });

  // ── P200 propertyOrdering 보존 (P216 변경이 schema 에 영향 없는지) ────────

  it('P216-C1: PLAN_RESPONSE_SCHEMA propertyOrdering 8 key 보존 (P200 fix 손상 없음)', () => {
    const orderingMatch = pipelineSrc.match(/PLAN_RESPONSE_SCHEMA[\s\S]*?propertyOrdering:\s*\[([^\]]+)\]/);
    expect(orderingMatch, 'propertyOrdering 필드 없음').toBeTruthy();
    const orderingContent = orderingMatch![1];
    const requiredKeys = [
      'tour_title', 'vehicle', 'base_price_krw', 'arrival_guide',
      'days', 'departure_guide', 'daily_budget_summary', 't_money_recommended_load',
    ];
    for (const key of requiredKeys) {
      expect(orderingContent, `propertyOrdering 에 '${key}' 누락 — P200 회귀`).toMatch(
        new RegExp(`['"]${key}['"]`),
      );
    }
  });

  // ── P216 코멘트 존재 검증 ─────────────────────────────────────────────────

  it('P216-D1: P216 코멘트 (raise 이유 + Gemini 공식 한도 명시) 가 geminiPipeline.js 에 존재', () => {
    expect(pipelineSrc).toMatch(/P216/);
    expect(pipelineSrc).toMatch(/65[,_]?535/);
  });
});
