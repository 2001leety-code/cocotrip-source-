/**
 * Gemini orchestration — runs the legacy single-pass OR the 3-pass pipeline,
 * applies validation + DB matcher, and returns a fully-resolved itinerary.
 *
 * Extracted from api/ai-planner-full.js to keep the handler under the
 * P1 size lock (500 lines). All side effects (logging, error mapping)
 * are preserved verbatim — this is a structural move, not behavior change.
 *
 * Failure modes:
 *   - Quota / 429 / RESOURCE_EXHAUSTED  → throws Error with code GEMINI_QUOTA, statusCode 503.
 *     Telegram alert fired before throw.
 *   - Timeout (>240s)                   → throws Error with code GEMINI_TIMEOUT, statusCode 504.
 *   - Other Gemini errors               → re-thrown with code GEMINI_ERROR if missing.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { repairAndParseJSON, cleanAddresses, sanitizeStops, validateResponse, hasCriticalDietaryViolation, validatePatternStructure, checkSoftQualityWarnings } from './responseValidator.js';
import { applyDBMatcher } from './dbMatcher.js';
import { captureError } from '../_shared/sentry.js';
import { pass1Intent, pass2Resolve, pass3Enrich } from './threePassPipeline.js';
import { sendErrorAlert } from '../_telegram.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { selfHealLodgingBookend, updatePlanProgressive } from './planPersister.js';

// ────────────────────────────────────────────────────────────────────────────
// P169 (2026-05-23): Gemini Streaming + 점진 Firestore Write
//
// PLANNER_STREAMING_ENABLED=true 시:
//   - legacy 1-pass: generateContent → generateContentStream
//   - chunks 받는 동안 partial JSON repair → Firestore 점진 write (0.5초 간격)
//   - handlerCore 가 planId 를 먼저 Firestore 에 skeleton 저장 후 response 반환
//   - 프론트엔드 onSnapshot (이미 사용 중) 이 자동으로 점진 update 감지
//
// ENV FLAG: PLANNER_STREAMING_ENABLED=true (default: false → 기존 흐름 100% 보장)
// ROLLBACK: Vercel Dashboard 에서 false 또는 삭제 → 즉시 rollback
// ────────────────────────────────────────────────────────────────────────────

/**
 * P169: streaming 모드 활성 여부.
 * env flag 'true' (대소문자 무관) 일 때만 활성.
 * default false — 기존 흐름 100% 보장 (rollback 보장).
 */
export function isStreamingEnabled() {
  return String(process.env.PLANNER_STREAMING_ENABLED || '').trim().toLowerCase() === 'true';
}

// ────────────────────────────────────────────────────────────────────────────
// P195 (2026-05-25): Gemini implicit cache metadata instrumentation
//
// Phase 0 — explicit caching 도입 전 prod hit rate 측정. Gemini 2.5+ implicit
// caching 이 2025-05 부터 자동 활성화 → 우리 prompt prefix 가 일관되면 cached
// token 자동 사용. usageMetadata.cachedContentTokenCount 로 hit 검증.
//
// 측정 결과 (1주일 prod log grep [P195 CACHE_METRICS]) 에 따라:
//   - hit rate > 70%: explicit caching 도입 ROI 낮음 → P-pattern 보류 권장
//   - hit rate < 30%: explicit caching 도입 진행 → Phase 1 PR 후속
// ────────────────────────────────────────────────────────────────────────────

/**
 * P195: Gemini response 에서 cache metadata 추출.
 *
 * Gemini SDK 의 usageMetadata 구조:
 *   - promptTokenCount: input 토큰 총합
 *   - cachedContentTokenCount: implicit/explicit cache hit 토큰 (없으면 0)
 *   - candidatesTokenCount: output 토큰
 *
 * @param {object} response  Gemini SDK response (result.response 또는 streamResult.response)
 * @returns {{cached:number, total:number, output:number}}
 */
export function extractCacheMetadata(response) {
  const um = response?.usageMetadata || {};
  return {
    cached: Number(um.cachedContentTokenCount) || 0,
    total: Number(um.promptTokenCount) || 0,
    output: Number(um.candidatesTokenCount) || 0,
  };
}

/**
 * P195: 누적 cache metadata 합산 — retry / multi-pass 케이스 대응.
 * @param {{cached:number,total:number,output:number}|null} acc
 * @param {{cached:number,total:number,output:number}|null} next
 * @returns {{cached:number,total:number,output:number}}
 */
export function accumulateCacheMetadata(acc, next) {
  const a = acc || { cached: 0, total: 0, output: 0 };
  if (!next) return a;
  return {
    cached: a.cached + (next.cached || 0),
    total: a.total + (next.total || 0),
    output: a.output + (next.output || 0),
  };
}

/**
 * P195: cache metadata Vercel logs 한 줄 출력 — grep `[P195 CACHE_METRICS]`.
 * @param {string} stage  호출 단계 라벨 (예: 'legacy' / 'streaming' / 'retry-dietary')
 * @param {{cached:number,total:number,output:number}} cm
 */
export function logCacheMetrics(stage, cm) {
  if (!cm || cm.total === 0) return;
  const hitRate = cm.total > 0 ? (cm.cached / cm.total * 100).toFixed(1) : '0';
  console.log(`[P195 CACHE_METRICS] stage=${stage} cached=${cm.cached} total=${cm.total} hit_rate=${hitRate}% output=${cm.output}`);
}

// ────────────────────────────────────────────────────────────────────────────
// P219 (2026-05-26): Gemini thinking 모드 thought part 필터 — 보안 critical
//
// 배경 (3 AI second opinion 합의 fix #2 — Gemini AI 직접 권고):
//   - Gemini 2.5 / 3.x thinking 모델은 candidates[0].content.parts[] 에
//     `{thought: true, text: "내부 추론..."}` 메타 part 를 섞어 반환할 수 있음.
//   - SDK 의 `response.text()` 는 *모든* parts 의 text 를 단순 concat —
//     thought 필터링하지 않음 (공식 docs 확인: EnhancedGenerateContentResponse.text
//     "Returns the text string assembled from all Parts of the first candidate").
//   - 결과: thought text 가 우리 JSON 파싱 입력에 섞임 → 파싱 실패 / 모델
//     내부 chain-of-thought 가 사용자에게 노출 (Raw Logic Leak).
//
// 위험 등급:
//   - 보안: 시스템 prompt 단서 / 모델 사고 과정이 prod plan 응답에 leak.
//   - 기능: thought + JSON 혼재 → repairAndParseJSON 실패 → P181 minimal fallback.
//   - Compliance: 내부 system instruction 노출 = prompt injection 단서 제공.
//
// fix:
//   - extractTextFromResponse(response): candidates[0].content.parts 순회,
//     `part.thought === true` 인 part 는 skip. 남은 TextPart 만 concat.
//   - extractTextFromChunk(chunk): streaming chunk 도 동일 — chunk.text() 우회.
//   - thought-only response (예: thinking budget 소진) → 빈 문자열 반환
//     (호출자가 기존 empty-string fallback 으로 분기 — 안전).
//
// 출처 (deep-search):
//   - Gemini 공식 example: `for part in response.candidates[0].content.parts:
//     if part.thought: # 메타-thought / else: # 최종 답변`
//     (googlecloudplatform/generative-ai gemini/getting-started/intro_gemini_2_5_flash_lite.ipynb 등 다수)
//   - JS SDK 의 part shape 동일 (TextPart + thought boolean).
//   - 3 AI 합의: Gemini AI 가 직접 "thought=true part 가 응답 본문에 섞임" 권고.
//
// 안전 보장:
//   - thought 가 없는 일반 응답 (Flash 기본) = 기존 `response.text()` 와 동일.
//   - thought 만 있는 case = 빈 문자열 (호출자가 empty fallback) — 기존 throw 동작 유지.
//   - parts shape 누락 / 비정상 = catch → response.text() fallback (backward-compat).
// ────────────────────────────────────────────────────────────────────────────

/**
 * P219: Gemini response 에서 thought:true part 를 제외한 순수 text 만 추출.
 *
 * @param {object} response  Gemini SDK response (result.response 또는 awaited streamResult.response)
 * @returns {string}  thought 제외된 text concat. parts 누락 시 response.text() fallback.
 */
export function extractTextFromResponse(response) {
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      let out = '';
      let droppedThought = false;
      for (const part of parts) {
        // P219: thought:true → 메타-추론, 응답 본문 아님. 절대 concat 금지 (보안).
        if (part && part.thought === true) {
          droppedThought = true;
          continue;
        }
        if (part && typeof part.text === 'string') {
          out += part.text;
        }
      }
      if (droppedThought) {
        console.log('[P219 THOUGHT_FILTER] dropped thought:true part(s) from response');
      }
      return out;
    }
    // parts shape 없음 → SDK 의 response.text() 로 fallback (backward-compat).
    if (typeof response?.text === 'function') {
      return response.text();
    }
    return '';
  } catch (e) {
    // 비정상 response shape → SDK fallback 시도 (절대 throw 안 함).
    try {
      return typeof response?.text === 'function' ? response.text() : '';
    } catch {
      return '';
    }
  }
}

/**
 * P219: streaming chunk 에서 thought:true part 를 제외한 text 만 추출.
 *
 * Gemini streaming chunk 도 candidates[0].content.parts[] 구조 동일 —
 * chunk.text() 는 모든 parts concat (thought 포함). 보안 critical 분기에는
 * 본 helper 사용 의무.
 *
 * @param {object} chunk  streamResult.stream async iterator 의 1개 chunk
 * @returns {string}  thought 제외된 chunk text. parts 누락 시 chunk.text() fallback.
 */
