// LLM 공급자 전환 (2026-10-13): 공용 LLM 모듈 — 모든 LLM 호출은 여기를 지난다.
//
//   createLlmModel(geminiStyleConfig, { role, stage?, timeoutMs? })
//     → { provider, modelId, generateContent, generateContentStream, startChat }  (Gemini SDK 모양)
//
// 공급자 선택: LLM_PROVIDER_<ROLE> > LLM_PROVIDER > 'gemini'(기본 = 롤백 안전. 운영 전환은
//   Vercel 에 ANTHROPIC_API_KEY + LLM_PROVIDER=claude 등록 후).
// 모델: claude → main/block = CLAUDE_MODEL_PLANNER(기본 claude-sonnet-5-5), 나머지 = CLAUDE_MODEL_DEFAULT
//   (기본 claude-haiku-5-5). gemini → 기존 resolveGeminiModel 그대로.
// 비용 가드(계획서 ④): LLM_KILL_SWITCH=1 또는 런타임 플래그 llm_kill_switch → 전 공급자 503 LLM_DISABLED.
//   LLM_DAILY_CALL_LIMIT(기본 300/KST일) 초과 → 503 LLM_DAILY_LIMIT (mock 은 카운트 제외).
//   호출마다 [LLM_USAGE] 한 줄 로그. Firestore api_usage 기록은 기존 호출부 레코더가 담당.
// 요청 단위 mock(CI 가 운영을 때릴 때): runWithLlmContext({ provider: 'mock' }, fn) — AsyncLocalStorage.
import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { resolveGeminiModel } from '../../_ai_core/geminiModelResolver.js';
import { initAdminDb } from '../firebase-admin.js';
import { getRuntimeFlags } from '../runtime-flags.js';
import { createClaudeModel } from './claude.js';
import { createMockModel } from './mock.js';

export const PROVIDERS = ['claude', 'gemini', 'mock'];
export const PLANNER_ROLES = ['main', 'block'];
const GEMINI_RESOLVER_ROLES = ['main', 'block', 'classifier', 'translate', 'quick', 'course'];
const DEFAULT_TIMEOUT_MS = { main: 240_000, block: 60_000 };
const DEFAULT_DAILY_LIMIT = 300;

const llmContext = new AsyncLocalStorage();
/** 요청 범위 공급자 강제 (handlerCore 의 테스트 주문 mock 용). */
export function runWithLlmContext(ctx, fn) { return llmContext.run(ctx || {}, fn); }
export function getLlmContext() { return llmContext.getStore() || {}; }

/**
 * 호출부의 `apiKey` 인자/`apiKey required` 검사 호환용. gemini 공급자면 GEMINI_API_KEY(없으면 throw),
 * claude/mock 이면 자리표시 문자열(실제 키는 어댑터가 env 에서 직접 읽음).
 */
export function resolveLlmApiKey(role, env = process.env) {
  if (resolveLlmProvider(role, env) !== 'gemini') return 'managed-by-llm-adapter';
  const key = trim(env.GEMINI_API_KEY);
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  return key;
}

export class LlmBlockedError extends Error {
  constructor(code, message) { super(message); this.code = code; this.statusCode = 503; }
}

const trim = (v) => String(v || '').trim();

export function resolveLlmProvider(role, env = process.env) {
  const ctx = getLlmContext();
  const raw = trim(ctx.provider) || trim(env[`LLM_PROVIDER_${String(role || '').toUpperCase()}`]) || trim(env.LLM_PROVIDER) || 'gemini';
  const p = raw.toLowerCase();
  if (!PROVIDERS.includes(p)) throw new Error(`LLM_PROVIDER invalid: "${raw}" (allowed: ${PROVIDERS.join('|')})`);
  return p;
}

/**
 * @param {string} role
 * @param {{geminiFallback?:string, isAdminBypass?:boolean, identifierForBucketing?:string, forceModelOverride?:string, env?:object}} [opts]
 */
export function resolveLlmModel(role, opts = {}) {
  const env = opts.env || process.env;
  const provider = resolveLlmProvider(role, env);
  if (provider === 'mock') return `mock:${role}`;
  if (provider === 'claude') {
    if (PLANNER_ROLES.includes(role)) return trim(env.CLAUDE_MODEL_PLANNER) || 'claude-sonnet-5-5';
    return trim(env.CLAUDE_MODEL_DEFAULT) || 'claude-haiku-5-5';
  }
  if (opts.forceModelOverride) return opts.forceModelOverride;
  if (GEMINI_RESOLVER_ROLES.includes(role)) {
    return resolveGeminiModel(role, { isAdminBypass: opts.isAdminBypass, identifierForBucketing: opts.identifierForBucketing, _env: opts.env });
  }
  return opts.geminiFallback || 'gemini-2.5-flash';
}

/** 킬스위치: env 또는 어드민 런타임 플래그(재배포 없이 즉시). */
export async function isLlmKillSwitchOn({ env = process.env, adminDb } = {}) {
  if (trim(env.LLM_KILL_SWITCH) === '1' || trim(env.LLM_KILL_SWITCH).toLowerCase() === 'true') return true;
  const db = adminDb === undefined ? safeDb() : adminDb;
  if (!db) return false;
  try {
    const flags = await getRuntimeFlags(db);
    return flags.llm_kill_switch === true;
  } catch { return false; }
}

