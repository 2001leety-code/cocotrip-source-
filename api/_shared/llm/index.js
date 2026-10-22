// LLM 공급자 전환 (2026-10-13): 공용 LLM 모듈 — 모든 LLM 호출은 여기를 지난다.
//
//   createLlmModel(geminiStyleConfig, { role, stage?, timeoutMs? })
//     → { provider, modelId, generateContent, generateContentStream, startChat }  (Gemini SDK 모양)
//
// 공급자 선택 (2026-10-21 런타임 스위치): 요청 컨텍스트(mock) > 어드민 런타임 플래그 llm_use_claude
//   (true ⇒ claude, false ⇒ gemini — env 보다 우선, 양방향) > LLM_PROVIDER_<ROLE> > LLM_PROVIDER > 'gemini'.
//   플래그를 못 읽으면(어드민 DB 없음 — 유닛 테스트/CI) env 체인. 공급자는 첫 호출 때 정해진다(lazy).
//   Claude 생성 실패(키 없음 등) ⇒ 그 호출은 Gemini + 운영자 알림(llm-switch-claude-unavailable).
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
import { throttledTelegramAlert } from '../telegram-throttle.js';
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
 * 자동 실행(CI) 전용 헤더. 값 '1' 일 때만. 호출부가 자체 인증 게이트(admin-bypass / allowlist) 를
 * 통과한 뒤 컨텍스트 provider 를 'mock' 으로 바꾼다 — 헤더만으로 결제·권한을 우회하지 않는다.
 */
export const LLM_MOCK_HEADER = 'x-llm-mock';
export function wantsLlmMock(req) {
  const h = req && req.headers ? req.headers[LLM_MOCK_HEADER] : undefined;
  return String(Array.isArray(h) ? h[0] : (h || '')).trim() === '1';
}
/**
 * 핸들러 첫 줄에서 호출: 헤더가 있으면 이 요청의 비동기 체인 전체에 mockRequested 표시
 * (AsyncLocalStorage.enterWith — provider 전환은 게이트 통과 후 adoptLlmMock 이 한다).
 */
export function enterLlmMockContext(req) {
  llmContext.enterWith({ mockRequested: wantsLlmMock(req) });
}
/** 호출부가 자체 인증 게이트(admin-bypass 등)를 확인한 뒤 호출 — 이 요청의 모든 LLM 호출을 mock 으로. */
export function adoptLlmMock(reason) {
  const ctx = getLlmContext();
  if (!ctx.mockRequested) return false;
  ctx.provider = 'mock';
  console.log(`[llm] provider=mock for this request (${reason}) — 유료 호출 0`);
  return true;
}

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
 * Runtime switch (2026-10-21, operator): admin flag `llm_use_claude` decides the provider for every role —
 * true ⇒ 'claude', false ⇒ 'gemini' — above env LLM_PROVIDER / LLM_PROVIDER_<ROLE>. The request context
 * (mock for CI) still wins. When flags cannot be read (no admin DB, e.g. unit tests/CI) the env chain applies.
 */
export async function resolveRuntimeLlmProvider(role, { env = process.env, adminDb } = {}) {
  const ctx = getLlmContext();
  if (trim(ctx.provider)) return resolveLlmProvider(role, env); // ctx.provider is validated there
  const flag = await readLlmUseClaudeFlag(adminDb);
  if (flag === true) return 'claude';
  if (flag === false) return 'gemini';
  return resolveLlmProvider(role, env);
}
/**
 * @returns {Promise<boolean|null>} null when there is no admin DB. A Firestore read failure is answered by
 *   getRuntimeFlags with the whitelist default (false ⇒ Gemini, today's behaviour), not null.
 */
async function readLlmUseClaudeFlag(adminDb) {
  const db = adminDb === undefined ? safeDb() : adminDb;
  if (!db || typeof db.collection !== 'function') return null;
  try {
    const flags = await getRuntimeFlags(db);
    return flags.llm_use_claude === true;
  } catch { return null; }
}

/**
 * @param {string} role
 * @param {{geminiFallback?:string, isAdminBypass?:boolean, identifierForBucketing?:string, forceModelOverride?:string, env?:object}} [opts]
 */
export function resolveLlmModel(role, opts = {}) {
  return resolveLlmModelForProvider(resolveLlmProvider(role, opts.env || process.env), role, opts);
}