export function extractTextFromChunk(chunk) {
  try {
    const parts = chunk?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      let out = '';
      for (const part of parts) {
        if (part && part.thought === true) continue; // P219: thought skip
        if (part && typeof part.text === 'string') out += part.text;
      }
      return out;
    }
    if (typeof chunk?.text === 'function') {
      return chunk.text();
    }
    return '';
  } catch {
    try {
      return typeof chunk?.text === 'function' ? chunk.text() : '';
    } catch {
      return '';
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// P201 (2026-05-26): Pro escalate on P181 minimal fallback
//
// 배경: P200 (propertyOrdering + required) 후에도 P181 minimal fallback ~4건/5분 잔여.
// root cause: Flash long output 한계 (5-day 다도시 plan 의 일부 case schema/JSON 준수 실패).
// fix: P181 발동 시 Pro 2.5 escalate retry (ENV gate + circuit breaker).
//
// 비용 시뮬레이션 (deep-search 2026-05-26 Agent B):
//   - 최악 $115/day (전부 escalate × success) = $3,450/월
//   - circuit breaker 5분 5건 cap → 일별 max $144/day = $4,300/월
//   - 운영자 base $175/월 → 9-20x 폭증 가능 — ENV default OFF 안전 의무
//
// 출처: LiteLLM Router fallback pattern + GitHub Issues (browser-use #3491 / gemini-cli #2104).
// ────────────────────────────────────────────────────────────────────────────

/**
 * P201: Pro escalate 활성 여부. ENV `P181_PRO_ESCALATE_ENABLED=true` 일 때만 활성.
 * default OFF — 머지 자체 영향 0. 활성화 = 운영자 비용 confirm 후 명시.
 */
export function isProEscalateEnabled() {
  return String(process.env.P181_PRO_ESCALATE_ENABLED || '').trim().toLowerCase() === 'true';
}

// P201: instance-local circuit breaker (5분 window).
const PRO_ESCALATE_WINDOW_MS = 5 * 60 * 1000;
const _proEscalateTimestamps = [];

export function __resetProEscalateCircuitForTests() {
  _proEscalateTimestamps.length = 0;
}

export function recordProEscalateAttempt(type) {
  const now = Date.now();
  _proEscalateTimestamps.push({ ts: now, type });
  while (_proEscalateTimestamps.length && now - _proEscalateTimestamps[0].ts > PRO_ESCALATE_WINDOW_MS) {
    _proEscalateTimestamps.shift();
  }
}

/**
 * P201: circuit breaker — 5분 N건 cap 도달 시 escalate 차단 (비용 폭주 방지).
 * @returns {boolean} true = circuit broken (escalate 차단)
 */
export function checkProEscalateCircuit() {
  const cap = Number(process.env.P181_PRO_ESCALATE_CAP_5MIN) || 5;
  const now = Date.now();
  while (_proEscalateTimestamps.length && now - _proEscalateTimestamps[0].ts > PRO_ESCALATE_WINDOW_MS) {
    _proEscalateTimestamps.shift();
  }
  return _proEscalateTimestamps.length >= cap;
}

/**
 * P201: P181 minimal fallback 감지 시 Pro 2.5 escalate retry.
 * 성공 시 정상 itinerary (no minimal flag) 반환, 실패 시 null.
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.systemPrompt
 * @param {string} args.userMessage
 * @param {boolean} [args.isAdminBypass]
 * @param {string} [args.identifierForBucketing]
 * @returns {Promise<object|null>}
 */
export async function tryProEscalate({ apiKey, systemPrompt, userMessage, isAdminBypass, identifierForBucketing }) {
  const proModelId = process.env.P181_PRO_ESCALATE_MODEL || 'gemini-2.5-pro';
  // P201: forceModelOverride 로 resolver 우회 — Flash → Pro 강제.
  // temperature 0.3 = Pro instruction following + 약간의 variance (deep-search 권고).
  const proModel = buildModel(apiKey, 0.3, { forceModelOverride: proModelId, isAdminBypass, identifierForBucketing });
  recordProEscalateAttempt('start');
  console.log(`[P201] Pro escalate triggered — model=${proModelId}`);
  const result = await withTimeout(
    proModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    }),
    GEMINI_TIMEOUT_MS,
    'pro-escalate-p201',
  );
  // P219: thought:true part 필터 — Raw Logic Leak / 파싱 실패 방어 (보안).
  const proRaw = extractTextFromResponse(result.response).trim();
  const proItinerary = repairAndParseJSON(proRaw);
  if (proItinerary && !proItinerary.__repair_minimal_fallback) {
    // Pro success — cache metadata + response 부착 (호출자 추출)
    Object.defineProperty(proItinerary, '_proResponse', { value: result.response, enumerable: false });
    return proItinerary;
  }
  return null;
}

/**
 * P169 / P204: 누적 텍스트에서 best-effort partial JSON parse.
 * days[] 배열이 하나 이상 완성됐을 때만 의미있는 결과 반환 (null 반환 otherwise).
 *
 * P204 (2026-05-26): repairAndParseJSON 호출 제거 — partial chunk 마다 호출 시
 *   minimal fallback alert (responseValidator.js:949 fire-and-forget) 가 0.5초 마다
 *   trigger 됐음. streaming 1 user = 60-80 chunk = 60-80 alert fire → Firestore atomic
 *   count++ → "직전 5분 누적 102건" false positive 폭증 (실제 P181 발동 ~2-5건).
 *
 * P204 fix: inline lightweight extract (_tryExtractPartialDays) — alert fire 없음.
 *   완성 JSON 만 parse 시도, partial 은 balanced bracket counting 으로 days[] 추출.
 *
 * @param {string} accumulated  현재까지 수신한 텍스트
 * @returns {{ days: Array }|null}  days 배열 포함 partial object, 없으면 null
 */
export function tryParsePartialJSON(accumulated) {
  if (!accumulated || accumulated.length < 20) return null;
  try {
    // 1. 완성 JSON 먼저 시도
    const obj = JSON.parse(accumulated);
    if (obj && Array.isArray(obj.days) && obj.days.length > 0) return obj;
    return null;
  } catch {
    // 2. P204: inline lightweight partial extract — alert fire 없음 (repairAndParseJSON 호출 X)
    return _tryExtractPartialDays(accumulated);
  }
}

/**
 * P204 (2026-05-26): partial chunk 전용 days[] 추출 — alert fire 없음.
 *
 * repairAndParseJSON 의 minimal fallback alert flood 방지 (5분당 60-80건 → 0건).
 *
 * 로직:
 *   - `"days": [` 부터 시작
 *   - balanced bracket counting 으로 완성된 day object 만 JSON.parse 시도
 *   - 완성 day 1개 이상 = return { days: [...] }, 없으면 null
 *   - malformed day 는 silent skip
 *
 * @param {string} accumulated
 * @returns {{ days: Array }|null}
 */
export function _tryExtractPartialDays(accumulated) {
  const startIdx = accumulated.search(/"days"\s*:\s*\[/);
  if (startIdx < 0) return null;
  const arrayOpen = accumulated.indexOf('[', startIdx);
  if (arrayOpen < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  const completedDays = [];
  let dayStart = -1;

  for (let i = arrayOpen + 1; i < accumulated.length; i++) {
    const ch = accumulated[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) dayStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && dayStart >= 0) {
        const dayJson = accumulated.slice(dayStart, i + 1);
        try {
          const day = JSON.parse(dayJson);
          if (day && (day.day !== undefined || day.stops !== undefined)) {
            completedDays.push(day);
          }
        } catch {
          // best-effort: skip malformed day
        }
        dayStart = -1;
      }
    } else if (ch === '[' && depth > 0) {
      depth++;
    } else if (ch === ']' && depth > 0) {
      depth--;
    } else if (ch === ']' && depth === 0) {
      break; // array 종료
    }
  }

  return completedDays.length > 0 ? { days: completedDays } : null;
}

/**
 * P169: Gemini generateContentStream 호출 + 점진 Firestore write.
 * legacy 1-pass 전용 (3-pass 의 pass1Intent 는 별도 streaming 필요 — 추후 Phase 2).
 *
 * @param {object} args
 * @param {object} args.model          buildModel() 반환 model instance
 * @param {string} args.systemPrompt   system instruction
 * @param {string} args.userMessage    최종 user 메시지
 * @param {object} [args.adminDb]      Firestore admin (progressive write 용)
 * @param {string} [args.planId]       skeleton planId (progressive write 용)
 * @param {string} [args.language]     언어 코드 (현재 unused, 향후 확장용)
 * @returns {string}  최종 accumulated text (repairAndParseJSON 직접 호출 가능)
 */
export async function runGeminiStreaming({ model, systemPrompt, userMessage, adminDb, planId, language }) {
  let accumulated = '';
  let lastFirestoreUpdate = 0;
  const FIRESTORE_UPDATE_INTERVAL_MS = 500;
  // P267 (2026-05-29): chunk loop 안에서 usageMetadata 누적 — Pro streaming SDK 의 final response
  // usageMetadata=null bug 우회 (Google AI Forum #79312 — 2.5-pro-preview / 3.5-pro 동일 패턴).
  // P266 진단: prod plan faab8777 의 itinerary._cache_metadata=undefined 원인 = finalResponse.usageMetadata=null
  // → extractCacheMetadata={0,0,0} → logCacheMetrics total=0 skip → [P195 CACHE_METRICS] log 0건.
  // fix: chunk 의 usageMetadata 가 not null 이면 last 값 저장 → final null 시 fallback.
  let lastChunkUsageMetadata = null;

  console.log('[geminiPipeline P169] Starting generateContentStream...');
  const streamStart = Date.now();

  const streamResult = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
  });

  for await (const chunk of streamResult.stream) {
    // P219: thought:true part 필터 — streaming 시 thought 가 partial JSON 에 섞이면 progressive Firestore write 에 leak. 보안 critical.
    const chunkText = extractTextFromChunk(chunk);
    if (chunkText) accumulated += chunkText;

    // P267: chunk-level usageMetadata 가 있으면 last 값 보관 (Pro streaming final null bug 우회).
    if (chunk?.usageMetadata) lastChunkUsageMetadata = chunk.usageMetadata;

    // 0.5초 간격으로 partial JSON parse + Firestore update (best-effort)
    const now = Date.now();
    if (adminDb && planId && (now - lastFirestoreUpdate) > FIRESTORE_UPDATE_INTERVAL_MS) {
      const partial = tryParsePartialJSON(accumulated);
      if (partial && Array.isArray(partial.days) && partial.days.length > 0) {
        // fire-and-forget — streaming 중단 방지
        updatePlanProgressive(adminDb, planId, {
          'itinerary.days': partial.days,
          _streaming_progress: partial.days.length,
        }).catch((e) => console.warn('[geminiPipeline P169] progressive update failed:', e.message));
        lastFirestoreUpdate = now;
      }
    }
  }

  console.log('[geminiPipeline P169] Stream complete. Elapsed:', Date.now() - streamStart, 'ms. Accumulated:', accumulated.length, 'chars');

  // P195/P267: stream 완료 후 cache metadata 추출 — final response 우선, fallback chunk-level.
  let cacheMetadata = { cached: 0, total: 0, output: 0 };
  let source = 'final';
  try {
    const finalResponse = await streamResult.response;
    cacheMetadata = extractCacheMetadata(finalResponse);
    // P267: final usageMetadata 가 null/0 인데 chunk-level 이 있으면 fallback (Pro streaming bug).
    if (cacheMetadata.total === 0 && lastChunkUsageMetadata) {
      cacheMetadata = extractCacheMetadata({ usageMetadata: lastChunkUsageMetadata });
      source = 'chunk-fallback';
    }
    logCacheMetrics(`streaming-${source}`, cacheMetadata);
  } catch (e) {
    console.warn('[geminiPipeline P195] streaming cache metadata extract failed:', e.message);
    // P267: final await throw 시도 chunk-level fallback.
    if (lastChunkUsageMetadata) {
      cacheMetadata = extractCacheMetadata({ usageMetadata: lastChunkUsageMetadata });
      logCacheMetrics('streaming-chunk-fallback-on-error', cacheMetadata);
    }
  }

  return { text: accumulated, cacheMetadata };
}

