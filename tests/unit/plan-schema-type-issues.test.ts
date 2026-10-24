/**
 * 2026-10-24 — Claude 가 구조화 출력 없이(프롬프트 스키마, CLAUDE_STRUCTURED_OPTIONAL_LIMIT 초과) 답하는 경로에서
 * `{"days":{}}`·숫자 address 같은 자료형 오류 JSON 이 오면 파싱은 되지만 cleanAddresses/sanitizeStops 가 예외 → 일반 500.
 * schemaTypeIssues 로 정리 함수 전에 구조 오류로 받아 재시도 1회 → 그래도 깨지면 PLAN_VALIDATION_FAILED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordGeminiUsage: vi.fn(async () => {}), recordUsageFromResponse: vi.fn() }));
vi.mock('../../api/_ai_core/planPersister.js', () => ({ selfHealLodgingBookend: vi.fn(), updatePlanProgressive: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/sentry.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureError: vi.fn(async () => {}),
}));
vi.mock('../../api/_telegram.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendErrorAlert: vi.fn(async () => {}),
}));
vi.mock('../../api/_shared/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLlmModel: vi.fn(() => { throw new Error('LLM disabled in unit test'); }),
}));

import { schemaTypeIssues, geminiSchemaToJsonSchema } from '../../api/_shared/llm/schema.js';
import { PLAN_RESPONSE_SCHEMA, planSchemaTypeIssues, runGeminiPipeline } from '../../api/_ai_core/geminiPipeline.js';
import { createLlmModel } from '../../api/_shared/llm/index.js';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';

const SCHEMA = geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA);
const stop = (over: Record<string, unknown> = {}) => ({ name: 'A', category: 'culture', start_time: '10:00', address: '서울 종로구', ...over });
const plan = (over: Record<string, unknown> = {}) => ({
  days: [{ day: 1, stops: [stop(), stop({ name: 'B' }), stop({ name: 'C', address: 'x' })] }],
  arrival_guide: {}, departure_guide: {}, ...over,
});

describe('schemaTypeIssues (planner main schema)', () => {
  it('a well-typed plan → []', () => {
    expect(schemaTypeIssues(plan(), SCHEMA)).toEqual([]);
    expect(planSchemaTypeIssues(plan())).toEqual([]);
  });
  it('days as an object → exactly one issue', () => {
    expect(schemaTypeIssues(plan({ days: {} }), SCHEMA)).toEqual(['days: expected array, got object']);
  });
  it('nested numeric address → one issue with the full path', () => {
    const p = plan();
    (p.days[0].stops[2] as Record<string, unknown>).address = 12;
    expect(schemaTypeIssues(p, SCHEMA)).toEqual(['days[0].stops[2].address: expected string, got number']);
  });
  it('missing required → one issue', () => {
    const p = plan();
    delete (p as Record<string, unknown>).departure_guide;
    expect(schemaTypeIssues(p, SCHEMA)).toEqual(['departure_guide: required property missing']);
  });
  it('optional null is treated as absent; required null is a type issue', () => {
    expect(schemaTypeIssues(plan({ tour_title: null }), SCHEMA)).toEqual([]);
    expect(schemaTypeIssues(plan({ days: null }), SCHEMA)).toEqual(['days: expected array, got null']);
  });
  it('caps at 20 issues', () => {
    const p = plan({ days: [{ day: 1, stops: Array.from({ length: 30 }, () => stop({ address: 7 })) }] });
    const issues = schemaTypeIssues(p, SCHEMA);
    expect(issues).toHaveLength(20);
    expect(issues[0]).toBe('days[0].stops[0].address: expected string, got number');
  });
  it('root not an object (null / primitive / array); minimal fallback is skipped by planSchemaTypeIssues', () => {
    expect(schemaTypeIssues([], SCHEMA)).toEqual(['(root): expected object, got array']);
    expect(planSchemaTypeIssues(null)).toEqual(['(root): expected object, got null']);
    expect(planSchemaTypeIssues('text')).toEqual(['(root): expected object, got string']);
    expect(planSchemaTypeIssues(7)).toEqual(['(root): expected object, got number']);
    expect(planSchemaTypeIssues({ __repair_minimal_fallback: true, days: {} })).toEqual([]);
  });
});

// 2026-10-24 r3: 자료형 오류는 기존 구조 재시도(1회)의 오류 목록에 합쳐진다 — 최초 + 재시도 1 = 최대 2회 호출.
describe('runGeminiPipeline — type-broken response joins the existing structure retry (max 2 model calls)', () => {
  let systems: string[] = [];
  function queueModel(texts: string[]) {
    const queue = [...texts];
    const generateContent = vi.fn(async (req: { systemInstruction?: { parts?: { text?: string }[] } }) => {
      systems.push(String(req?.systemInstruction?.parts?.[0]?.text || ''));
      const text = queue.length > 0 ? String(queue.shift()) : '{"days":{}}';
      return { response: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] } };
    });
    vi.mocked(createLlmModel).mockImplementation((() => ({ generateContent, modelId: 'unit-test-model', provider: 'claude' })) as never);
  }
  type Err = { code?: string; statusCode?: number; details?: string[]; message?: string };
  const run = (mode = 'legacy', isAdminBypass = false) => runGeminiPipeline({
    apiKey: 'unit-test', systemPrompt: 'SYNTHETIC SYSTEM', userMessage: 'SYNTHETIC USER', area: 'seoul', language: 'en',
    mode, dietary: [], body: { area: 'seoul' }, isAdminBypass, adminDb: null, planId: null, identifierForBucketing: 'unit-test',
  } as never).then((v: unknown) => ({ ok: v as { itinerary?: { days?: unknown[] } } }), (e: unknown) => ({ err: e as Err }));
  const noCrash = (e: Err | undefined) => expect(String(e?.message)).not.toMatch(/is not a function|Cannot read|is not iterable|null/);
  const validPlan = () => JSON.stringify(buildMockPlan({ userText: 'X\n' + JSON.stringify({ duration_days: 1, area: 'seoul', regions: ['seoul'], diet_preferences: [], tour_start_time: '09:00' }) + '\n=== VARIATION ===' }));

  beforeEach(() => { systems = []; vi.stubEnv('PLANNER_STREAMING_ENABLED', ''); vi.stubEnv('PLANNER_PASS3_BACKGROUND', 'true'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('days object, then numeric address → exactly 2 calls, PLAN_VALIDATION_FAILED with the retry issues', async () => {
    queueModel(['{"days":{},"arrival_guide":{},"departure_guide":{}}', JSON.stringify(plan({ days: [{ day: 1, stops: [stop({ address: 5 })] }] }))]);
    const { err } = await run();
    expect(err).toMatchObject({ code: 'PLAN_VALIDATION_FAILED', statusCode: 500 });
    expect(err?.details).toEqual(['days[0].stops[0].address: expected string, got number']);
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain('days: expected array, got object'); // 같은 구조 재시도 프롬프트에 자료형 오류가 실린다
    noCrash(err);
  });

  it.each(['null', '"text"', '[]'])('top-level %s on every call → structure error after 2 calls, not an exception', async (raw) => {
    queueModel([raw, raw, raw, raw]);
    const { err } = await run();
    expect(err).toMatchObject({ code: 'PLAN_VALIDATION_FAILED' });
    expect(err?.details?.[0]).toMatch(/^\(root\): expected object, got /);
    expect(systems).toHaveLength(2);
    noCrash(err);
  });

  it('broken first answer, valid retry → succeeds with 2 calls (no extra structure retry)', async () => {
    queueModel(['{"days":{}}', validPlan(), '{"days":{}}']);
    const out = await run();
    expect(out.err).toBeUndefined();
    expect(systems).toHaveLength(2);
  });

  it('isAdminBypass does not soft-accept a type-broken plan (it cannot be cleaned or saved)', async () => {
    queueModel(['{"days":{}}', '{"days":{}}']);
    const { err } = await run('legacy', true);
    expect(err).toMatchObject({ code: 'PLAN_VALIDATION_FAILED' });
    expect(systems).toHaveLength(2);
  });

  it('3pass: type-broken pass1 answers → same structure error path, 2 calls, no crash in clean/pass2', async () => {
    queueModel(['{"days":{}}', '{"days":[{"day":1,"stops":[{"name":"A","category":"culture","start_time":"10:00","address":9}]}]}']);
    const { err } = await run('3pass');
    expect(err).toMatchObject({ code: 'PLAN_VALIDATION_FAILED' });
    expect(err?.details).toEqual(expect.arrayContaining(['days[0].stops[0].address: expected string, got number']));
    expect(systems).toHaveLength(2);
    noCrash(err);
  });
});
