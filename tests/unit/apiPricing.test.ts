import { describe, it, expect } from 'vitest';
import {
  estimateGeminiCostUsd,
  aggregateApiUsage,
  geminiUnitPrice,
} from '../../api/_shared/apiPricing.js';

describe('apiPricing — 사용량 트래커 비용 환산', () => {
  it('estimateGeminiCostUsd: Pro 입력+출력', () => {
    // gemini-2.5-pro: input 1.25, output 10. total=10000 input, output=12000
    const cost = estimateGeminiCostUsd('gemini-2.5-pro', { total: 10000, output: 12000, cached: 0 });
    // (10000*1.25 + 12000*10)/1e6 = 0.1325
    expect(cost).toBeCloseTo(0.1325, 4);
  });

  it('cached 토큰은 할인 단가 적용', () => {
    // total=10000(=uncached2000+cached8000), cached 0.31
    const cost = estimateGeminiCostUsd('gemini-2.5-pro', { total: 10000, cached: 8000, output: 0 });
    // (2000*1.25 + 8000*0.31)/1e6 = 0.00498
    expect(cost).toBeCloseTo(0.00498, 5);
  });

  it('미등록 모델 → 보수적 기본 단가', () => {
    expect(geminiUnitPrice('made-up-model').input).toBe(1.0);
  });

  it('aggregateApiUsage: 모델별 합산 + 총액', () => {
    const docs = [
      { model: 'gemini-2.5-pro', input_tokens: 1000, output_tokens: 2000, cost_usd: 0.02 },
      { model: 'gemini-2.5-pro', input_tokens: 500, output_tokens: 1000, cost_usd: 0.01 },
      { model: 'gemini-3.5-flash', input_tokens: 300, output_tokens: 400, cost_usd: 0.004 },
    ];
    const { byModel, totalUsd } = aggregateApiUsage(docs);
    expect(byModel['gemini-2.5-pro'].output).toBe(3000);
    expect(byModel['gemini-2.5-pro'].usd).toBeCloseTo(0.03, 5);
    expect(byModel['gemini-3.5-flash'].input).toBe(300);
    expect(totalUsd).toBeCloseTo(0.034, 5);
  });

  it('빈/널 입력 graceful', () => {
    expect(aggregateApiUsage([]).totalUsd).toBe(0);
    expect(aggregateApiUsage(null as never).totalUsd).toBe(0);
    expect(estimateGeminiCostUsd('gemini-2.5-pro', null as never)).toBe(0);
  });
});
