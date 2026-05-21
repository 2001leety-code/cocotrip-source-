/**
 * PR #P128 (2026-05-21) — intent-classifier-llm.ts (Gemini fallback) unit tests.
 *
 * Source: src/ai_planner/intent-classifier-llm.ts
 *
 * Validates:
 *   1. combineRuleAndLLMClassification — high-confidence rule-based bypasses LLM (cost saving)
 *   2. llmClassifyModification — empty input → no_change without API call
 *   3. llmClassifyModification — Gemini API mocked to return valid JSON → result parsed
 *   4. llmClassifyModification — Gemini API mocked to return malformed JSON → graceful no_change
 *   5. combineRuleAndLLMClassification — low-confidence rule-based + successful LLM → LLM result
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @google/generative-ai 모듈
const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => {
  // class 형태로 mock — new GoogleGenerativeAI(apiKey) 호출 호환.
  class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel() {
      return {
        generateContent: (...args: unknown[]) => mockGenerateContent(...args),
      };
    }
  }
  return { GoogleGenerativeAI: MockGoogleGenerativeAI };
});

import {
  llmClassifyModification,
  combineRuleAndLLMClassification,
} from '../../src/ai_planner/intent-classifier-llm';
import type { ClassifiedModification } from '../../src/ai_planner/intent-classifier';

describe('combineRuleAndLLMClassification', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('high-confidence rule-based skips LLM entirely (cost saving)', async () => {
    const rule: ClassifiedModification = {
      intent: 'stop_add',
      raw_text: 'N서울타워 추가',
      confidence: 0.85,
      target: { stop_name: 'N서울타워' },
    };
    const out = await combineRuleAndLLMClassification(rule, { apiKey: 'fake' });
    expect(out.intent).toBe('stop_add');
    expect((out as { source?: string }).source).toBe('rule');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('low-confidence rule-based + successful LLM → LLM result wins', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          intent: 'block_swap',
          target: { day_index: 2, block_id: 'SEOUL_DMZ' },
          confidence: 0.92,
        }),
      },
    });
    const rule: ClassifiedModification = {
      intent: 'no_change',
      raw_text: '2일차 DMZ 가고 싶어요',
      confidence: 0.3,
      fallback_reason: 'no keyword match',
    };
    const out = await combineRuleAndLLMClassification(rule, { apiKey: 'fake' });
    expect(out.intent).toBe('block_swap');
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.target?.day_index).toBe(2);
    expect((out as { source?: string }).source).toBe('llm');
  });

  it('LLM failure → falls back to rule-based gracefully', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));
    const rule: ClassifiedModification = {
      intent: 'stop_swap',
      raw_text: 'change',
      confidence: 0.4,
      fallback_reason: 'partial match',
    };
    const out = await combineRuleAndLLMClassification(rule, { apiKey: 'fake' });
    expect(out.intent).toBe('stop_swap');
    expect(out.confidence).toBeCloseTo(0.4);
    expect((out as { source?: string }).source).toBe('rule');
  });
});

describe('llmClassifyModification', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('empty input returns no_change without API call', async () => {
    const out = await llmClassifyModification('', { apiKey: 'fake' });
    expect(out.intent).toBe('no_change');
    expect(out.confidence).toBe(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('parses valid Gemini JSON response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          intent: 'stop_add',
          target: { day_index: 1, stop_name: 'N서울타워' },
          confidence: 0.78,
        }),
      },
    });
    const out = await llmClassifyModification('N서울타워 끼워주세요', { apiKey: 'fake' });
    expect(out.intent).toBe('stop_add');
    expect(out.target?.day_index).toBe(1);
    expect(out.target?.stop_name).toBe('N서울타워');
  });

  it('malformed JSON → graceful no_change', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not json {{}' },
    });
    const out = await llmClassifyModification('blah', { apiKey: 'fake' });
    expect(out.intent).toBe('no_change');
    expect(out.fallback_reason).toBe('llm_parse_failed');
  });

  it('invalid intent value sanitized to no_change', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ intent: 'evil_action', confidence: 1.0 }) },
    });
    const out = await llmClassifyModification('test', { apiKey: 'fake' });
    expect(out.intent).toBe('no_change');
  });

  it('clamps confidence to [0, 1]', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ intent: 'stop_add', confidence: 5.0 }) },
    });
    const out = await llmClassifyModification('test', { apiKey: 'fake' });
    expect(out.confidence).toBe(1);
  });
});
