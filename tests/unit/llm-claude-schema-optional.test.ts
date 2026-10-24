/**
 * 2026-10-24 — Claude 구조화 출력 400: "Schemas contains too many optional parameters (61) … (limit: 24)".
 * 플래너 메인 스키마(PLAN_RESPONSE_SCHEMA)는 선택 속성이 61개 — Claude 로 보낼 때는 전부 required + null 허용으로
 * 바꾸고(geminiSchemaToJsonSchema nullableOptionals), 응답의 null 키는 지워 Gemini 출력 모양으로 되돌린다.
 */
import { describe, it, expect } from 'vitest';
import { geminiSchemaToJsonSchema, stripNullKeys, stripNullKeysFromJsonText } from '../../api/_shared/llm/schema.js';
import { buildClaudeRequest, claudeMessageToGeminiResponse, createClaudeModel } from '../../api/_shared/llm/claude.js';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';

type Node = { type?: string | string[]; anyOf?: Node[]; properties?: Record<string, Node>; required?: string[]; items?: Node; enum?: unknown[]; additionalProperties?: boolean };

/** 모든 object 노드 방문(anyOf 안쪽 포함). */
function objects(node: Node | undefined, out: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return out;
  if (node.properties) out.push(node);
  for (const v of Object.values(node.properties || {})) objects(v, out);
  if (node.items) objects(node.items, out);
  for (const a of node.anyOf || []) objects(a, out);
  return out;
}
const acceptsNull = (n: Node) => (Array.isArray(n.type) && n.type.includes('null'))
  || (Array.isArray(n.anyOf) && n.anyOf.some((a) => a.type === 'null'));

describe('geminiSchemaToJsonSchema({ nullableOptionals: true }) — 실제 플래너 메인 스키마', () => {
  const original = JSON.parse(JSON.stringify(PLAN_RESPONSE_SCHEMA));
  const out = geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA, { nullableOptionals: true }) as Node;
  const objs = objects(out);

  it('선택 속성 0 — 모든 object 의 required 가 properties 키와 정확히 같다', () => {
    expect(objs.length).toBeGreaterThan(5);
    let optional = 0;
    for (const o of objs) {
      expect([...(o.required || [])].sort()).toEqual(Object.keys(o.properties || {}).sort());
      optional += Object.keys(o.properties || {}).filter((k) => !(o.required || []).includes(k)).length;
      expect(o.additionalProperties).toBe(false);
    }
    expect(optional).toBe(0);
  });

  it('원래 선택이던 속성만 null 허용, 원래 required 는 그대로(null 불가)', () => {
    const origObjs = objects(geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA) as Node);
    expect(origObjs).toHaveLength(objs.length);
    let nullableCount = 0;
    origObjs.forEach((o, i) => {
      const req = new Set(o.required || []);
      for (const k of Object.keys(o.properties || {})) {
        const conv = objs[i].properties![k];
        expect(acceptsNull(conv), k).toBe(!req.has(k));
        if (!req.has(k)) nullableCount += 1;
      }
    });
    expect(nullableCount).toBe(61); // 2026-10-24 실측 — 400 메시지의 숫자와 같다
  });

  it('원본 스키마 불변, 기본 호출(옵션 없음)은 기존 출력 그대로', () => {
    expect(PLAN_RESPONSE_SCHEMA).toEqual(original);
    const plain = geminiSchemaToJsonSchema(PLAN_RESPONSE_SCHEMA) as Node;
    expect(plain.required).toEqual(original.required);
    expect(JSON.stringify(plain)).not.toMatch(/"null"/);
  });

  it('claude 요청은 nullable 변환 스키마를 보낸다', () => {
    const req = buildClaudeRequest({
      modelId: 'claude-sonnet-5-5', role: 'main', maxTokensCap: 32000,
      config: { generationConfig: { responseSchema: PLAN_RESPONSE_SCHEMA } }, request: 'x',
    });
    expect(req.output_config.format.schema).toEqual(out);
  });
});

