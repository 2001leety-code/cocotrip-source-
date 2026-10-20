// LLM 공급자 전환 (2026-10-13): Claude 공급자 — @anthropic-ai/sdk 를 Gemini SDK 모양으로 감싼다.
// 호출부(geminiPipeline/blockMode/endpoints)는 response.text() · candidates[0].finishReason ·
// usageMetadata 만 보므로 그 모양을 그대로 돌려준다. 재시도(429/5xx 지수 백오프 2회)는 SDK 내장.
//
// Gemini 전용 설정 대응(계획서 ②):
//   temperature → 삭제 (Haiku/Sonnet 5.5 는 1 이외 400) · thinkingConfig → 삭제(adaptive 기본)
//   responseSchema → output_config.format json_schema · maxOutputTokens → max_tokens(상한 LLM_MAX_TOKENS_CAP)
import { geminiSchemaToJsonSchema } from './schema.js';

const STOP_MAP = { end_turn: 'STOP', stop_sequence: 'STOP', max_tokens: 'MAX_TOKENS', refusal: 'SAFETY' };

function partsText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content?.parts)) return content.parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
  if (Array.isArray(content)) return content.map(partsText).join('');
  return '';
}

/**
 * Gemini 요청(문자열 | {contents, systemInstruction?, generationConfig?}) → Claude messages.create 파라미터.
 * 순수 함수 — 테스트 가능.
 */
export function buildClaudeRequest({ modelId, role, config = {}, request, maxTokensCap, plannerRoles = ['main', 'block'] }) {
  const req = typeof request === 'string' ? { contents: [{ role: 'user', parts: [{ text: request }] }] } : (request || {});
  const gen = { ...(config.generationConfig || {}), ...(req.generationConfig || {}) };

  const systemText = partsText(req.systemInstruction) || partsText(config.systemInstruction);
  const messages = (req.contents || []).map((c) => ({
    role: c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user',
    content: partsText(c),
  }));

  const cap = Number(maxTokensCap) > 0 ? Number(maxTokensCap) : 32000;
  const wanted = Number(gen.maxOutputTokens) > 0 ? Number(gen.maxOutputTokens) : 4096;

  const out = {
    model: modelId,
    max_tokens: Math.min(wanted, cap),
    messages,
    output_config: { effort: plannerRoles.includes(role) ? 'medium' : 'low' },
  };
  if (systemText) out.system = systemText;
  if (gen.responseSchema) {
    out.output_config.format = { type: 'json_schema', schema: geminiSchemaToJsonSchema(gen.responseSchema) };
  }
  return out;
}

/** Claude Message → Gemini `generateContent` 반환 모양 ({ response }). */
export function claudeMessageToGeminiResponse(message) {
  const text = (message?.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const u = message?.usage || {};
  const cached = Number(u.cache_read_input_tokens) || 0;
  const prompt = (Number(u.input_tokens) || 0) + cached + (Number(u.cache_creation_input_tokens) || 0);
  const output = Number(u.output_tokens) || 0;
  const finishReason = STOP_MAP[message?.stop_reason] || (message?.stop_reason ? String(message.stop_reason).toUpperCase() : 'STOP');
  const response = {
    text: () => text,
    candidates: [{ finishReason, content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: output, cachedContentTokenCount: cached, totalTokenCount: prompt + output },
  };
  return { response };
}

/**
 * @param {object} config Gemini getGenerativeModel 설정 ({ model?, systemInstruction?, generationConfig? })
 * @param {object} ctx { modelId, role, client, timeoutMs, maxTokensCap, plannerRoles, onUsage }
 */
export function createClaudeModel(config, ctx) {
  const { modelId, role, client, timeoutMs, maxTokensCap, plannerRoles, onUsage } = ctx;
  const build = (request) => buildClaudeRequest({ modelId, role, config, request, maxTokensCap, plannerRoles });
  const reqOpts = (opts) => ({ timeout: timeoutMs, ...(opts && opts.signal ? { signal: opts.signal } : {}) });

  async function generateContent(request, opts) {
    const started = Date.now();
    const message = await client.messages.create(build(request), reqOpts(opts));
    const out = claudeMessageToGeminiResponse(message);
    onUsage && onUsage(out.response.usageMetadata, Date.now() - started);
    return out;
  }

  async function generateContentStream(request, opts) {
    const started = Date.now();
    const stream = client.messages.stream(build(request), reqOpts(opts));
    const chunkOf = (text) => ({ text: () => text, candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
    async function* iterate() {
      for await (const ev of stream) {
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) yield chunkOf(ev.delta.text);
      }
    }
    // response 는 stream 소진 후 resolve — Gemini SDK 와 동일한 사용 순서(for await → await response).
    let finalPromise = null;
    const responsePromise = () => (finalPromise ||= stream.finalMessage().then((m) => {
      const out = claudeMessageToGeminiResponse(m);
      onUsage && onUsage(out.response.usageMetadata, Date.now() - started);
      return out.response;
    }));
    return { stream: iterate(), get response() { return responsePromise(); } };
  }

  function startChat({ history = [] } = {}) {
    const hist = [...history];
    return {
      async sendMessage(message, opts) {
        const text = typeof message === 'string' ? message : partsText({ parts: Array.isArray(message) ? message : [message] });
        const contents = [...hist, { role: 'user', parts: [{ text }] }];
        const out = await generateContent({ contents }, opts);
        hist.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: out.response.text() }] });
        return out;
      },
    };
  }

  return { provider: 'claude', modelId, generateContent, generateContentStream, startChat };
}
