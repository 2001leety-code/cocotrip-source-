/**
 * LLM 공급자 전환 (2026-10-13) — 자동 실행(CI/cron) 유료 호출 0 계약.
 *  - 요청 범위 mock: `x-llm-mock: 1` 헤더 + (ai-planner-full 은 admin-bypass 주문) → 공급자 mock.
 *  - 컨텍스트가 env(LLM_PROVIDER) 보다 우선한다.
 *  - CI 스크립트 4개는 REAL_LLM=1 이 아닌 한 항상 그 헤더를 보낸다 (소스 잠금).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wantsLlmMock, runWithLlmContext, getLlmContext, resolveLlmProvider, createLlmModel, LLM_MOCK_HEADER,
} from '../../api/_shared/llm/index.js';

const ROOT = join(__dirname, '..', '..');
const saved: Record<string, string | undefined> = {};
beforeEach(() => { saved.LLM_PROVIDER = process.env.LLM_PROVIDER; process.env.LLM_PROVIDER = 'claude'; process.env.ANTHROPIC_API_KEY = 'k'; });
afterEach(() => { if (saved.LLM_PROVIDER === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = saved.LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; });

describe('request-scoped mock context', () => {
  it('wantsLlmMock reads the x-llm-mock header (1 only)', () => {
    expect(LLM_MOCK_HEADER).toBe('x-llm-mock');
    expect(wantsLlmMock({ headers: { 'x-llm-mock': '1' } })).toBe(true);
    expect(wantsLlmMock({ headers: { 'x-llm-mock': '0' } })).toBe(false);
    expect(wantsLlmMock({ headers: {} })).toBe(false);
    expect(wantsLlmMock({})).toBe(false);
  });

  it('context provider overrides env for every role inside the callback, and only there', async () => {
    expect(resolveLlmProvider('main')).toBe('claude');
    await runWithLlmContext({ provider: 'mock' }, async () => {
      expect(resolveLlmProvider('main')).toBe('mock');
      expect(resolveLlmProvider('translate')).toBe('mock');
      const m = createLlmModel({}, { role: 'translate' });
      expect(m.provider).toBe('mock');
    });
    expect(resolveLlmProvider('main')).toBe('claude');
  });

  it('a context created with mockRequested only becomes mock after the handler flips provider (admin-bypass gate)', async () => {
    await runWithLlmContext({ mockRequested: true }, async () => {
      expect(resolveLlmProvider('main')).toBe('claude');
      getLlmContext().provider = 'mock'; // handlerCore does this once gate.isAdminBypass is confirmed
      expect(resolveLlmProvider('main')).toBe('mock');
    });
  });
});

describe('mock translate-plan shape', () => {
  it('echoes descriptive/transit arrays with a target-language marker (ja → kana present)', async () => {
    const prompt = `You are a professional travel guide translator. Translate the input into Japanese.

Input:
${JSON.stringify({ descriptive: ['경복궁 산책', '맛집 투어'], transit: ['2호선', '강남'] })}`;
    await runWithLlmContext({ provider: 'mock' }, async () => {
      const m = createLlmModel({}, { role: 'translate', stage: 'translate-plan' });
      const r = await m.generateContent(prompt);
      const out = JSON.parse(r.response.text());
      expect(out.descriptive).toHaveLength(2);
      expect(out.transit).toHaveLength(2);
      expect(JSON.stringify(out)).toMatch(/[぀-ゟ゠-ヿ]/);
      expect(out.descriptive[0]).toContain('경복궁 산책');
    });
  });
});

describe('CI scripts always send the mock header unless REAL_LLM=1', () => {
  const FILES = [
    'scripts/validate-planner.cjs',
    'scripts/validate-prod-regression.mjs',
    'scripts/mood-smoke.mjs',
    'tests/e2e/full-plan-translation-pdf.spec.ts',
  ];
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src).toMatch(/x-llm-mock/);
      expect(src).toMatch(/REAL_LLM/);
    });
  }
});