/** Model id for an explicit provider (the runtime switch may pick a provider other than the env chain). */
export function resolveLlmModelForProvider(provider, role, opts = {}) {
  const env = opts.env || process.env;
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
  if (!db || typeof db.collection !== 'function') return false; // 테스트 스텁 {} 등 — fail-open
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
  let count = 0;
  try {
    const ref = db.collection('llm_guard').doc(kstDay(now));
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
  const stage = ctx.stage || role;
  const timeoutMs = Number(ctx.timeoutMs) > 0 ? Number(ctx.timeoutMs) : (DEFAULT_TIMEOUT_MS[role] || 25_000);
  // Callers may pass the resolveLlmApiKey placeholder when env said claude; Gemini then needs the real key.
  const geminiKey = (ctx.apiKey && ctx.apiKey !== 'managed-by-llm-adapter') ? ctx.apiKey : env.GEMINI_API_KEY;
  // config.model is a Gemini id chosen by the caller (often from the env chain). Never hand a claude/mock id
  // to the Gemini SDK when the runtime switch forces Gemini.
  const configGeminiModel = config.model && !/^(claude|mock:)/i.test(String(config.model)) ? config.model : '';
  const modelFor = (provider) => (provider === 'gemini'
    ? (ctx.forceModelOverride || configGeminiModel || resolveLlmModelForProvider('gemini', role, { ...ctx, env }))
    : resolveLlmModelForProvider(provider, role, { ...ctx, env }));

  // Lazy provider (2026-10-21): decided on the first call (runtime flag), fixed for this model object after that.
  let state = null; // { provider, modelId, inner } — what is actually used
  let initPromise = null;

  const onUsage = (um, ms) => {
    const p = state ? state.provider : 'unresolved';
    const m = state ? state.modelId : 'unresolved';
    console.log(`[LLM_USAGE] provider=${p} role=${role} stage=${stage} model=${m} in=${um?.promptTokenCount || 0} out=${um?.candidatesTokenCount || 0} cached=${um?.cachedContentTokenCount || 0} ms=${ms || 0}`);
  };

  function geminiState() {
    const modelId = modelFor('gemini');
    return { provider: 'gemini', modelId, inner: createGeminiModel(config, { modelId, apiKey: geminiKey, onUsage }) };
  }

  async function build() {
    const provider = await resolveRuntimeLlmProvider(role, { env, adminDb: ctx._adminDb });
    if (provider === 'mock') {
      const modelId = modelFor('mock');
      return { provider, modelId, inner: createMockModel(config, { role, stage, modelId, onUsage }) };
    }
    if (provider === 'claude') {
      const modelId = modelFor('claude');
      try {
        const inner = createClaudeModel(config, {
          modelId, role, timeoutMs, onUsage, plannerRoles: PLANNER_ROLES,
          maxTokensCap: Number(env.LLM_MAX_TOKENS_CAP) > 0 ? Number(env.LLM_MAX_TOKENS_CAP) : 32000,
          client: ctx._client || claudeClient(env),
        });
        return { provider, modelId, inner };
      } catch (error) {
        console.error('[llm] claude unavailable, falling back to gemini:', error && error.message);
        throttledTelegramAlert({
          key: 'llm-switch-claude-unavailable',
          channel: 'admin',
          severity: 'high',
          message: [
            '⚠️ <b>AI 엔진 스위치: Claude 사용 불가 → Gemini 로 처리</b>',
            `role=${role} stage=${stage}`,
            `사유: ${String((error && error.message) || error).slice(0, 200)}`,
            '→ Vercel 의 ANTHROPIC_API_KEY 와 Claude 모델명을 확인하세요. 스위치를 끄면 알림이 멈춥니다.',
          ].join('\n'),
          context: { role, stage, source: 'llm-switch' },
        }).catch(() => {});
        return geminiState();
      }
    }
    return geminiState();
  }

  function init() {
    if (!initPromise) {
      initPromise = build().then(
        (s) => { state = s; return s; },
        (error) => { initPromise = null; throw error; }, // e.g. GEMINI_API_KEY missing — let a later call retry
      );
    }
    return initPromise;
  }

  // 가드: 킬스위치(전 공급자) → 일일 상한(실공급자만) → 호출.
  async function guard(provider) {
    if (await isLlmKillSwitchOn({ env, adminDb: ctx._adminDb })) throw new LlmBlockedError('LLM_DISABLED', 'LLM calls disabled by kill switch');
    if (provider !== 'mock') await checkDailyCallLimit({ env, adminDb: ctx._adminDb });
  }
  // Before the first call: the env-chain prediction. After it: what was actually used.
  const predict = (fn) => { try { return fn(); } catch { return 'unresolved'; } };

  return {
    get provider() { return state ? state.provider : predict(() => resolveLlmProvider(role, env)); },
    get modelId() { return state ? state.modelId : predict(() => modelFor(resolveLlmProvider(role, env))); },
    role,
    generateContent: async (...args) => { const s = await init(); await guard(s.provider); return s.inner.generateContent(...args); },
    generateContentStream: async (...args) => { const s = await init(); await guard(s.provider); return s.inner.generateContentStream(...args); },
    startChat: (args) => {
      let chat = null; // one chat per startChat(), created on the first sendMessage; it keeps the history
      return {
        sendMessage: async (...a) => {
          const s = await init();
          if (!chat) chat = s.inner.startChat(args);
          await guard(s.provider);
          return chat.sendMessage(...a);
        },
      };
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