const GEMINI_TIMEOUT_MS = 240000;

// 2026-04-28 Flash → Pro: instruction following + JSON schema 압도적, thinking budget 8K→32K.
// Plan당 비용 ~$0.02 → ~$0.10 (결제 $9.90 대비 1%).
//
// 2026-05-09 (B9-15 fix, batch 9 PR-I): temperature 0.7 → 0.5.
// LODGING BOOKEND 같은 강한 제약 (첫/마지막 stop 5km 이내) 의 instruction
// following 정확도를 우선. 다양성은 약간 ↓ 하지만 사용자 환불 사유 (숙소
// 흐름 누락) 회피가 더 중요. 다양성은 'angle' rotation + variation_seed 로
// 보조 (buildPrompt.js).
//
// PR #461 (Audit X-H2 — 2026-05-16): retry 전용 model 분리. 기존엔 retry
// 도 동일 temperature=0.5 → variance 가 같아 retry 가 같은 violation 으로
// 다시 fail → 추가 quota 소모. retry 는 reinforced prompt 가 이미 명시
// 지시를 강화하므로 deterministic 한 temperature=0.1 로 호출 → 첫 retry
// 성공률 ↑ → 평균 Gemini quota 사용량 ↓. 회귀 시 빠르게 운영자가 알 수
// 있도록 instance-local 5분 window retry 카운터 + threshold 초과 시
// throttledTelegramAlert 추가.
const RETRY_TEMPERATURE = 0.1;
const RETRY_RATE_WINDOW_MS = 5 * 60 * 1000; // 5min
const RETRY_RATE_THRESHOLD = 10; // 5분당 10건 초과 시 1회 alert

import { resolveGeminiModel } from './geminiModelResolver.js';

/**
 * P168 (2026-05-23): Pass3 background flag.
 *
 * default false (안전 — legacy 동작 유지).
 * 활성화 시 사용자 응답 -30~60초 단축 (Pass3 = Gemini 추가 호출 1회 분리).
 * tip 은 background 가 Firestore set merge 후 onSnapshot 으로 자동 화면 갱신.
 *
 * 회귀 시 ENV PLANNER_PASS3_BACKGROUND= (empty) 또는 'false' 로 즉시 legacy 동작.
 * 운영자 액션: Vercel ENV PLANNER_PASS3_BACKGROUND=true 설정 → 효과 측정.
 */
export function isPass3BackgroundEnabled() {
  return String(process.env.PLANNER_PASS3_BACKGROUND || '').trim().toLowerCase() === 'true';
}

/**
 * Gemini model 인스턴스 생성.
 *
 * @param {string} apiKey
 * @param {number} [temperatureOverride]
 * @param {object} [opts]
 * @param {boolean} [opts.isAdminBypass] - P171 (2026-05-23): admin Test Mode 만
 *   GEMINI_ADMIN_BYPASS_MODEL env 우선 (운영자 Pro→Flash 품질 비교용).
 *   미지정 시 기존 동작 (P135 Pro 유지). backward-compat 100%.
 */
export function buildModel(apiKey, temperatureOverride, opts = {}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  // 2026-05-21 P135: 2.5 Pro → resolveGeminiModel('main') default 3.5 Flash.
  // ENV GEMINI_MAIN_MODEL=gemini-3.5-pro 로 Pro 유지 가능 (운영자 명시).
  // P171 (2026-05-23): isAdminBypass=true 일 때 GEMINI_ADMIN_BYPASS_MODEL 우선.
  // P201 (2026-05-26): forceModelOverride 명시 시 resolver 우회 (Pro escalate 용).
  const modelId = opts.forceModelOverride || resolveGeminiModel('main', { isAdminBypass: opts.isAdminBypass, identifierForBucketing: opts.identifierForBucketing });

  // P192 (2026-05-25): Flash vs Pro thinkingBudget 분기.
  // Flash 는 thinking 이 maxOutputTokens 안에서 차감 → thinkingBudget > 0 + maxOutputTokens 16K
  // = "thinking 만으로 output cap 소진" 상황 → responseSchema null 반환 → repair throw.
  // (GitHub Issue #609/#2062/#1039 — deep-search 확인).
  // Pro 도 thinkingBudget 32K + maxOutputTokens 16K 충돌 가능 (thinking 토큰이 output 침범).
  // 해결:
  //   Flash → thinkingBudget: 0 (thinking 완전 비활성 — 출력 안전, P192 고정)
  //   Pro   → thinkingBudget: -1 (dynamic 기본값 — Gemini 자율 결정, P217 fix)
  //            P217 (2026-05-26): 3 AI second opinion 합의. Gemini AI 직접 권고:
  //            thinkingBudget=0 은 비권장/불안정. -1 = dynamic (Gemini 자율 결정).
  //            4000 → -1 변경. maxOutputTokens 65K 상한으로 output 침범 위험 제어.
  //   maxOutputTokens: 65535 (P216 raise: 32K→65K — Gemini 2.5 Flash 공식 한도 최대)
  const isFlash = modelId.toLowerCase().includes('flash');
  const thinkingBudget = isFlash ? 0 : -1;

  return genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: typeof temperatureOverride === 'number' ? temperatureOverride : 0.5,
      thinkingConfig: { thinkingBudget },
      // P164 (2026-05-23): 32K→12K. 5-day plan JSON 실측 평균 2-5K 토큰 — 32K 할당은
      // generation overhead. 12K = safety margin 2x.
      // P181 (2026-05-24) raise: 12K→16K. 측정 후 INVALID_JSON 발생 (오늘 3건 = 3-5%).
      // 다도시 5-day Halal/Meat + 자세한 tip → 12K 근접 가능. 운영자 zero-tolerance
      // 강조 ("플랜 만들었을때 오류 1도없이"). 16K = 단도시 4x / 다도시 5-day 2x 안전.
      // P192 (2026-05-25) raise: 16K→24K. Flash thinkingBudget:0 fix 와 함께
      // 다도시 edge case 1.5x 안전마진. truncated JSON -80% 예상.
      // P214 (2026-05-26) raise: 24K→32K. 5/26 측정 결과 47,597 chars (≈11,900 tokens)
      // 잘림 — cap (24K) 에 못 미치는데도 비결정적 truncation 발생 (Google AI Forum #81258).
      // 32K = 실측 peak 11.9K 의 2.7x → Flash 내부 "token budget 여유" 인지 개선 기대.
      // thinkingBudget=0 유지 (thinking 토큰 competing 없음) → 비용 영향: Flash free tier 0.
      // P216 (2026-05-26) raise: 32K→65K. Gemini 2.5 Flash 공식 최대 한도 = 65,535 tokens
      // (Google AI Docs: https://ai.google.dev/gemini-api/docs/models).
      // 3 AI second opinion (Claude + GPT-thinking + Gemini) 합의: 절반만 사용 중 →
      // 다도시 5일 plan 시 MAX_TOKENS truncation 지속 가능성. 65K = 공식 상한 전체 활용.
      // latency 영향: Flash free tier — 비용 0. 실제 출력 ~12K 토큰이면 latency 동일.
      maxOutputTokens: 65535,
      responseMimeType: 'application/json',
      // P183 phase 2 (2026-05-24): Gemini responseSchema — typed validation 강제.
      // 운영자 "회귀법칙도 해놨는데 그래도 못 잡네" 메타 lesson: prompt-only 회귀
      // 차단 한계. responseSchema = Gemini 측에서 JSON structure 강제 → wrong-field
      // / missing required / type mismatch 자동 reject. INVALID_JSON 추가 차단 layer.
      //
      // Lenient 설계: top-level (days required) + days[] (day/stops required) +
      // stops[] (name/category/start_time required). 다른 field optional —
      // Gemini 가 추가 field 출력 OK. 점진 strict 화 가능.
      responseSchema: PLAN_RESPONSE_SCHEMA,
    },
  });
}

/**
 * P183 phase 2 (2026-05-24): Minimal Gemini responseSchema.
 *
 * 운영자 zero-tolerance 강조 + prompt-only 회귀 차단 한계 인정 — Gemini API 의
 * typed validation 으로 추가 강화. lenient (필수 field 만 strict, 다른 field
 * optional). 점진 strict 화 가능 (필요 시 expand).
 *
 * 형식: OpenAPI Subset (Gemini 2.5 Pro 지원). type 대문자 (OBJECT/ARRAY/STRING/INTEGER/NUMBER).
 */
const PLAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  // P291 (2026-05-29): properties hint 확장 — P276+P277 의도 (arrival_guide.steps /
  //   daily_budget_summary 통째 누락 차단) 의 cache miss 0 대안.
  //   buildPrompt 변경 0 (Gemini implicit cache prefix 변경 0). P210-A 패턴 nested 확장.
  //   required 추가 X (P196 회귀 root cause = Flash "satisfy required, then stop" 회피).
  //
  // Phase 0 baseline (2026-05-29, 189 plan/7일):
  //   - daily_budget_self_healed 22.71/day (84.1% plans) — R3 ARM
  //   - arrival_guide_self_healed 17.14/day (63.5% plans) — R1 ARM
  //   - P181 minimal_fallback 0% — 회귀 monitoring base 양호
  //
  // P200 (2026-05-25): propertyOrdering + required (P196 회귀 rollback 후 진짜 fix).
  //
  // fix (deep-search 2026-05-29):
  //   R1: arrival_guide.properties.steps array hint + nested propertyOrdering
  //   R2: departure_guide 7 fields + 3 nested OBJECT 확장 (대칭성)
  //   R3: daily_budget_summary.items 6 NUMBER fields hint
  //   R4: days.items 확장 (date + nested propertyOrdering + lodging/intercity_transit)
  //   R5: stops.items propertyOrdering 추가
  //
  // 출처: Google AI Dev structured output docs / Google blog 2.5+ ordering / Firebase AI
  //   Logic docs (default optional) / langchain-google #1020 / gemini-cli #2104.
  // truncation 안전: maxOutputTokens 24K + schema bytes ~+800B (2-3% 증가).
  // cache 영향: 0 (schema 는 generationConfig.responseSchema, prompt body 별개).
  propertyOrdering: [
    'tour_title',
    'vehicle',
    'base_price_krw',
    'arrival_guide',
    'days',
    'departure_guide',
    'daily_budget_summary',
    't_money_recommended_load',
  ],
  required: ['days', 'arrival_guide', 'departure_guide'],
  properties: {
    tour_title: { type: 'STRING' },
    vehicle: { type: 'STRING' },
    base_price_krw: { type: 'NUMBER' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        // P291 R4: nested propertyOrdering 추가 + date hint + lodging/intercity_transit nested 확장.
        propertyOrdering: ['day', 'date', 'city', 'theme', 'lodging', 'intercity_transit', 'stops'],
        required: ['day', 'stops'],
        properties: {
          day: { type: 'INTEGER' },
          date: { type: 'STRING' },
          city: { type: 'STRING' },
          theme: { type: 'STRING' },
          lodging: {
            type: 'OBJECT',
            propertyOrdering: ['name', 'address', 'check_in', 'check_out'],
            properties: {
              name: { type: 'STRING' },
              address: { type: 'STRING' },
              check_in: { type: 'STRING' },
              check_out: { type: 'STRING' },
            },
          },
          intercity_transit: {
            type: 'OBJECT',
            // B7 (P308, 2026-05-30): 필드명을 frontend/buildPrompt/RouteAgent 와 통일.
            // P291 PR #703 이 method/duration_min/cost_krw 로 잘못 명명 → 다도시 KTX 빈칸.
            // 실제 5개 layer (buildPrompt 예시+텍스트 / DayTimeline / pdfGenerator /
            // planToMarkdown / RouteAgent fallback) 모두 mode/est_min/est_fare_krw.
            // 스키마는 responseSchema (generationConfig) 라 prompt body 무관 = cache miss 0.
            propertyOrdering: ['from_city', 'to_city', 'mode', 'est_min', 'est_fare_krw'],
            properties: {
              from_city: { type: 'STRING' },
              to_city: { type: 'STRING' },
              mode: { type: 'STRING' },
              est_min: { type: 'INTEGER' },
              est_fare_krw: { type: 'NUMBER' },
            },
          },
          stops: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              // P291 R5: stops.items propertyOrdering 추가 (기존 12 fields 유지, alphabetical default 회피).
              propertyOrdering: ['order', 'start_time', 'name', 'display_name', 'category', 'stay_min', 'address', 'tip', 'lat', 'lng', 'entry_fee_krw', 'verified'],
              required: ['name', 'category', 'start_time'],
              properties: {
                order: { type: 'INTEGER' },
                name: { type: 'STRING' },
                display_name: { type: 'STRING' },
                category: { type: 'STRING' },
                start_time: { type: 'STRING' },
                stay_min: { type: 'INTEGER' },
                address: { type: 'STRING' },
                tip: { type: 'STRING' },
                lat: { type: 'NUMBER' },
                lng: { type: 'NUMBER' },
                entry_fee_krw: { type: 'NUMBER' },
                verified: { type: 'BOOLEAN' },
              },
            },
          },
        },
      },
    },
    // P210-A (2026-05-26): airport hint. P291 R1 (2026-05-29): steps array hint 확장.
    //   주의: required 추가 X (P196 lesson). self_heal 안전망 그대로 유지 (planPersister.js:522).
    arrival_guide: {
      type: 'OBJECT',
      propertyOrdering: ['airport', 'steps'],
      properties: {
        airport: { type: 'STRING' },
        steps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            propertyOrdering: ['step', 'title', 'description', 'est_min', 't_money_card_cost_krw', 't_money_recommended_load_krw', 'recommended_cash_krw'],
            properties: {
              step: { type: 'INTEGER' },
              title: { type: 'STRING' },
              description: { type: 'STRING' },
              est_min: { type: 'INTEGER' },
              t_money_card_cost_krw: { type: 'NUMBER' },
              t_money_recommended_load_krw: { type: 'NUMBER' },
              recommended_cash_krw: { type: 'NUMBER' },
            },
          },
        },
      },
    },
    // P291 R2 (2026-05-29): departure_guide 7 fields + 3 nested OBJECT 확장.
    //   buildPrompt L242-262 JSON example 와 정확 일치. P205 self-heal 안전망 유지.
    departure_guide: {
      type: 'OBJECT',
      propertyOrdering: ['airport', 'recommended_departure_time', 'latest_leave_hotel', 'luggage_storage', 'to_airport', 'tax_refund', 'last_minute_shopping'],
      properties: {
        airport: { type: 'STRING' },
        recommended_departure_time: { type: 'STRING' },
        latest_leave_hotel: { type: 'STRING' },
        luggage_storage: {
          type: 'OBJECT',
          propertyOrdering: ['available', 'location', 'price_krw'],
          properties: {
            available: { type: 'BOOLEAN' },
            location: { type: 'STRING' },
            price_krw: { type: 'NUMBER' },
          },
        },
        to_airport: {
          type: 'OBJECT',
          propertyOrdering: ['method', 'instruction', 'cost_krw', 'duration_min'],
          properties: {
            method: { type: 'STRING' },
            instruction: { type: 'STRING' },
            cost_krw: { type: 'NUMBER' },
            duration_min: { type: 'INTEGER' },
          },
        },
        tax_refund: {
          type: 'OBJECT',
          propertyOrdering: ['threshold_krw', 'note'],
          properties: {
            threshold_krw: { type: 'NUMBER' },
            note: { type: 'STRING' },
          },
        },
        last_minute_shopping: { type: 'STRING' },
      },
    },
    // P184 (2026-05-25): Flash strict schema ARRAY 는 items 필수.
    // P291 R3 (2026-05-29): items 6 NUMBER fields hint (buildPrompt L319-329 와 일치).
    //   selfHealDailyBudget (planPersister.js:153) 의 field 이름 (`food/transport/attraction/misc/total`)
    //   과 mismatch — 별도 sleeper bug (spawn task 권고). 본 R3 = schema/buildPrompt 일치 유지.
    daily_budget_summary: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        propertyOrdering: ['day', 'transport_krw', 'entry_fees_krw', 'meals_krw', 'activities_krw', 'shopping_estimate_krw', 'total_krw'],
        properties: {
          day: { type: 'INTEGER' },
          transport_krw: { type: 'NUMBER' },
          entry_fees_krw: { type: 'NUMBER' },
          meals_krw: { type: 'NUMBER' },
          activities_krw: { type: 'NUMBER' },
          shopping_estimate_krw: { type: 'NUMBER' },
          total_krw: { type: 'NUMBER' },
        },
      },
    },
    t_money_recommended_load: { type: 'NUMBER' },
  },
};

// Export for unit testing (회귀 검증).
export { PLAN_RESPONSE_SCHEMA };

// Per-instance sliding-window retry counter. Vercel containers don't share
// state, but a single hot container handling many requests will surface a
// retry storm to the operator within 5min. This is observability, NOT a
// hard rate-limit (we never block a user retry — DIETARY_VIOLATION etc.
// would re-fire if we silently dropped the attempt).
const _retryWindow = new Map(); // retryType → number[] of timestamps
const _retryAlertedAt = new Map(); // retryType → number (last alert ms)

/** Test-only — reset window/alert state between vitest cases. */
export function __resetRetryWindowForTests() {
  _retryWindow.clear();
  _retryAlertedAt.clear();
}

/**
 * Record a retry attempt. When a single retry type fires more than
 * RETRY_RATE_THRESHOLD times in the past RETRY_RATE_WINDOW_MS, fire an
 * admin alert (once per window). The alert key is dedup'd by retry type
 * so a Gemini outage causing both dietary + pattern retries triggers
 * 2 distinct alerts (operator can correlate root cause).
 *
 * @param {string} retryType e.g. 'dietary-3pass', 'pattern-legacy'
 * @returns {{ countInWindow: number, alerted: boolean }}
 */
export function recordRetryAttempt(retryType) {
  const now = Date.now();
  const list = _retryWindow.get(retryType) || [];
  // Prune timestamps outside window.
  const cutoff = now - RETRY_RATE_WINDOW_MS;
  let firstFresh = 0;
  while (firstFresh < list.length && list[firstFresh] < cutoff) firstFresh++;
  const pruned = firstFresh > 0 ? list.slice(firstFresh) : list;
  pruned.push(now);
  _retryWindow.set(retryType, pruned);

  let alerted = false;
  if (pruned.length > RETRY_RATE_THRESHOLD) {
    const lastAlert = _retryAlertedAt.get(retryType) || 0;
    if ((now - lastAlert) > RETRY_RATE_WINDOW_MS) {
      _retryAlertedAt.set(retryType, now);
      alerted = true;
      throttledTelegramAlert({
        key: `gemini-retry-rate-high:${retryType}`,
        channel: 'admin',
        severity: 'high',
        message: [
          `⚠️ <b>Gemini retry storm — ${retryType}</b>`,
          ``,
          `<b>최근 5분간 retry:</b> ${pruned.length}건 (임계 ${RETRY_RATE_THRESHOLD})`,
          `<b>retry 종류:</b> <code>${retryType}</code>`,
          ``,
          `→ Gemini quota burn 위험. prompt regression 또는 외부 outage 점검:`,
          `• <b>dietary-*</b> → buildDietaryReinforcedPrompt 회귀 / Gemini Pro 정확도 저하`,
          `• <b>pattern-*</b> → buildPatternReinforcedPrompt 회귀 / B-MEAL/B-DC 검증 룰 변경`,
          ``,
          `<i>retry 전용 model 은 temperature=${RETRY_TEMPERATURE} (deterministic). 그래도 fail = 입력 결함.</i>`,
        ].join('\n'),
        context: {
          errorCode: 'gemini_retry_rate_high',
          reason: retryType,
          step: 'retry-window',
        },
      }).catch(() => {});
    }
  }
  return { countInWindow: pruned.length, alerted };
}

