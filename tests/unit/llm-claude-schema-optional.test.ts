/**
 * 2026-10-24 — Claude 구조화 출력 400 두 종류(플래너 메인 스키마, claude-sonnet-5-5):
 *   1차 "too many optional parameters (61) … (limit: 24)" / 2차(nullable 전환 후) "too many parameters with union types (61) … (limit: 16)".
 * 방침: 선택 속성이 CLAUDE_STRUCTURED_OPTIONAL_LIMIT(24) 를 넘는 스키마는 output_config.format 을 쓰지 않고
 *   스키마를 system 에 넣어 "JSON 만" 받는다. 작은 스키마는 기존 구조화 출력 그대로.
 */
import { describe, it, expect } from 'vitest';
import { geminiSchemaToJsonSchema, countOptionalProperties } from '../../api/_shared/llm/schema.js';
import { buildClaudeRequest, claudeMessageToGeminiResponse, createClaudeModel, CLAUDE_STRUCTURED_OPTIONAL_LIMIT } from '../../api/_shared/llm/claude.js';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';
import { repairAndParseJSON } from '../../api/_ai_core/responseValidator.js';

const build = (responseSchema: object, systemInstruction = 'SYS') => buildClaudeRequest({
  modelId: 'claude-sonnet-5-5', role: 'main', maxTokensCap: 32000,
  config: { systemInstruction, generationConfig: { responseSchema } }, request: 'x',
});

describe('countOptionalProperties', () => {
  it('counts properties not in required, recursively through objects, array items and anyOf', () => {
    expect(countOptionalProperties({
      type: 'object', required: ['a'],
      properties: {
        a: { type: 'string' },
        b: { type: 'object', properties: { c: { type: 'string' }, d: { type: 'string' } }, required: ['d'] },
        e: { type: 'array', items: { type: 'object', properties: { f: { type: 'string' } } } },
        g: { anyOf: [{ type: 'object', properties: { h: { type: 'string' } } }, { type: 'null' }] },
      },
    })).toBe(3 /* b,e,g */ + 1 /* c */ + 1 /* f */ + 1 /* h */);
    expect(countOptionalProperties({ type: 'string' })).toBe(0);
    expect(countOptionalProperties(null as unknown as object)).toBe(0);
  });
  it('planner main schema has 63 optional properties (61 in the 400 + stop.dietary_tags + stop.revisit 2026-10-24), well over the limit', () => {
    expect(CLAUDE_STRUCTURED_OPTIONAL_LIMIT).toBe(24);
    // 2026-10-24 재방문 정책: stop.revisit(BOOLEAN) 추가 → 62 → 63. 프롬프트 임베드 경로(24 초과)는 그대로.
    expect(countOptionalProperties(geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA))).toBe(63);
  });
});

describe('buildClaudeRequest — schema over the optional limit goes into the prompt, not output_config', () => {
  it('planner main schema: no output_config.format; system = original + JSON-only instruction + the converted schema JSON', () => {
    const req = build(PLAN_RESPONSE_SCHEMA);
    expect(req.output_config).toEqual({ effort: 'medium' });
    expect(req.output_config).not.toHaveProperty('format');
    const schemaJson = JSON.stringify(geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA));
    expect(req.system).toBe(`SYS\n\nReturn exactly one JSON object and nothing else (no markdown fences, no commentary). It must conform to this JSON Schema:\n${schemaJson}`);
  });
  it('no system instruction → the schema instruction alone (no leading blank lines)', () => {
    const req = buildClaudeRequest({ modelId: 'claude-sonnet-5-5', role: 'main', maxTokensCap: 32000, config: { generationConfig: { responseSchema: PLAN_RESPONSE_SCHEMA } }, request: 'x' });
    expect(req.system.startsWith('Return exactly one JSON object')).toBe(true);
  });
  it('small schema (optional ≤ 24): structured output as before, converter output unchanged byte-for-byte', () => {
    const small = { type: 'OBJECT', propertyOrdering: ['a', 'b'], required: ['a'], properties: { a: { type: 'STRING' }, b: { type: 'INTEGER' } } };
    const req = build(small);
    expect(req.system).toBe('SYS');
    expect(JSON.stringify(req.output_config.format)).toBe(JSON.stringify({
      type: 'json_schema',
      schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'integer' } }, additionalProperties: false },
    }));
  });
  it('exactly 24 optional → still structured; 25 → prompt', () => {
    const withOptional = (n: number) => ({ type: 'OBJECT', properties: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { type: 'STRING' }])) });
    expect(build(withOptional(24)).output_config.format).toBeDefined();
    expect(build(withOptional(25)).output_config.format).toBeUndefined();
  });
});

describe('response path — plain text, downstream repair', () => {
  it('claudeMessageToGeminiResponse returns the text unchanged (no null stripping)', () => {
    const text = '{"a":null,"b":1}';
    expect(claudeMessageToGeminiResponse({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }).response.text()).toBe(text);
  });
  it('a fenced JSON answer is still parsed by the downstream repairAndParseJSON', () => {
    const fenced = '```json\n{"tour_title":"T","days":[{"day":1,"stops":[]}]}\n```';
    const parsed = repairAndParseJSON(fenced);
    expect(parsed).toMatchObject({ tour_title: 'T', days: [{ day: 1 }] });
  });
  it('stream yields the deltas as-is (no buffering) for a schema request', async () => {
    const message = { content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    const client = {
      messages: {
        create: async () => message,
        stream: () => {
          const events = ['{"a"', ':1}'].map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }));
          return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => message };
        },
      },
    };
    const m = createClaudeModel({ generationConfig: { responseSchema: PLAN_RESPONSE_SCHEMA } }, { modelId: 'claude-sonnet-5-5', role: 'main', client, timeoutMs: 1000, maxTokensCap: 32000 });
    const s = await m.generateContentStream('x');
    const chunks: string[] = [];
    for await (const c of s.stream) chunks.push(c.text());
    expect(chunks).toEqual(['{"a"', ':1}']);
    expect((await s.response).text()).toBe('{"a":1}');
  });
});
