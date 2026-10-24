/**
 * LLM 공급자 전환 (2026-10-13): 가격표에 Claude 행 추가 + api_usage.service 가 모델 접두로 결정.
 * 단가 출처: platform.claude.com/docs/en/about-claude/pricing (2026-10-13 확인)
 *   haiku-5-5  $0.10 in / $0.50 out / cache read $0.01  (≤100K 프롬프트)
 *   sonnet-5-5 $2.00 in / $10.00 out / cache read $0.20  (2026-10-24 정정: $0.10 → $0.20)
 */
import { describe, it, expect } from 'vitest';
import { estimateGeminiCostUsd, geminiUnitPrice, serviceForModel } from '../../api/_shared/apiPricing.js';

describe('Claude pricing rows', () => {
  it('haiku 5.5 and sonnet 5.5 are priced from the official table', () => {
    expect(geminiUnitPrice('claude-haiku-5-5')).toEqual({ input: 0.10, output: 0.50, cached: 0.01 });
    expect(geminiUnitPrice('claude-sonnet-5-5')).toEqual({ input: 2.00, output: 10.00, cached: 0.20 });
  });
  it('cost formula applies to claude models (20K in, 8K out on sonnet ≈ $0.12)', () => {
    const usd = estimateGeminiCostUsd('claude-sonnet-5-5', { total: 20000, cached: 0, output: 8000 });
    expect(usd).toBeCloseTo(0.12, 3);
  });
  it('mock models cost 0', () => {
    expect(estimateGeminiCostUsd('mock:main', { total: 20000, cached: 0, output: 8000 })).toBe(0);
  });
});

describe('serviceForModel', () => {
  it('derives the api_usage.service label from the model id prefix', () => {
    expect(serviceForModel('claude-haiku-5-5')).toBe('claude');
    expect(serviceForModel('gemini-2.5-pro')).toBe('gemini');
    expect(serviceForModel('mock:chat')).toBe('mock');
    expect(serviceForModel(undefined)).toBe('gemini');
  });
});