// Module-scope cache. Vercel reuses Node modules across invocations on the
// same warm instance, so the 1.27 MB JSON gets parsed once per cold-start
// instead of once per request.
//
// PR #430 (Audit X-C4 — 2026-05-14): pre-fix every /api/ai-planner-full
// invocation did `fs.readFileSync` + `JSON.parse` on the 1.27 MB
// _food_index.json. That's ~50-150ms of pure CPU/IO blocking per request
// at p50, plus thundering-herd risk on cold start when multiple requests
// arrive simultaneously. The handler comment already said "avoid reading
// twice per request" but the function still re-read on every call.
//
// The cache uses both a resolved value AND an in-flight promise so two
// concurrent cold-start calls share one read instead of racing the FS.
let _foodIndexCache = null;
let _foodIndexLoading = null;

export async function loadFoodIndex() {
  if (_foodIndexCache !== null) return _foodIndexCache;
  if (_foodIndexLoading) return _foodIndexLoading;
  _foodIndexLoading = (async () => {
    try {
      const fs = await import('fs');
      _foodIndexCache = JSON.parse(
        fs.readFileSync(new URL('../_food_index.json', import.meta.url), 'utf-8'),
      );
    } catch {
      _foodIndexCache = [];
    }
    _foodIndexLoading = null;
    return _foodIndexCache;
  })();
  return _foodIndexLoading;
}

