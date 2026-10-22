/**
 * LLM 공급자 전환 (2026-10-13): api/_shared/llm 공용 모듈 계약.
 *  - LLM_PROVIDER=claude|gemini|mock (+ 역할별 LLM_PROVIDER_<ROLE>), 기본 gemini(롤백 안전)
 *  - 모델: planner 역할(main/block) = CLAUDE_MODEL_PLANNER, 나머지 = CLAUDE_MODEL_DEFAULT
 *  - 반환 객체는 Gemini SDK 모양(generateContent / generateContentStream / startChat,
 *    response.text() / candidates[0].finishReason / usageMetadata) — 호출부 로직 불변.
 *  - 킬스위치(LLM_KILL_SWITCH=1 또는 런타임 플래그) / 일일 상한(LLM_DAILY_CALL_LIMIT)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Runtime switch tests (2026-10-21): the operator alert and the Gemini SDK are external boundaries — no network.
const alerts = vi.hoisted(() => ({ throttled: vi.fn(async (_a: { key: string; channel: string; severity: string; message: string }) => ({ ok: true })) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: alerts.throttled }));
const gem = vi.hoisted(() => ({
  models: [] as string[],
  generateContent: vi.fn(async () => ({ response: { text: () => 'gem', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } } })),
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(cfg: { model: string }) {
      gem.models.push(cfg.model);
      return { generateContent: gem.generateContent, generateContentStream: vi.fn(), startChat: vi.fn() };
    }
  },
}));

import {
  resolveLlmProvider, resolveLlmModel, createLlmModel, resolveRuntimeLlmProvider, runWithLlmContext,
  isLlmKillSwitchOn, checkDailyCallLimit, PLANNER_ROLES,
} from '../../api/_shared/llm/index.js';
import { buildClaudeRequest, claudeMessageToGeminiResponse } from '../../api/_shared/llm/claude.js';
import { __resetRuntimeFlagsCache } from '../../api/_shared/runtime-flags.js';

const ENV_KEYS = [
  'LLM_PROVIDER', 'LLM_PROVIDER_MAIN', 'LLM_PROVIDER_CHAT', 'CLAUDE_MODEL_DEFAULT', 'CLAUDE_MODEL_PLANNER',
  'LLM_KILL_SWITCH', 'LLM_DAILY_CALL_LIMIT', 'LLM_MAX_TOKENS_CAP', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL_OVERRIDE',
  'GEMINI_API_KEY',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('resolveLlmProvider', () => {
  it('defaults to gemini when nothing is set (rollback-safe)', () => {
    expect(resolveLlmProvider('main')).toBe('gemini');
  });
  it('honours LLM_PROVIDER globally and LLM_PROVIDER_<ROLE> per role', () => {
    process.env.LLM_PROVIDER = 'claude';
    expect(resolveLlmProvider('chat')).toBe('claude');
    process.env.LLM_PROVIDER_MAIN = 'mock';
    expect(resolveLlmProvider('main')).toBe('mock');
    expect(resolveLlmProvider('chat')).toBe('claude');
  });
  it('rejects unknown provider values', () => {
    process.env.LLM_PROVIDER = 'openai';
    expect(() => resolveLlmProvider('main')).toThrow(/LLM_PROVIDER/);
  });
});

describe('resolveLlmModel', () => {
  it('claude: planner roles use CLAUDE_MODEL_PLANNER (default sonnet), others CLAUDE_MODEL_DEFAULT (default haiku)', () => {
    process.env.LLM_PROVIDER = 'claude';
    expect(PLANNER_ROLES).toEqual(['main', 'block']);
    expect(resolveLlmModel('main')).toBe('claude-sonnet-5-5');
    expect(resolveLlmModel('block')).toBe('claude-sonnet-5-5');
    expect(resolveLlmModel('chat')).toBe('claude-haiku-5-5');
    process.env.CLAUDE_MODEL_PLANNER = 'claude-opus-5-5';
    process.env.CLAUDE_MODEL_DEFAULT = ' claude-sonnet-5-5 ';
    expect(resolveLlmModel('main')).toBe('claude-opus-5-5');
    expect(resolveLlmModel('translate')).toBe('claude-sonnet-5-5');
  });
  it('gemini: delegates known roles to resolveGeminiModel, unknown roles use the given fallback', () => {
    expect(resolveLlmModel('main')).toBe('gemini-2.5-pro');
    expect(resolveLlmModel('chat', { geminiFallback: 'gemini-2.5-flash' })).toBe('gemini-2.5-flash');
  });
  it('mock: returns mock:<role>', () => {
    process.env.LLM_PROVIDER = 'mock';
    expect(resolveLlmModel('chat')).toBe('mock:chat');
  });
});

describe('createLlmModel (mock provider) — Gemini-shaped surface', () => {
  beforeEach(() => { process.env.LLM_PROVIDER = 'mock'; });

  it('generateContent returns response.text() + candidates finishReason STOP + usageMetadata', async () => {
    const model = createLlmModel({ generationConfig: { maxOutputTokens: 100 } }, { role: 'chat' });
    expect(model.provider).toBe('mock');
    expect(model.modelId).toBe('mock:chat');
    const r = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      systemInstruction: { role: 'system', parts: [{ text: 'sys' }] },
    });
    expect(typeof r.response.text()).toBe('string');
    expect(r.response.candidates[0].finishReason).toBe('STOP');
    expect(r.response.candidates[0].content.parts[0].text).toBe(r.response.text());
    expect(r.response.usageMetadata.promptTokenCount).toBeGreaterThan(0);
    expect(r.response.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
    expect(r.response.usageMetadata.cachedContentTokenCount).toBe(0);
  });

  it('accepts a plain string prompt (translate-plan / telegram style)', async () => {
    const model = createLlmModel({}, { role: 'translate' });
    const r = await model.generateContent('translate this');
    expect(r.response.text().length).toBeGreaterThan(0);
  });

  it('generateContentStream yields chunks with text() and resolves a final response', async () => {
    const model = createLlmModel({}, { role: 'main' });
    const s = await model.generateContentStream({ contents: [{ role: 'user', parts: [{ text: '{"duration_days":1,"area":"seoul"}' }] }] });
    let acc = '';
    for await (const chunk of s.stream) acc += chunk.text();
    const final = await s.response;
    expect(acc).toBe(final.text());
    expect(final.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
  });

  it('startChat(history).sendMessage works (chat.js style)', async () => {
    const model = createLlmModel({ systemInstruction: 'sys' }, { role: 'chat' });
    const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: 'hi' }] }, { role: 'model', parts: [{ text: 'yo' }] }] });
    const r = await chat.sendMessage('next');
    expect(typeof r.response.text()).toBe('string');
  });

  it('logs one [LLM_USAGE] line per call', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = createLlmModel({}, { role: 'quick', stage: 'planner-quick' });
    await model.generateContent('x');
    const line = spy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[LLM_USAGE]'));
    spy.mockRestore();
    expect(line).toMatch(/provider=mock/);
    expect(line).toMatch(/role=quick/);
    expect(line).toMatch(/stage=planner-quick/);
    expect(line).toMatch(/in=\d+ out=\d+/);
  });
});

describe('kill switch', () => {
  it('LLM_KILL_SWITCH=1 blocks every provider with code LLM_DISABLED', async () => {
    process.env.LLM_PROVIDER = 'mock';
    process.env.LLM_KILL_SWITCH = '1';
    const model = createLlmModel({}, { role: 'chat' });
    await expect(model.generateContent('x')).rejects.toMatchObject({ code: 'LLM_DISABLED', statusCode: 503 });
    await expect(model.generateContentStream('x')).rejects.toMatchObject({ code: 'LLM_DISABLED' });
  });
  it('runtime flag llm_kill_switch=true blocks too (admin cockpit, no redeploy)', async () => {
    const fakeDb = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ llm_kill_switch: true }) }) }) }) };
    const { __resetRuntimeFlagsCache } = await import('../../api/_shared/runtime-flags.js' as string);
    __resetRuntimeFlagsCache();
    expect(await isLlmKillSwitchOn({ adminDb: fakeDb })).toBe(true);
    __resetRuntimeFlagsCache();
    expect(await isLlmKillSwitchOn({ adminDb: null })).toBe(false);
  });
});

describe('checkDailyCallLimit', () => {
  function fakeDb(start = 0) {
    const docs: Record<string, number> = {};
    return {
      _docs: docs,
      collection: (c: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: (c + '/' + id) in docs, data: () => ({ count: docs[c + '/' + id] }) }),
          set: async (d: { count?: unknown }) => { docs[c + '/' + id] = Number(d.count) || start; },
        }),
      }),
    };
  }
  it('increments llm_guard/<kstDay> and throws LLM_DAILY_LIMIT once over the limit', async () => {
    process.env.LLM_DAILY_CALL_LIMIT = '2';
    const db = fakeDb();
    const now = Date.UTC(2026, 9, 13, 3, 0, 0); // 2026-10-13 12:00 KST
    await checkDailyCallLimit({ adminDb: db, now });
    await checkDailyCallLimit({ adminDb: db, now });
    expect(db._docs['llm_guard/2026-10-13']).toBe(2);
    await expect(checkDailyCallLimit({ adminDb: db, now })).rejects.toMatchObject({ code: 'LLM_DAILY_LIMIT', statusCode: 503 });
  });
  it('default limit is 300 and missing db fails open', async () => {
    await expect(checkDailyCallLimit({ adminDb: null })).resolves.toMatchObject({ allowed: true, limit: 300 });
  });
});

describe('claude provider — request/response mapping (pure)', () => {
  it('maps system/messages/max_tokens/output_config and drops temperature + thinking', () => {
    const req = buildClaudeRequest({
      modelId: 'claude-sonnet-5-5',
      role: 'main',
      config: {
        systemInstruction: 'model-level sys',
        generationConfig: {
          temperature: 0.5, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 65535,
          responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', propertyOrdering: ['a'], properties: { a: { type: 'STRING' } }, required: ['a'] },
        },
      },
      request: {
        contents: [{ role: 'user', parts: [{ text: 'u1' }] }, { role: 'model', parts: [{ text: 'm1' }] }, { role: 'user', parts: [{ text: 'u2' }] }],
        systemInstruction: { role: 'system', parts: [{ text: 'request sys wins' }] },
      },
      maxTokensCap: 32000,
    });
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.system).toBe('request sys wins');
    expect(req.max_tokens).toBe(32000);
    expect(req.messages).toEqual([
      { role: 'user', content: 'u1' }, { role: 'assistant', content: 'm1' }, { role: 'user', content: 'u2' },
    ]);
    expect(req.output_config.format).toEqual({
      type: 'json_schema',
      schema: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } }, required: ['a'] },
    });
    expect(req.output_config.effort).toBe('medium');
    expect(req).not.toHaveProperty('temperature');
    expect(req).not.toHaveProperty('thinking');
  });

  it('non-planner roles get effort low, default max_tokens 4096 when unspecified, no output_config.format without schema', () => {
    const req = buildClaudeRequest({ modelId: 'claude-haiku-5-5', role: 'chat', config: {}, request: 'plain prompt', maxTokensCap: 32000 });
    expect(req.messages).toEqual([{ role: 'user', content: 'plain prompt' }]);
    expect(req.max_tokens).toBe(4096);
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.system).toBeUndefined();
  });

  it('per-call generationConfig overrides model-level (P215 expanded retry shape)', () => {
    const req = buildClaudeRequest({
      modelId: 'claude-sonnet-5-5', role: 'main',
      config: { generationConfig: { maxOutputTokens: 1000 } },
      request: { contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: { maxOutputTokens: 2000 } },
      maxTokensCap: 32000,
    });
    expect(req.max_tokens).toBe(2000);
  });

  it('claudeMessageToGeminiResponse maps text/stop_reason/usage', () => {
    const r = claudeMessageToGeminiResponse({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 },
      model: 'claude-sonnet-5-5',
    });
    expect(r.response.text()).toBe('{"a":1}');
    expect(r.response.candidates[0].finishReason).toBe('MAX_TOKENS');
    expect(r.response.candidates[0].content.parts).toEqual([{ text: '{"a":1}' }]);
    expect(r.response.usageMetadata).toEqual({ promptTokenCount: 140, candidatesTokenCount: 30, cachedContentTokenCount: 20, totalTokenCount: 170 });
    expect(claudeMessageToGeminiResponse({ content: [], stop_reason: 'end_turn', usage: {} }).response.candidates[0].finishReason).toBe('STOP');
    expect(claudeMessageToGeminiResponse({ content: [], stop_reason: 'refusal', usage: {} }).response.candidates[0].finishReason).toBe('SAFETY');
  });
});

describe('claude provider — end to end with injected client', () => {
  it('generateContent calls client.messages.create with timeout+signal and returns Gemini shape', async () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    type CreateParams = { model: string; max_tokens: number };
    type CreateOpts = { timeout?: number; signal?: AbortSignal };
    type ClaudeMessage = { content: { type: string; text: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; model: string };
    const create = vi.fn<(params: CreateParams, opts: CreateOpts) => Promise<ClaudeMessage>>(async () => ({
      content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 }, model: 'claude-haiku-5-5',
    }));
    const model = createLlmModel({ generationConfig: { maxOutputTokens: 50 } }, { role: 'translate', timeoutMs: 1234, _client: { messages: { create } } });
    expect(model.modelId).toBe('claude-haiku-5-5');
    const ac = new AbortController();
    const r = await model.generateContent('hi', { signal: ac.signal });
    expect(r.response.text()).toBe('hola');
    expect(create).toHaveBeenCalledTimes(1);
    const [params, opts] = create.mock.calls[0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(50);
    expect(opts.timeout).toBe(1234);
    expect(opts.signal).toBe(ac.signal);
  });

  it('generateContentStream consumes client.messages.stream text deltas and finalMessage', async () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const events = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"d' } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'nope' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ays":[]}' } },
    ];
    const streamObj = {
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e; },
      finalMessage: async () => ({ content: [{ type: 'text', text: '{"days":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 4 } }),
    };
    const stream = vi.fn(() => streamObj);
    const model = createLlmModel({}, { role: 'main', _client: { messages: { stream } } });
    const s = await model.generateContentStream({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] });
    let acc = '';
    for await (const c of s.stream) acc += c.text();
    expect(acc).toBe('{"days":[]}');
    const final = await s.response;
    expect(final.usageMetadata.promptTokenCount).toBe(9);
    expect(final.candidates[0].finishReason).toBe('STOP');
  });

  it('missing ANTHROPIC_API_KEY no longer throws at creation (lazy provider); the first call falls back to Gemini', async () => {
    process.env.LLM_PROVIDER = 'claude';
    expect(() => createLlmModel({}, { role: 'chat', _adminDb: null })).not.toThrow();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = createLlmModel({}, { role: 'chat', _adminDb: null });
    // No Gemini key in this test either → a config error, still before any network call.
    await expect(model.generateContent('x')).rejects.toThrow(/GEMINI_API_KEY/);
    err.mockRestore();
    expect(gem.generateContent).not.toHaveBeenCalled();
  });
});

describe('runtime engine switch (admin flag llm_use_claude)', () => {
  type FakeMessage = { content: { type: string; text: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };
  function claudeStub() {
    const create = vi.fn(async (_params: { model: string; messages: unknown[] }, _opts?: unknown): Promise<FakeMessage> => ({
      content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 },
    }));
    return { create, client: { messages: { create } } };
  }
  // admin_config/runtime_flags answers `flags`; llm_guard (daily limit) reads as empty and accepts writes.
  function flagsDb(flags: Record<string, unknown>) {
    return {
      collection: (c: string) => ({
        doc: () => ({
          get: async () => (c === 'admin_config' ? { exists: true, data: () => flags } : { exists: false, data: () => ({}) }),
          set: async () => {},
        }),
      }),
    };
  }
  beforeEach(() => {
    __resetRuntimeFlagsCache();
    alerts.throttled.mockClear();
    gem.generateContent.mockClear();
    gem.models.length = 0;
  });

  it('flag ON + env unset ⇒ Claude after the first call (getters: env prediction before, actual after)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { create, client } = claudeStub();
    const model = createLlmModel({}, { role: 'translate', _adminDb: flagsDb({ llm_use_claude: true }), _client: client });
    expect(model.provider).toBe('gemini');
    const r = await model.generateContent('hi');
    expect(r.response.text()).toBe('hola');
    expect(create).toHaveBeenCalledTimes(1);
    expect(gem.generateContent).not.toHaveBeenCalled();
    expect(model.provider).toBe('claude');
    expect(model.modelId).toBe('claude-haiku-5-5');
  });

  it('flag OFF outranks env LLM_PROVIDER=claude ⇒ Gemini, never handing a claude model id to the Gemini SDK', async () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-gemini';
    const db = flagsDb({ llm_use_claude: false });
    expect(await resolveRuntimeLlmProvider('translate', { adminDb: db })).toBe('gemini');
    const { create, client } = claudeStub();
    // apiKey = the resolveLlmApiKey placeholder a caller gets when env says claude.
    const model = createLlmModel({}, { role: 'translate', apiKey: 'managed-by-llm-adapter', _adminDb: db, _client: client });
    expect(model.provider).toBe('claude'); // env prediction before the first call
    const r = await model.generateContent('hi');
    expect(r.response.text()).toBe('gem');
    expect(create).not.toHaveBeenCalled();
    expect(model.provider).toBe('gemini');
    expect(model.modelId).toMatch(/^gemini/);
    expect(gem.models).toEqual([model.modelId]);
  });

  it('flags unavailable (no admin DB) ⇒ the env chain still applies (LLM_PROVIDER=claude ⇒ Claude)', async () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(await resolveRuntimeLlmProvider('chat', { adminDb: null })).toBe('claude');
    const { create, client } = claudeStub();
    const model = createLlmModel({}, { role: 'chat', _adminDb: null, _client: client });
    await model.generateContent('hi');
    expect(create).toHaveBeenCalledTimes(1);
    expect(model.provider).toBe('claude');
  });

  it('request context provider (mock) wins over flag ON', async () => {
    await runWithLlmContext({ provider: 'mock' }, async () => {
      const db = flagsDb({ llm_use_claude: true });
      expect(await resolveRuntimeLlmProvider('chat', { adminDb: db })).toBe('mock');
      const model = createLlmModel({}, { role: 'chat', _adminDb: db });
      await model.generateContent('x');
      expect(model.provider).toBe('mock');
      expect(model.modelId).toBe('mock:chat');
    });
    expect(alerts.throttled).not.toHaveBeenCalled();
  });

  it('flag ON but no ANTHROPIC_API_KEY ⇒ that call runs on Gemini, one throttled operator alert, no throw', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = createLlmModel({}, { role: 'translate', stage: 'translate-plan', _adminDb: flagsDb({ llm_use_claude: true }) });
    const r = await model.generateContent('hi');
    const usage = log.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[LLM_USAGE]'));
    err.mockRestore();
    log.mockRestore();
    expect(r.response.text()).toBe('gem');
    expect(model.provider).toBe('gemini');
    expect(alerts.throttled).toHaveBeenCalledTimes(1);
    const alert = alerts.throttled.mock.calls[0][0];
    expect(alert).toMatchObject({ key: 'llm-switch-claude-unavailable', channel: 'admin', severity: 'high' });
    expect(alert.message).toMatch(/ANTHROPIC_API_KEY/);
    // LLM_USAGE logs the provider actually used, not the creation-time prediction.
    expect(usage).toMatch(/provider=gemini/);
    expect(usage).toMatch(/model=gemini/);
  });

  it('startChat: one chat object per startChat(), created on the first sendMessage and reused (history kept)', async () => {
    const { create, client } = claudeStub();
    const model = createLlmModel({}, { role: 'chat', _adminDb: flagsDb({ llm_use_claude: true }), _client: client });
    const chat = model.startChat({ history: [] });
    expect(model.provider).toBe('gemini');
    expect(model.modelId).toBe('gemini-2.5-flash');
    await chat.sendMessage('one');
    await chat.sendMessage('two');
    expect(model.provider).toBe('claude');
    expect(model.modelId).toBe('claude-haiku-5-5');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'one' }, { role: 'assistant', content: 'hola' }, { role: 'user', content: 'two' },
    ]);
  });
});
