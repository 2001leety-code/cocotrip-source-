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

/**
 * P169: 누적 텍스트에서 best-effort partial JSON parse.
 * 기존 repairAndParseJSON 로직을 활용 — incomplete JSON 도 처리.
 * days[] 배열이 하나 이상 완성됐을 때만 의미있는 결과 반환 (null 반환 otherwise).
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
    // 2. 불완전 JSON repair
    try {
      const repaired = repairAndParseJSON(accumulated);
      if (repaired && Array.isArray(repaired.days) && repaired.days.length > 0) return repaired;
    } catch {
      // best-effort: ignore
    }
    return null;
  }
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

  console.log('[geminiPipeline P169] Starting generateContentStream...');
  const streamStart = Date.now();

  const streamResult = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
  });

  for await (const chunk of streamResult.stream) {
    const chunkText = chunk.text();
    if (chunkText) accumulated += chunkText;

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
  return accumulated;
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
  return genAI.getGenerativeModel({
    model: resolveGeminiModel('main', { isAdminBypass: opts.isAdminBypass }),
    generationConfig: {
      temperature: typeof temperatureOverride === 'number' ? temperatureOverride : 0.5,
      thinkingConfig: { thinkingBudget: 32000 },
      // P164 (2026-05-23): 32K→12K. 5-day plan JSON 실측 평균 2-5K 토큰 — 32K 할당은
      // generation overhead. 12K = safety margin 2x. 사용자 도달 가능성 거의 0.
      maxOutputTokens: 12000,
      responseMimeType: 'application/json',
    },
  });
}

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
export async function runGeminiPipeline({ apiKey, systemPrompt, userMessage, area, language, mode, dietary, body, isAdminBypass, adminDb, planId }) {
  // P171 (2026-05-23): isAdminBypass propagate. admin Test Mode 만 GEMINI_ADMIN_BYPASS_MODEL
  // 우선 적용 (운영자 Pro→Flash 품질 비교용). 일반 사용자 (isAdminBypass=false) 영향 0.
  const model = buildModel(apiKey, undefined, { isAdminBypass });
  // PR #461 (X-H2): retry 전용 deterministic model. reinforced prompt 와 결합
  // 시 첫 retry 성공률 ↑ → 평균 Gemini quota 사용량 ↓.
  const retryModel = buildModel(apiKey, RETRY_TEMPERATURE, { isAdminBypass });
  const foodIndex = await loadFoodIndex();
  const geminiStart = Date.now();
  // P0-3: 빈 배열이면 검사 생략 (식이제한 없는 사용자). null/undefined 도 안전.
  const dietaryArr = Array.isArray(dietary) ? dietary : [];
  let itinerary;

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
    let issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr }, foodIndex);
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
        issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr }, foodIndex);
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

    applyDBMatcher(itinerary, foodIndex, area, language);

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
        rawText = await withTimeout(
          runGeminiStreaming({ model, systemPrompt, userMessage, adminDb, planId, language }),
          GEMINI_TIMEOUT_MS,
          'legacy-streaming',
        );
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
      rawText = result.response.text().trim();
    }

    console.log('[planner] Gemini:', Date.now() - geminiStart, 'ms');
    console.log('[ai-planner-full] Gemini raw (first 200):', rawText.substring(0, 200));
    console.log('[ai-planner-full] Gemini raw length:', rawText.length);

    itinerary = repairAndParseJSON(rawText);
    console.log('[ai-planner-full] Parsed OK, days:', (itinerary.days || []).length);

    cleanAddresses(itinerary);
    sanitizeStops(itinerary, language);
    // P0-3 SAFETY-CRITICAL: dietary 전달 + violation 시 1회 retry → 그래도 violation 시 throw.
    let issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr }, foodIndex);
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
        const retryRaw = retryResult.response.text().trim();
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr }, foodIndex);
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
        const retryRaw = retryResult.response.text().trim();
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

    applyDBMatcher(itinerary, foodIndex, area, language);
  }

  return itinerary;
}