// Test-only escape hatch: lets the unit suite reset the cache between
// scenarios. Production callers should never hit this path.
export function __resetFoodIndexCacheForTests() {
  _foodIndexCache = null;
  _foodIndexLoading = null;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Gemini API timeout (${label})`)), ms)),
  ]);
}

// ────────────────────────────────────────────────────────────────────────────
// P215 (2026-05-26): Gemini finishReason 감지 + MAX_TOKENS 자동 retry
//
// 비유: "5코스 요리 만들다 재료 떨어진 주방에서 웨이터가 확인도 안 하고
//        3코스만 들고 손님한테 나가는 상황" — 잘린 plan 도 "정상" 처리 회귀.
//
// 배경:
//   Gemini Flash 가 long output (5-day 다도시 plan) 에서 MAX_TOKENS 잘림 발생 시
//   finishReason='MAX_TOKENS' 신호를 보내지만, 기존 코드는 STOP 과 구분 안 함.
//   → repairAndParseJSON 이 잘린 JSON 수리 시도 → minimal fallback → P181 alert.
//   외부 사례: github.com/google-gemini/gemini-cli/issues/2104
//
// fix:
//   - MAX_TOKENS: maxOutputTokens 65K 로 1회 retry (옵션 A — 비용 0, Flash free tier)
//   - SAFETY: alert 만, retry 안 함 (안전 필터 — 재시도 무의미)
//   - RECITATION: alert + throw (저작권 — Pro escalate 는 별도)
//   - 기타: alert + 기존 흐름 (non-fatal, 하위 호환)
// ────────────────────────────────────────────────────────────────────────────

/**
 * P215: Gemini response 에서 finishReason 추출.
 * @param {object} result  model.generateContent() 반환값
 * @returns {string}  'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | 'UNKNOWN'
 */
export function extractFinishReason(result) {
  try {
    return result?.response?.candidates?.[0]?.finishReason || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * P215: MAX_TOKENS 감지 시 maxOutputTokens 65K 로 재시도 (옵션 A).
 * 비용 0 (Flash free tier). 시간 +30-60초 (잘림 케이스만).
 *
 * @param {object} args
 * @param {object} args.apiKey
 * @param {object} args.systemPrompt
 * @param {object} args.userMessage
 * @param {string} args.planId
 * @param {boolean} [args.isAdminBypass]
 * @param {string} [args.identifierForBucketing]
 * @returns {Promise<{text:string, result:object}>}
 */
export async function retryWithExpandedTokens({ apiKey, systemPrompt, userMessage, isAdminBypass, identifierForBucketing }) {
  const expandedModel = buildModel(apiKey, 0.95, { isAdminBypass, identifierForBucketing });
  // Flash free tier 내에서 안전한 최대값 (65K).
  // P214: 32K 는 P215 retry 기준값 — retry 시 65K 사용.
  const expandedResult = await withTimeout(
    expandedModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 65000,
      },
    }),
    GEMINI_TIMEOUT_MS,
    'p215-max-tokens-retry',
  );
  const expandedReason = extractFinishReason(expandedResult);
  // P219: thought 필터 (Raw Logic Leak / 파싱 실패 방어).
  return { text: extractTextFromResponse(expandedResult.response).trim(), result: expandedResult, finishReason: expandedReason };
}

/**
 * P215: finishReason 에 따른 처리.
 * MAX_TOKENS → 1회 retry (옵션 A).
 * SAFETY / RECITATION → alert. RECITATION 은 throw.
 * 기타 → alert 만 (non-fatal).
 *
 * @param {string} finishReason
 * @param {string} stage  호출 단계 라벨 (예: 'legacy' / 'retry-dietary')
 * @param {object} retryArgs  retryWithExpandedTokens 에 넘길 args (MAX_TOKENS 케이스 전용)
 * @returns {Promise<{retryText:string|null, retryCm:object|null}>}
 *   MAX_TOKENS retry 성공 시 retryText 반환. 그 외 null.
 */
export async function handleFinishReason(finishReason, stage, retryArgs) {
  if (finishReason === 'STOP' || finishReason === 'UNKNOWN') return { retryText: null, retryCm: null };

  console.warn(`[P215] finishReason=${finishReason} at stage=${stage}`);

  if (finishReason === 'MAX_TOKENS') {
    // 비유: 재료 다 채워서 5코스 다시 만들기 시도
    sendErrorAlert({
      title: '🟠 <b>P215: Gemini MAX_TOKENS 잘림 감지 — 65K retry</b>',
      message: `stage=${stage} — maxOutputTokens 32K 초과. 65K 로 1회 재시도 중.`,
      context: { stage, finishReason },
    }).catch(() => {});

    try {
      const { text: retryText, result: retryResult, finishReason: retryReason } = await retryWithExpandedTokens(retryArgs);
      const retryCm = extractCacheMetadata(retryResult.response);
      logCacheMetrics(`p215-retry-${stage}`, retryCm);

      if (retryReason === 'MAX_TOKENS') {
        // 65K 에서도 잘림 — alert 후 잘린 결과 반환 (P201 Pro escalate 가 후속 처리 가능)
        sendErrorAlert({
          title: '🔴 <b>P215: 65K retry 에서도 MAX_TOKENS — 잘린 plan 진행</b>',
          message: `stage=${stage} — Flash 65K 재시도 후에도 잘림. P201 Pro escalate 미활성 시 minimal fallback 가능.`,
          context: { stage, retryReason },
        }).catch(() => {});
        console.warn('[P215] 65K retry 도 MAX_TOKENS — 잘린 plan 계속 처리');
      } else {
        console.log(`[P215] MAX_TOKENS retry 성공 — finishReason=${retryReason}, stage=${stage}`);
      }
      return { retryText, retryCm };
    } catch (retryErr) {
      console.error('[P215] MAX_TOKENS retry threw:', retryErr.message);
      // retry 실패 — 원본 잘린 plan 으로 폴백 (기존 흐름)
      return { retryText: null, retryCm: null };
    }
  }

  if (finishReason === 'SAFETY') {
    // Gemini 안전 필터 — retry 무의미, alert 만
    sendErrorAlert({
      title: '🔴 <b>P215: Gemini SAFETY 필터 차단</b>',
      message: `stage=${stage} — Gemini 안전 필터 발동. plan 생성 불가.`,
      context: { stage, finishReason },
    }).catch(() => {});
    console.error('[P215] SAFETY filter — plan 생성 불가');
    return { retryText: null, retryCm: null };
  }

  if (finishReason === 'RECITATION') {
    // 저작권 — alert 후 throw
    sendErrorAlert({
      title: '🟡 <b>P215: Gemini RECITATION (저작권 차단)</b>',
      message: `stage=${stage} — Gemini 가 copyrighted content recitation 감지. plan 차단됨.`,
      context: { stage, finishReason },
    }).catch(() => {});
    console.error('[P215] RECITATION — plan 차단');
    const recErr = new Error('Gemini RECITATION block: plan could not be generated');
    recErr.code = 'GEMINI_RECITATION';
    recErr.statusCode = 500;
    throw recErr;
  }

  // OTHER / 미지정 — alert 만, 기존 흐름 유지
  sendErrorAlert({
    title: `🟡 <b>P215: Gemini 알 수 없는 finishReason=${finishReason}</b>`,
    message: `stage=${stage} — 알 수 없는 finishReason. 기존 흐름 유지.`,
    context: { stage, finishReason },
  }).catch(() => {});
  return { retryText: null, retryCm: null };
}

function mapGeminiError(err, geminiStart) {
  console.error('[planner] Gemini timeout or error:', err.message, '| elapsed:', Date.now() - geminiStart, 'ms');
  const em = String(err.message || err.code || '');
  if (em.includes('RESOURCE_EXHAUSTED') || em.includes('429') || /quota/i.test(em)) {
    // K Tier 2-E: dedup — quota burst 시 5분 윈도우로 묶어 1번만 발송.
    throttledTelegramAlert({
      key: 'gemini-quota-exceeded',
      channel: 'error',
      severity: 'high',
      message: `⚠️ <b>GEMINI QUOTA EXCEEDED</b>\n\n오류: ${err.message}\n\n수동 확인 필요.`,
      context: { errorCode: err.code || 'unknown', step: 'gemini-call' },
    }).catch(() => {});
    const e = new Error('AI service at capacity. Try again shortly.');
    e.code = 'GEMINI_QUOTA';
    e.statusCode = 503;
    return e;
  }
  if (err.message.includes('timeout')) {
    const e = new Error('AI is taking too long. Please try again.');
    e.code = 'GEMINI_TIMEOUT';
    e.statusCode = 504;
    return e;
  }
  if (!err.code) err.code = 'GEMINI_ERROR';
  return err;
}

/**
 * P0-3 SAFETY-CRITICAL: dietary violation 발견 시 강조된 instruction 으로 1회 재호출.
 * Gemini system prompt 위에 명시적인 reinforcement 를 prepend — JSON output schema
 * 는 동일 (validateResponse 동일 적용 가능).
 *
 * 사용자 dietary preferences 에 따라 어떤 음식을 절대 추천하면 안 되는지 명시.
 */
function buildDietaryReinforcedPrompt(systemPrompt, dietary) {
  const wantsHalal  = dietary.some((d) => /halal/i.test(d));
  const wantsVegan  = dietary.some((d) => /vegan/i.test(d));
  const wantsVeggie = dietary.some((d) => /vegetarian/i.test(d));

  const parts = [
    '═══════════════════════════════════════════════════════════',
    '🚨 CRITICAL SAFETY REQUIREMENT — DIETARY RESTRICTIONS 🚨',
    '═══════════════════════════════════════════════════════════',
    '',
    'The previous response contained restaurants that VIOLATED the user\'s',
    'dietary requirements. This is a HEALTH RISK — Halal/Vegan customers',
    'cannot eat foods containing prohibited ingredients.',
    '',
    'STRICT RULES (NO EXCEPTIONS):',
  ];
  if (wantsHalal) {
    parts.push(
      '- Halal: ONLY recommend restaurants explicitly certified or verified Halal.',
      '  NEVER recommend restaurants serving pork (돼지/삼겹), bacon, ham, or alcohol.',
      '  Mark each food stop with `dietary_tags: ["halal"]` AND mention "halal" or "할랄" in the tip.',
    );
  }
  if (wantsVegan) {
    parts.push(
      '- Vegan: ONLY plant-based restaurants. NEVER recommend places serving',
      '  beef/chicken/pork/fish/seafood (소고기/돼지/닭/생선/해산물) — even as an option.',
      '  Mark each food stop with `dietary_tags: ["vegan"]` AND mention "vegan" or "비건" in the tip.',
    );
  }
  if (wantsVeggie && !wantsVegan) {
    parts.push(
      '- Vegetarian: NO meat (소고기/돼지/닭/beef/chicken/pork). Eggs/dairy OK.',
      '  Mark each food stop with `dietary_tags: ["vegetarian"]` AND mention "vegetarian" or "채식" in the tip.',
    );
  }
  parts.push(
    '',
    'Regenerate the FULL itinerary with food stops that comply with the above.',
    'Same JSON schema as before. Same `days[].stops[]` structure.',
    '═══════════════════════════════════════════════════════════',
    '',
  );

  return parts.join('\n') + systemPrompt;
}

/**
 * 2026-05-12: pattern structural violation (B-10/B-12/B-13/B-14/B-15) 감지 시 강조된
 * instruction 으로 1회 재호출. dietary reinforcement 와 유사한 패턴.
 */
function buildPatternReinforcedPrompt(systemPrompt, patternErrors) {
  const head = [
    '═══════════════════════════════════════════════════════════',
    '🚨 PLAN STRUCTURE VIOLATION — RE-GENERATE 🚨',
    '═══════════════════════════════════════════════════════════',
    '',
    'The previous response violated the required plan structure. Specific errors:',
    '',
  ];
  const errLines = patternErrors.slice(0, 10).map((e) => `  - ${e}`);
  const tail = [
    '',
    'STRICT RULES (NO EXCEPTIONS):',
    '- EVERY day MUST start with a stop where category="lodging" (departure from hotel/zone).',
    '- EVERY day MUST end with a stop where category="lodging" (return to hotel/zone). On the LAST day with a departure airport, the final stop may instead use category="travel" or category="airport".',
    '- EVERY day MUST contain AT LEAST 4 stops total.',
    '- EVERY stop start_time MUST be a 24h "HH:MM" value with hour 0-23 (NEVER 24:00 or higher).',
    '- For MULTI-CITY plans (regions.length >= 2), the first lodging stop of EACH day MUST mention day.city via ONE of these acceptable forms (any single match passes validator):',
    '   (a) lodging name OR address contains city token (Seoul/서울, Busan/부산, Jeju/제주, etc.),',
    '   (b) day.theme contains city token (e.g. "Busan Day 1 — 해운대"),',
    '   (c) day.intercity_transit.to_city matches day.city (city-change day),',
    '   (d) lodging name is a well-known global hotel chain (Lotte/JW Marriott/Westin/Hilton/Sheraton/Hyatt/Shilla/etc.) — chain lenient pass.',
    '  Prefer (a) — most explicit. NEVER mismatch real city (Busan hotel on Seoul day = sole reason for re-generation).',
    '- The LAST day MUST include either a category="travel"/"airport" stop, a stop whose name/address mentions the airport (공항/airport/ICN/GMP/PUS/CJU), OR day-level "return_to_airport": true.',
    '- The TOP-LEVEL response MUST include either `arrival_guide.airport` OR `departure_guide.airport` (non-empty string, e.g. "ICN T1" / "GMP" / "PUS"). NEVER omit BOTH — the PDF first/last page renders blank without them (B-16). Prefer including `departure_guide` always; include `arrival_guide` whenever `arrival_airport != "already_in_korea"`.',
    '- The itinerary.days array MUST contain EXACTLY the requested duration_days count. NEVER drop or truncate the last day. If user requests 5 days, output 5 day objects (B-DC). Each day must be a full entry with stops[], NOT a placeholder.',
    '- EVERY full day (middle days — neither arrival nor departure day) MUST contain at least 1 lunch food stop (category="food", start_time hour ∈ [11:00, 14:59]) AND at least 1 dinner food stop (category="food", start_time hour ∈ [17:00, 21:59]). Arrival day (Day 1, often 15:00 check-in) and departure day may have ≥1 meal total. NEVER end a full day at hotel before 17:00 without a dinner stop (B-MEAL).',
    '',
    'Regenerate the FULL itinerary respecting the structure above.',
    'Same JSON schema as before. Same `days[].stops[]` structure.',
    '═══════════════════════════════════════════════════════════',
    '',
  ];
  return [...head, ...errLines, ...tail].join('\n') + systemPrompt;
}

/**
 * Run the appropriate Gemini pipeline (legacy or 3-pass) and return a
 * validated, DB-matched itinerary. Throws mapped errors on failure.
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.systemPrompt
 * @param {string} args.userMessage          finalUserMessage incl. AVOID clause
 * @param {string} args.area
 * @param {string} args.language
 * @param {'legacy'|'3pass'} args.mode
 * @param {string[]} [args.dietary]           P0-3: 사용자 식이제한 (halal/vegan/vegetarian).
 *                                            지정 시 응답 검증 + 위반 시 1회 retry.
 * @param {object} [args.body]                2026-05-12: pattern validation 입력 —
 *                                            body.regions / arrival_airport /
 *                                            departure_airport 로 출국일/도시 검증.
 *                                            누락 시 pattern 검증은 partial (도시·공항
 *                                            관련 룰 skip).
 * @param {boolean} [args.isAdminBypass]      2026-05-19: admin Test Mode 표시.
 *                                            true 시 validatePatternStructure 의 1-retry
 *                                            실패가 throw → telegram alert 로 다운그레이드.
 *                                            SAFETY-CRITICAL (dietary) 는 admin 도 hard throw 유지.
 * @param {object} [args.adminDb]             P169: streaming 모드에서 Firestore progressive write 용.
 * @param {string} [args.planId]              P169: skeleton plan ID (streaming 모드에서만 사용).
 */
export async function runGeminiPipeline({ apiKey, systemPrompt, userMessage, area, language, mode, dietary, body, isAdminBypass, adminDb, planId, identifierForBucketing }) {
  // P171 (2026-05-23): isAdminBypass propagate. admin Test Mode 만 GEMINI_ADMIN_BYPASS_MODEL
  // 우선 적용 (운영자 Pro→Flash 품질 비교용). 일반 사용자 (isAdminBypass=false) 영향 0.
  // P172 (2026-05-24): identifierForBucketing propagate. PLANNER_FLASH_PCT bucketing 의 입력
  // (deterministic per-user). admin (P171) 이 PCT (P172) 보다 우선 — 위쪽 분기에서 처리.
  const model = buildModel(apiKey, undefined, { isAdminBypass, identifierForBucketing });
  // PR #461 (X-H2): retry 전용 deterministic model. reinforced prompt 와 결합
  // 시 첫 retry 성공률 ↑ → 평균 Gemini quota 사용량 ↓.
  const retryModel = buildModel(apiKey, RETRY_TEMPERATURE, { isAdminBypass, identifierForBucketing });
  const foodIndex = await loadFoodIndex();
  const geminiStart = Date.now();
  // P0-3: 빈 배열이면 검사 생략 (식이제한 없는 사용자). null/undefined 도 안전.
  const dietaryArr = Array.isArray(dietary) ? dietary : [];
  let itinerary;
  // P195 (2026-05-25): implicit cache metadata 누적. legacy + streaming 분기 모두 누적.
  // 3pass mode 는 본 PR scope 외 — 추후 follow-up (R-P195 lint 가 감지).
  let cacheMetadata = { cached: 0, total: 0, output: 0 };

  if (mode === '3pass') {
    console.log('[planner] 🔀 3-pass mode activated');

    console.log('[planner] Pass 1/3: Intent generation...');
    let rawText;
    try {
      rawText = await withTimeout(pass1Intent(model, systemPrompt, userMessage), GEMINI_TIMEOUT_MS, 'pass1');
    } catch (err) {
      throw mapGeminiError(err, geminiStart);
    }
    console.log('[planner] Pass 1 done:', Date.now() - geminiStart, 'ms');

    itinerary = repairAndParseJSON(rawText);
    cleanAddresses(itinerary);
    sanitizeStops(itinerary, language);

    console.log('[planner] Pass 2/3: DB resolution...');
    const pass2Start = Date.now();
    itinerary = pass2Resolve(itinerary, foodIndex, area);
    console.log('[planner] Pass 2 done:', Date.now() - pass2Start, 'ms');

    // P168 (2026-05-23): Pass3 background 분기.
    // isPass3BackgroundEnabled() = true 일 때 Pass3 를 handlerCore 에서 Firestore 저장 후
    // background job 으로 trigger. 사용자 응답에는 Pass3 미포함 (tip 은 몇 초 후 등장).
    // _pass3_pending = true 마커 → handlerCore 가 planId 확정 후 triggerPass3Background 호출.
    // default false = legacy 동작 (sync Pass3). 단도시/legacy mode 영향 0.
    if (isPass3BackgroundEnabled()) {
      console.log('[planner] P168 Pass3 deferred to background (PLANNER_PASS3_BACKGROUND=true)');
      itinerary._pass3_pending = true;
    } else {
      console.log('[planner] Pass 3/3: Narrative enrichment...');
      const pass3Start = Date.now();
      itinerary = await pass3Enrich(model, itinerary, language);
      console.log('[planner] Pass 3 done:', Date.now() - pass3Start, 'ms');
    }

    // P0-3: dietary 전달 + violation 시 retry. 3pass 는 retry 비용 큼 — pass1 만 재호출.
    let issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr, styles: body?.styles }, foodIndex);
    if (hasCriticalDietaryViolation(issues) && dietaryArr.length > 0) {
      console.warn('[planner] 🚨 dietary_violation detected — retrying pass1 with reinforced prompt');
      recordRetryAttempt('dietary-3pass');
      const reinforced = buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);
      try {
        // PR #461 (X-H2): retryModel (temperature=0.1) — deterministic re-gen.
        const retryRaw = await withTimeout(pass1Intent(retryModel, reinforced, userMessage), GEMINI_TIMEOUT_MS, 'pass1-retry');
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        itinerary = pass2Resolve(itinerary, foodIndex, area);
        // P168: retry 경로에서도 background 분기 적용.
        if (isPass3BackgroundEnabled()) {
          itinerary._pass3_pending = true;
        } else {
          itinerary = await pass3Enrich(model, itinerary, language);
        }
        issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr, styles: body?.styles }, foodIndex);
      } catch (retryErr) {
        console.error('[planner] dietary retry failed:', retryErr.message);
      }
      if (hasCriticalDietaryViolation(issues)) {
        const violations = issues.filter((i) => i.type === 'dietary_violation');
        await captureError(new Error('Dietary violation persists after retry'), {
          route: 'ai-planner-full', mode: '3pass', dietary: dietaryArr.join(','),
          violationCount: violations.length, violations: violations.slice(0, 5),
        }).catch(() => {});
        const e = new Error(
          'AI failed to respect your dietary requirements (' +
          dietaryArr.join(', ') + '). We are unable to deliver a safe plan. ' +
          'Please contact support for a refund.'
        );
        e.code = 'DIETARY_VIOLATION';
        e.statusCode = 422;
        throw e;
      }
    }

    // 2026-05-12: pattern structure validation (B-10/B-12/B-14/B-15).
    // Gemini 비결정성으로 lodging bookend / min stops / start_time / 출국 공항
    // 누락 회귀. 1회 재시도 후에도 실패하면 throw — broken plan 차단.
    // P160 (2026-05-22): self-heal lodging bookend BEFORE pattern validation.
    // Gemini 가 가끔 stops[0]=food 시작 → B-10 throw → customer 500.
    // synthetic lodging prepend/append → validation 통과 + alert.
    selfHealLodgingBookend(itinerary);
    let patternErrors = validatePatternStructure(itinerary, body || {});
    if (patternErrors.length > 0) {
      console.warn('[planner] 🚨 pattern violation detected (3pass) — retrying with reinforced prompt:', patternErrors);
      recordRetryAttempt('pattern-3pass');
      const reinforced = buildPatternReinforcedPrompt(systemPrompt, patternErrors);
      try {
        // PR #461 (X-H2): retryModel — temperature 0.1.
        const retryRaw = await withTimeout(pass1Intent(retryModel, reinforced, userMessage), GEMINI_TIMEOUT_MS, 'pass1-retry-pattern');
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        itinerary = pass2Resolve(itinerary, foodIndex, area);
        // P168: pattern retry 경로에서도 background 분기 적용.
        if (isPass3BackgroundEnabled()) {
          itinerary._pass3_pending = true;
        } else {
          itinerary = await pass3Enrich(model, itinerary, language);
        }
        patternErrors = validatePatternStructure(itinerary, body || {});
      } catch (retryErr) {
        console.error('[planner] pattern retry failed:', retryErr.message);
      }
      if (patternErrors.length > 0) {
        captureError(new Error('Plan pattern violation persists after retry'), {
          route: 'ai-planner-full', mode: '3pass', errorCount: patternErrors.length,
          sample: patternErrors.slice(0, 5),
          adminBypass: !!isAdminBypass,
        }).catch(() => {});
        throttledTelegramAlert({
          key: isAdminBypass ? 'plan-validation-soft-3pass-admin' : 'plan-validation-failed-3pass',
          channel: 'error',
          severity: isAdminBypass ? 'low' : 'high',
          message: (isAdminBypass
            ? '🟡 <b>AI 플랜 구조 검증 실패 — admin Test Mode (3pass, SOFT)</b>\n\n'
            : '🔴 <b>AI 플랜 구조 검증 실패 (3pass)</b>\n\n')
            + patternErrors.slice(0, 5).join('\n')
            + (isAdminBypass
              ? '\n\n운영자(admin Test Mode) 요청 — plan 저장 진행. prompt/validator 점검 필요.'
              : '\n\n사용자 1회 재시도 후 새 플랜 생성. 재발 시 prompt/validator 점검 필요.'),
          context: { errorCount: patternErrors.length, sample: patternErrors.slice(0, 3), adminBypass: !!isAdminBypass },
        }).catch(() => {});
        // 2026-05-19: admin Test Mode 는 hard throw 다운그레이드. customer 는 그대로 throw.
        // SAFETY-CRITICAL (dietary) 는 위쪽 분기에서 admin 도 throw — 여기는 구조 검증만.
        if (!isAdminBypass) {
          const e = new Error(
            'AI 응답이 구조 검증을 통과하지 못했습니다 (재시도 후에도 실패). ' +
            '잠시 후 다시 시도해주시면 새 플랜이 생성됩니다. 운영팀에 알림이 전송됐습니다.'
          );
          e.code = 'PLAN_VALIDATION_FAILED';
          e.statusCode = 500;
          e.details = patternErrors.slice(0, 5);
          throw e;
        }
        console.warn('[planner] ⚠️ pattern violation accepted under admin bypass (3pass) — saving plan with soft alert');
      } else {
        console.log('[planner] pattern retry succeeded (3pass)');
      }
    }

    // 2026-05-12 자율 검증 1차 fix (B-18): SOFT quality — plan 저장 OK, telegram alert 만.
    // local_tag 비율 < 30% 시 throttledTelegramAlert (severity:low, 5분 dedup).
    // SAFETY-CRITICAL (dietary) 만 hard 차단 — 다양성 부족은 환불 사유 아니므로 soft.
    try {
      const softWarnings = checkSoftQualityWarnings(itinerary);
      if (softWarnings.length > 0) {
        console.warn('[planner] ⚠️ soft quality warnings (3pass):', softWarnings);
        throttledTelegramAlert({
          key: 'plan-quality-local-tag-low',
          channel: 'error',
          severity: 'low',
          message: '🟡 <b>Plan 다양성 미달 (B-18)</b>\n\n' + softWarnings.map((w) => w.message).join('\n'),
          context: { mode: '3pass', warnings: softWarnings.slice(0, 3) },
        }).catch(() => {});
      }
    } catch (warnErr) {
      console.error('[planner] soft warning check failed:', warnErr.message);
    }

    // B6 (P310 2026-05-30): allergyPrefs(dietaryArr) 전달 — P189 allergen DB 필터 활성 (GAP B).
    // detectAllergenViolation 이 pref.toLowerCase() 처리 + Halal/Vegan 은 allergens 키 없어 무시.
    // 현재 DB allergens 전 행 false → 실효 0 이나 dead code 활성 + retrofit 후 효과 (R-P189 정합).
    applyDBMatcher(itinerary, foodIndex, area, language, dietaryArr);

    console.log('[planner] 3-pass total:', Date.now() - geminiStart, 'ms');
  } else {
    // LEGACY single-pass
    let rawText;

    // P169: PLANNER_STREAMING_ENABLED=true 이고 legacy 1-pass 일 때 streaming 분기.
    // 3-pass 는 pass1Intent 가 별도 streaming 필요 → 현재는 legacy 만 지원.
    // env flag false (default) 시 기존 generateContent 흐름 100% 유지.
    if (isStreamingEnabled() && mode !== '3pass') {
      console.log('[planner P169] streaming mode activated (PLANNER_STREAMING_ENABLED=true)');
      try {
        // P195: runGeminiStreaming 이 { text, cacheMetadata } 반환.
        const streamReturn = await withTimeout(
          runGeminiStreaming({ model, systemPrompt, userMessage, adminDb, planId, language }),
          GEMINI_TIMEOUT_MS,
          'legacy-streaming',
        );
        rawText = streamReturn.text;
        cacheMetadata = accumulateCacheMetadata(cacheMetadata, streamReturn.cacheMetadata);
      } catch (err) {
        throw mapGeminiError(err, geminiStart);
      }
    } else {
      // 기존 generateContent 흐름 (변경 0)
      let result;
      try {
        result = await withTimeout(
          model.generateContent({
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
          }),
          GEMINI_TIMEOUT_MS,
          'legacy',
        );
      } catch (err) {
        throw mapGeminiError(err, geminiStart);
      }
      // P215 (2026-05-26): finishReason 감지 — MAX_TOKENS 잘림 시 65K retry.
      // "5코스 요리 만들다 재료 떨어진 주방" 비유 — 잘린 plan 도 STOP 과 구분 의무.
      const legacyFinishReason = extractFinishReason(result);
      const { retryText: p215RetryText, retryCm: p215RetryCm } = await handleFinishReason(
        legacyFinishReason,
        'legacy',
        { apiKey, systemPrompt, userMessage, isAdminBypass, identifierForBucketing },
      );
      if (p215RetryText !== null) {
        rawText = p215RetryText;
        cacheMetadata = accumulateCacheMetadata(cacheMetadata, p215RetryCm);
      } else {
        // P219: thought 필터 — Raw Logic Leak / 파싱 실패 방어 (보안).
        rawText = extractTextFromResponse(result.response).trim();
      }
      // P195: legacy 1-pass response 의 cache metadata 추출 + 누적.
      const cm = extractCacheMetadata(result.response);
      cacheMetadata = accumulateCacheMetadata(cacheMetadata, cm);
      logCacheMetrics('legacy', cm);
    }

    console.log('[planner] Gemini:', Date.now() - geminiStart, 'ms');
    console.log('[ai-planner-full] Gemini raw (first 200):', rawText.substring(0, 200));
    console.log('[ai-planner-full] Gemini raw length:', rawText.length);

    itinerary = repairAndParseJSON(rawText);
    // P201 (2026-05-26): minimal fallback 감지 시 Pro escalate (ENV gate + circuit breaker).
    // default ENV OFF — 머지 자체 영향 0. 활성화는 운영자 명시 (`P181_PRO_ESCALATE_ENABLED=true`).
    if (itinerary && itinerary.__repair_minimal_fallback && isProEscalateEnabled() && !checkProEscalateCircuit()) {
      try {
        const proItinerary = await tryProEscalate({ apiKey, systemPrompt, userMessage, isAdminBypass, identifierForBucketing });
        if (proItinerary) {
          // Pro success — cache metadata 추출 + itinerary 교체
          const proCm = extractCacheMetadata(proItinerary._proResponse);
          delete proItinerary._proResponse;
          cacheMetadata = accumulateCacheMetadata(cacheMetadata, proCm);
          logCacheMetrics('pro-escalate-p201', proCm);
          recordProEscalateAttempt('success');
          itinerary = proItinerary;
          console.log('[P201] Pro escalate SUCCESS — minimal fallback recovered');
        } else {
          recordProEscalateAttempt('fail');
          console.warn('[P201] Pro escalate returned minimal — Flash + Pro 둘 다 fail');
        }
      } catch (escErr) {
        recordProEscalateAttempt('error');
        console.warn('[P201] Pro escalate threw:', escErr.message);
      }
    }
    console.log('[ai-planner-full] Parsed OK, days:', (itinerary.days || []).length);

    cleanAddresses(itinerary);
    sanitizeStops(itinerary, language);
    // P0-3 SAFETY-CRITICAL: dietary 전달 + violation 시 1회 retry → 그래도 violation 시 throw.
    let issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr, styles: body?.styles }, foodIndex);
    if (hasCriticalDietaryViolation(issues) && dietaryArr.length > 0) {
      console.warn('[planner] 🚨 dietary_violation detected — retrying with reinforced prompt');
      recordRetryAttempt('dietary-legacy');
      const reinforced = buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);
      try {
        const retryStart = Date.now();
        // PR #461 (X-H2): retryModel — temperature 0.1.
        const retryResult = await withTimeout(
          retryModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            systemInstruction: { role: 'system', parts: [{ text: reinforced }] },
          }),
          GEMINI_TIMEOUT_MS,
          'legacy-retry',
        );
        console.log('[planner] dietary retry Gemini:', Date.now() - retryStart, 'ms');
        // P219: thought 필터 — SAFETY-CRITICAL dietary retry 응답에 thought leak 금지.
        const retryRaw = extractTextFromResponse(retryResult.response).trim();
        // P195: dietary retry response 의 cache metadata 추출 + 누적.
        const retryCm = extractCacheMetadata(retryResult.response);
        cacheMetadata = accumulateCacheMetadata(cacheMetadata, retryCm);
        logCacheMetrics('dietary-retry', retryCm);
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr, styles: body?.styles }, foodIndex);
      } catch (retryErr) {
        console.error('[planner] dietary retry failed:', retryErr.message);
        // retry 자체 실패 시에도 issues 는 직전 값 유지 → 아래 final check 가 throw.
      }
      if (hasCriticalDietaryViolation(issues)) {
        const violations = issues.filter((i) => i.type === 'dietary_violation');
        // Sentry alert — 운영자가 환불 + 사용자 연락 필요. 비동기 — throw 막지 않음.
        captureError(new Error('Dietary violation persists after retry'), {
          route: 'ai-planner-full', mode: 'legacy', dietary: dietaryArr.join(','),
          violationCount: violations.length, violations: violations.slice(0, 5),
        }).catch(() => {});
        sendErrorAlert({
          title: '🚨 SAFETY-CRITICAL: dietary_violation persisted',
          context: {
            dietary: dietaryArr.join(','),
            violations: violations.length,
            sample: violations.slice(0, 3).map((v) => `${v.diet}:${v.stop}`).join(' | '),
          },
        }).catch(() => {});
        const e = new Error(
          'AI failed to respect your dietary requirements (' +
          dietaryArr.join(', ') + '). ' +
          'We were unable to generate a safe plan. ' +
          'Please contact support for a full refund — no plan was saved.'
        );
        e.code = 'DIETARY_VIOLATION';
        e.statusCode = 422;
        throw e;
      }
      console.log('[planner] dietary retry succeeded — no violations remain');
    }

    // 2026-05-12: pattern structure validation (B-10/B-12/B-14/B-15).
    // Gemini 비결정성으로 lodging bookend / min stops / start_time / 출국 공항
    // 누락 회귀. 1회 재시도 후에도 실패하면 throw — broken plan 차단.
    // P160 (2026-05-22): self-heal lodging bookend BEFORE pattern validation.
    // Gemini 가 가끔 stops[0]=food 시작 → B-10 throw → customer 500.
    // synthetic lodging prepend/append → validation 통과 + alert.
    selfHealLodgingBookend(itinerary);
    let patternErrors = validatePatternStructure(itinerary, body || {});
    if (patternErrors.length > 0) {
      console.warn('[planner] 🚨 pattern violation detected (legacy) — retrying with reinforced prompt:', patternErrors);
      recordRetryAttempt('pattern-legacy');
      const reinforced = buildPatternReinforcedPrompt(systemPrompt, patternErrors);
      try {
        const retryStart = Date.now();
        // PR #461 (X-H2): retryModel — temperature 0.1.
        const retryResult = await withTimeout(
          retryModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            systemInstruction: { role: 'system', parts: [{ text: reinforced }] },
          }),
          GEMINI_TIMEOUT_MS,
          'legacy-retry-pattern',
        );
        console.log('[planner] pattern retry Gemini:', Date.now() - retryStart, 'ms');
        // P219: thought 필터 — pattern retry 응답에 thought leak 금지.
        const retryRaw = extractTextFromResponse(retryResult.response).trim();
        // P195: pattern retry response 의 cache metadata 추출 + 누적.
        const retryCm = extractCacheMetadata(retryResult.response);
        cacheMetadata = accumulateCacheMetadata(cacheMetadata, retryCm);
        logCacheMetrics('pattern-retry', retryCm);
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        patternErrors = validatePatternStructure(itinerary, body || {});
      } catch (retryErr) {
        console.error('[planner] pattern retry failed:', retryErr.message);
      }
      if (patternErrors.length > 0) {
        captureError(new Error('Plan pattern violation persists after retry'), {
          route: 'ai-planner-full', mode: 'legacy', errorCount: patternErrors.length,
          sample: patternErrors.slice(0, 5),
          adminBypass: !!isAdminBypass,
        }).catch(() => {});
        throttledTelegramAlert({
          key: isAdminBypass ? 'plan-validation-soft-legacy-admin' : 'plan-validation-failed-legacy',
          channel: 'error',
          severity: isAdminBypass ? 'low' : 'high',
          message: (isAdminBypass
            ? '🟡 <b>AI 플랜 구조 검증 실패 — admin Test Mode (legacy, SOFT)</b>\n\n'
            : '🔴 <b>AI 플랜 구조 검증 실패 (legacy)</b>\n\n')
            + patternErrors.slice(0, 5).join('\n')
            + (isAdminBypass
              ? '\n\n운영자(admin Test Mode) 요청 — plan 저장 진행. prompt/validator 점검 필요.'
              : '\n\n사용자 1회 재시도 후 새 플랜 생성. 재발 시 prompt/validator 점검 필요.'),
          context: { errorCount: patternErrors.length, sample: patternErrors.slice(0, 3), adminBypass: !!isAdminBypass },
        }).catch(() => {});
        // 2026-05-19: admin Test Mode 는 hard throw 다운그레이드. customer 는 그대로 throw.
        // SAFETY-CRITICAL (dietary) 는 위쪽 분기에서 admin 도 throw — 여기는 구조 검증만.
        if (!isAdminBypass) {
          const e = new Error(
            'AI 응답이 구조 검증을 통과하지 못했습니다 (재시도 후에도 실패). ' +
            '잠시 후 다시 시도해주시면 새 플랜이 생성됩니다. 운영팀에 알림이 전송됐습니다.'
          );
          e.code = 'PLAN_VALIDATION_FAILED';
          e.statusCode = 500;
          e.details = patternErrors.slice(0, 5);
          throw e;
        }
        console.warn('[planner] ⚠️ pattern violation accepted under admin bypass (legacy) — saving plan with soft alert');
      } else {
        console.log('[planner] pattern retry succeeded (legacy)');
      }
    }

    // 2026-05-12 자율 검증 1차 fix (B-18): SOFT quality — plan 저장 OK, telegram alert 만.
    // local_tag 비율 < 30% 시 throttledTelegramAlert (severity:low, 5분 dedup).
    // SAFETY-CRITICAL (dietary) 만 hard 차단 — 다양성 부족은 환불 사유 아니므로 soft.
    try {
      const softWarnings = checkSoftQualityWarnings(itinerary);
      if (softWarnings.length > 0) {
        console.warn('[planner] ⚠️ soft quality warnings (legacy):', softWarnings);
        throttledTelegramAlert({
          key: 'plan-quality-local-tag-low',
          channel: 'error',
          severity: 'low',
          message: '🟡 <b>Plan 다양성 미달 (B-18)</b>\n\n' + softWarnings.map((w) => w.message).join('\n'),
          context: { mode: 'legacy', warnings: softWarnings.slice(0, 3) },
        }).catch(() => {});
      }
    } catch (warnErr) {
      console.error('[planner] soft warning check failed:', warnErr.message);
    }

    // B6 (P310 2026-05-30): allergyPrefs(dietaryArr) 전달 — P189 allergen DB 필터 활성 (GAP B).
    // detectAllergenViolation 이 pref.toLowerCase() 처리 + Halal/Vegan 은 allergens 키 없어 무시.
    // 현재 DB allergens 전 행 false → 실효 0 이나 dead code 활성 + retrofit 후 효과 (R-P189 정합).
    applyDBMatcher(itinerary, foodIndex, area, language, dietaryArr);
  }

  // P195: handlerCore.js 가 cacheMetadata 를 pop 후 buildAdminDebug 에 전달 → _debug
  // 응답에 cachedInputTokens/totalInputTokens/cacheHitRate 노출 (admin-bypass 한정).
  itinerary._cache_metadata = cacheMetadata;
  return itinerary;
}
