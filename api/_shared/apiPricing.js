// 외부 API 단가 SSOT — 사용량 트래커 비용 환산용.
// Gemini 단가 (per 1M tokens, USD). 단가 바뀌면 여기만 수정.
// 출처: 2026-06 비용 감사 + Google AI 공식. ⚠️ flash-lite 는 미확정(보수적 추정) — 운영자 확인 권장.
export const GEMINI_PRICING = {
  'gemini-2.5-pro':        { input: 1.25, output: 10.00, cached: 0.31 },
  'gemini-3.5-flash':      { input: 1.50, output: 9.00,  cached: 0.15 },
  'gemini-2.5-flash':      { input: 0.30, output: 2.50,  cached: 0.03 },
  'gemini-2.0-flash':      { input: 0.30, output: 2.50,  cached: 0.03 }, // 2.5-flash 동급 추정
  'gemini-3.5-flash-lite': { input: 0.10, output: 0.40,  cached: 0.025 }, // ⚠️ 미확정 추정
};

// 미등록 모델 보수적 기본값(과소집계 방지).
const DEFAULT_PRICE = { input: 1.0, output: 4.0, cached: 0.1 };

export function geminiUnitPrice(model) {
  return GEMINI_PRICING[model] || DEFAULT_PRICE;
}

/**
 * Gemini 사용량 → 예상 비용(USD).
 * @param {string} model
 * @param {{total:number, output:number, cached:number}} cm
 *   total=입력토큰 총합(cached 포함) · output=출력 · cached=캐시 히트(있으면 할인)
 * @returns {number} USD
 */
export function estimateGeminiCostUsd(model, cm) {
  const p = geminiUnitPrice(model);
  const total = Number(cm && cm.total) || 0;
  const cached = Number(cm && cm.cached) || 0;
  const output = Number(cm && cm.output) || 0;
  const uncached = Math.max(0, total - cached);
  return (uncached * p.input + cached * p.cached + output * p.output) / 1_000_000;
}

/**
 * api_usage 문서 배열 → 모델별 집계 + 총 비용. (모닝브리핑 표시용)
 * @param {Array<{model:string,input_tokens:number,output_tokens:number,cost_usd:number}>} docs
 */
export function aggregateApiUsage(docs) {
  const byModel = {};
  let totalUsd = 0;
  for (const d of docs || []) {
    const m = d.model || 'unknown';
    if (!byModel[m]) byModel[m] = { input: 0, output: 0, usd: 0 };
    byModel[m].input += Number(d.input_tokens) || 0;
    byModel[m].output += Number(d.output_tokens) || 0;
    byModel[m].usd += Number(d.cost_usd) || 0;
    totalUsd += Number(d.cost_usd) || 0;
  }
  return { byModel, totalUsd };
}
