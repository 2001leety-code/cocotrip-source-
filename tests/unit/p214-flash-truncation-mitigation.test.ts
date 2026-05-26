/**
 * P214 (2026-05-26): Flash truncation mitigation — maxOutputTokens 24K→32K 회귀 차단.
 *
 * 배경:
 *   5/26 측정 cycle: Flash 5-day plan 요청 중 2/5 sample (40%) days=3 만 반환.
 *   raw length 47,597 chars (≈11,900 tokens) 지점에서 비결정적 잘림.
 *   maxOutputTokens 24K 에 훨씬 못 미치는데도 Flash 내부 token budget 소진으로 중단.
 *   외부 사례: Google AI Forum #81258 "Consistent truncation despite being under limits".
 *
 * fix:
 *   maxOutputTokens 24,000 → 32,000 raise.
 *   thinkingBudget:0 유지 (Flash thinking token competing 없음 — P192 안전장치 보존).
 *
 * 비용 영향: Flash free tier → 0원 (output token 비용 없음).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// geminiPipeline.js 의 소스 텍스트를 직접 grep — buildModel() 이 Google API key 없이
// import 불가하므로 정적 검증 방식 사용. P200/P192 test 와 동일 패턴.
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const PIPELINE_PATH = path.join(ROOT, 'api/_ai_core/geminiPipeline.js');
const pipelineSrc = readFileSync(PIPELINE_PATH, 'utf-8');

describe('P214 Flash truncation mitigation', () => {

  // ── 옵션 A: maxOutputTokens raise ────────────────────────────────────────

  it('P214-A1: PLAN_RESPONSE_SCHEMA 가 아닌 buildModel generationConfig 의 maxOutputTokens 가 32000 이상이어야 함', () => {
    // buildModel() 함수 내부에서 maxOutputTokens 를 설정하는 위치 확인.
    // generationConfig 블록 내 maxOutputTokens 값 추출.
    const match = pipelineSrc.match(/generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(\d+)/);
    expect(match, 'buildModel generationConfig 에 maxOutputTokens 없음').toBeTruthy();
    const tokenValue = Number(match![1]);
    expect(tokenValue).toBeGreaterThanOrEqual(32000);
  });

  it('P214-A2: maxOutputTokens 가 24000 으로 다운그레이드됐으면 실패 (P214 회귀 차단)', () => {
    // generationConfig 블록 내 maxOutputTokens: 24000 패턴 (24K 이하) 이 없어야 함.
    // 값이 24000 이면 P192 상태 = P214 fix 가 롤백된 것.
    const downgradeRe = /generationConfig\s*:\s*\{[\s\S]*?maxOutputTokens\s*:\s*(8000|12000|16000|24000)\b/;
    expect(downgradeRe.test(pipelineSrc)).toBe(false);
  });

  // ── P192 안전장치 보존 검증 ───────────────────────────────────────────────

  it('P214-B1: Flash thinkingBudget = 0 안전장치 보존 (P192 fix — thinking 토큰 competing 방지)', () => {
    // const isFlash = modelId.toLowerCase().includes('flash')
    // const thinkingBudget = isFlash ? 0 : ...
    // 이 패턴이 유지되어야 함 — thinking token 이 output budget 을 침범하지 않도록.
    expect(pipelineSrc).toMatch(/isFlash\s*\?\s*0\s*:/);
  });

  it('P214-B2: Pro thinkingBudget ≠ 0 (Flash 만 0, Pro 는 사고 추론 유지 — P217: -1 dynamic)', () => {
    // P217 (2026-05-26): 3 AI second opinion 합의. Gemini AI 직접 권고: thinkingBudget=0 비권장.
    // Pro 를 4000 → -1 (dynamic 기본값) 으로 변경. Flash 는 P192 고정(0).
    // 음수 포함한 패턴으로 파싱.
    const match = pipelineSrc.match(/isFlash\s*\?\s*0\s*:\s*(-?\d+)/);
    expect(match, 'Pro thinkingBudget 값 파싱 불가').toBeTruthy();
    const proThinking = Number(match![1]);
    // -1 (dynamic) 또는 양수 고정값 허용. 0 이면 Pro thinking 비활성 = 품질 저하.
    expect(proThinking).not.toBe(0);
  });

  // ── P200 propertyOrdering 보존 검증 (P214 변경이 schema 에 영향 없는지) ──

  it('P214-C1: PLAN_RESPONSE_SCHEMA propertyOrdering 8 key 보존 (P200 fix 손상 없음)', () => {
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

  it('P214-C2: PLAN_RESPONSE_SCHEMA required 3 key 보존 (days/arrival_guide/departure_guide)', () => {
    const reqMatch = pipelineSrc.match(/PLAN_RESPONSE_SCHEMA[\s\S]*?required:\s*\[([^\]]+)\]/);
    expect(reqMatch, 'required 배열 없음').toBeTruthy();
    const reqContent = reqMatch![1];
    expect(reqContent).toMatch(/'days'|"days"/);
    expect(reqContent).toMatch(/'arrival_guide'|"arrival_guide"/);
    expect(reqContent).toMatch(/'departure_guide'|"departure_guide"/);
  });

  // ── P214 코멘트 존재 검증 ─────────────────────────────────────────────────

  it('P214-D1: P214 코멘트 (raise 이유 + 외부 사례) 가 geminiPipeline.js 에 존재', () => {
    // 의도 박제 — P214 가 24K→32K raise 였음을 코드 히스토리에서 확인 가능.
    // P216 이후 실제 값은 65K — "32K" 는 코멘트로만 존재 (히스토리).
    expect(pipelineSrc).toMatch(/P214/);
    // P214 코멘트에 "32K" 또는 "32,000" 이 히스토리 코멘트로 존재해야 함
    expect(pipelineSrc).toMatch(/32K|32,000/);
  });
});