function kstDay(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 일일 호출 상한 — Firestore llm_guard/{kstDay}.count 증가 후 판정. DB 없음 = 통과(가용성 우선).
 * @returns {Promise<{allowed:true, count:number, limit:number}>}
 */
export async function checkDailyCallLimit({ env = process.env, adminDb, now = Date.now() } = {}) {
  const limit = Number(env.LLM_DAILY_CALL_LIMIT) > 0 ? Number(env.LLM_DAILY_CALL_LIMIT) : DEFAULT_DAILY_LIMIT;
  const db = adminDb === undefined ? safeDb() : adminDb;
  if (!db) return { allowed: true, count: 0, limit };
  const ref = db.collection('llm_guard').doc(kstDay(now));
  let count = 0;
  try {
    // ponytail: read-then-write (동시 요청 몇 건 누락 가능) — 상한 가드는 근사치면 충분. 정확 필요 시 transaction.
    const snap = await ref.get();
    count = (Number((snap && snap.exists && snap.data() || {}).count) || 0) + 1;
    await ref.set({ count, updatedAt: now }, { merge: true });
  } catch (e) {
    console.warn('[llm-guard] daily counter unavailable, allowing:', e && e.message);
    return { allowed: true, count: 0, limit };
  }
  if (count > limit) throw new LlmBlockedError('LLM_DAILY_LIMIT', `LLM daily call limit reached (${count}/${limit})`);
  return { allowed: true, count, limit };
}

function safeDb() { try { return initAdminDb('llm'); } catch { return null; } }

let _clientCache = null;
function claudeClient(env) {
  const apiKey = trim(env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured (LLM_PROVIDER=claude)');
  if (_clientCache && _clientCache.key === apiKey) return _clientCache.client;
  const client = new Anthropic({ apiKey, maxRetries: 2 }); // 429/5xx 지수 백오프 2회 = SDK 내장
  _clientCache = { key: apiKey, client };
  return client;
}

/**
 * @param {object} config  Gemini getGenerativeModel 설정 그대로 ({ model?, systemInstruction?, generationConfig? })
 * @param {object} ctx     { role, stage?, timeoutMs?, apiKey?(gemini), isAdminBypass?, identifierForBucketing?, forceModelOverride?, geminiFallback?, env?, _client?, _adminDb? }
 */
export function createLlmModel(config = {}, ctx = {}) {
  const env = ctx.env || process.env;
  const role = ctx.role || 'default';
  const provider = resolveLlmProvider(role, env);
  const modelId = provider === 'gemini'
    ? (ctx.forceModelOverride || config.model || resolveLlmModel(role, { ...ctx, env }))
    : resolveLlmModel(role, { ...ctx, env });
  const stage = ctx.stage || role;
  const timeoutMs = Number(ctx.timeoutMs) > 0 ? Number(ctx.timeoutMs) : (DEFAULT_TIMEOUT_MS[role] || 25_000);

  const onUsage = (um, ms) => {
    console.log(`[LLM_USAGE] provider=${provider} role=${role} stage=${stage} model=${modelId} in=${um?.promptTokenCount || 0} out=${um?.candidatesTokenCount || 0} cached=${um?.cachedContentTokenCount || 0} ms=${ms || 0}`);
  };

  let inner;
  if (provider === 'mock') inner = createMockModel(config, { role, modelId, onUsage });
  else if (provider === 'claude') {
    inner = createClaudeModel(config, {
      modelId, role, timeoutMs, onUsage, plannerRoles: PLANNER_ROLES,
      maxTokensCap: Number(env.LLM_MAX_TOKENS_CAP) > 0 ? Number(env.LLM_MAX_TOKENS_CAP) : 32000,
      client: ctx._client || claudeClient(env),
    });
  } else {
    inner = createGeminiModel(config, { modelId, apiKey: ctx.apiKey || env.GEMINI_API_KEY, onUsage });
  }

  // 가드: 킬스위치(전 공급자) → 일일 상한(실공급자만) → 호출.
  async function guard() {
    if (await isLlmKillSwitchOn({ env, adminDb: ctx._adminDb })) throw new LlmBlockedError('LLM_DISABLED', 'LLM calls disabled by kill switch');
    if (provider !== 'mock') await checkDailyCallLimit({ env, adminDb: ctx._adminDb });
  }
  const guarded = (fn) => async (...args) => { await guard(); return fn(...args); };

  return {
    provider, modelId, role,
    generateContent: guarded(inner.generateContent),
    generateContentStream: guarded(inner.generateContentStream),
    startChat: (args) => {
      const chat = inner.startChat(args);
      return { sendMessage: guarded(chat.sendMessage) };
    },
  };
}

/** Gemini 공급자 — 기존 SDK 그대로 (롤백 경로). usage 로그만 추가. */
function createGeminiModel(config, { modelId, apiKey, onUsage }) {
  const key = trim(apiKey);
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ ...config, model: modelId });
  const logFrom = (started) => (response) => { try { onUsage(response?.usageMetadata, Date.now() - started); } catch { /* ignore */ } };
  return {
    provider: 'gemini', modelId,
    async generateContent(request, opts) {
      const started = Date.now();
      const r = await model.generateContent(request, opts);
      logFrom(started)(r?.response);
      return r;
    },
    async generateContentStream(request, opts) {
      const started = Date.now();
      const s = await model.generateContentStream(request, opts);
      s.response.then(logFrom(started)).catch(() => {});
      return s;
    },
    startChat(args) {
      const chat = model.startChat(args);
      return {
        async sendMessage(message, opts) {
          const started = Date.now();
          const r = await chat.sendMessage(message, opts);
          logFrom(started)(r?.response);
          return r;
        },
      };
    },
  };
}