describe('nullable 형태 (합성)', () => {
  it('primitive = type 배열, enum·object·array = anyOf + null, 중첩 재귀', () => {
    const out = geminiSchemaToJsonSchema({
      type: 'OBJECT', required: ['a'],
      properties: {
        a: { type: 'STRING' },
        b: { type: 'NUMBER' },
        c: { type: 'STRING', enum: ['x', 'y'] },
        d: { type: 'OBJECT', properties: { e: { type: 'BOOLEAN' } } },
        f: { type: 'ARRAY', items: { type: 'OBJECT', required: ['g'], properties: { g: { type: 'INTEGER' }, h: { type: 'STRING' } } } },
      },
    }, { nullableOptionals: true });
    expect(out).toEqual({
      type: 'object', additionalProperties: false, required: ['a', 'b', 'c', 'd', 'f'],
      properties: {
        a: { type: 'string' },
        b: { type: ['number', 'null'] },
        c: { anyOf: [{ type: 'string', enum: ['x', 'y'] }, { type: 'null' }] },
        d: { anyOf: [{ type: 'object', additionalProperties: false, required: ['e'], properties: { e: { type: ['boolean', 'null'] } } }, { type: 'null' }] },
        f: { anyOf: [{ type: 'array', items: { type: 'object', additionalProperties: false, required: ['g', 'h'], properties: { g: { type: 'integer' }, h: { type: ['string', 'null'] } } } }, { type: 'null' }] },
      },
    });
  });
});

describe('stripNullKeys — 응답을 Gemini 모양으로', () => {
  it('중첩 객체의 null 키만 제거, 배열 요소 null·0·\'\'·false 는 보존, 원본 불변', () => {
    const input = { a: null, b: 0, c: '', d: false, e: { f: null, g: [null, 0, { h: null, i: 1 }] }, j: [] };
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(stripNullKeys(input)).toEqual({ b: 0, c: '', d: false, e: { g: [null, 0, { i: 1 }] }, j: [] });
    expect(input).toEqual(snapshot);
  });
  it('JSON 텍스트: 파싱되면 정리해 다시 문자열, 실패(잘림 등)면 원문 그대로', () => {
    expect(stripNullKeysFromJsonText('{"a":null,"b":{"c":null,"d":1}}')).toBe('{"b":{"d":1}}');
    expect(stripNullKeysFromJsonText('{"a":null,"b":')).toBe('{"a":null,"b":');
    expect(stripNullKeysFromJsonText('[null,1]')).toBe('[null,1]');
  });
  it('claudeMessageToGeminiResponse: 구조화 출력일 때만 null 키 제거', () => {
    const msg = { content: [{ type: 'text', text: '{"tip":null,"days":[{"theme":null,"stops":[]}]}' }], stop_reason: 'end_turn', usage: {} };
    expect(claudeMessageToGeminiResponse(msg, { stripNulls: true }).response.text()).toBe('{"days":[{"stops":[]}]}');
    expect(claudeMessageToGeminiResponse(msg).response.text()).toBe(msg.content[0].text);
  });
});

describe('createClaudeModel — 실제 호출 경로(가짜 client)', () => {
  const planText = '{"tour_title":"T","arrival_guide":null,"days":[{"day":1,"theme":null,"stops":[{"name":"A","tip":null}]}]}';
  const stripped = '{"tour_title":"T","days":[{"day":1,"stops":[{"name":"A"}]}]}';
  const message = { content: [{ type: 'text', text: planText }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
  const config = { generationConfig: { responseSchema: PLAN_RESPONSE_SCHEMA } };
  const fakeClient = (text: string) => ({
    messages: {
      create: async () => message,
      stream: () => {
        const events = [text.slice(0, 20), text.slice(20)].map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }));
        return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => message };
      },
    },
  });

  it('generateContent: 스키마 요청 응답의 null 키가 제거된다', async () => {
    const m = createClaudeModel(config, { modelId: 'claude-sonnet-5-5', role: 'main', client: fakeClient(planText), timeoutMs: 1000, maxTokensCap: 32000 });
    expect((await m.generateContent('x')).response.text()).toBe(stripped);
  });
  it('generateContentStream: 스키마 요청이면 모아서 정리한 1 chunk, final response 와 같은 텍스트', async () => {
    const m = createClaudeModel(config, { modelId: 'claude-sonnet-5-5', role: 'main', client: fakeClient(planText), timeoutMs: 1000, maxTokensCap: 32000 });
    const s = await m.generateContentStream('x');
    const chunks: string[] = [];
    for await (const c of s.stream) chunks.push(c.text());
    expect(chunks).toEqual([stripped]);
    expect((await s.response).text()).toBe(stripped);
  });
  it('스키마 없는 스트림은 기존처럼 delta 그대로 흘린다', async () => {
    const m = createClaudeModel({}, { modelId: 'claude-haiku-5-5', role: 'chat', client: fakeClient(planText), timeoutMs: 1000, maxTokensCap: 32000 });
    const s = await m.generateContentStream('x');
    const chunks: string[] = [];
    for await (const c of s.stream) chunks.push(c.text());
    expect(chunks).toEqual([planText.slice(0, 20), planText.slice(20)]);
  });
});
