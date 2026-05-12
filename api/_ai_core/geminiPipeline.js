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
import { repairAndParseJSON, cleanAddresses, sanitizeStops, validateResponse, hasCriticalDietaryViolation, validatePatternStructure } from './responseValidator.js';
import { applyDBMatcher } from './dbMatcher.js';
import { captureError } from '../_shared/sentry.js';
import { pass1Intent, pass2Resolve, pass3Enrich } from './threePassPipeline.js';
import { sendErrorAlert } from '../_telegram.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

const GEMINI_TIMEOUT_MS = 240000;

// 2026-04-28 Flash → Pro: instruction following + JSON schema 압도적, thinking budget 8K→32K.
// Plan당 비용 ~$0.02 → ~$0.10 (결제 $9.90 대비 1%).
//
// 2026-05-09 (B9-15 fix, batch 9 PR-I): temperature 0.7 → 0.5.
// LODGING BOOKEND 같은 강한 제약 (첫/마지막 stop 5km 이내) 의 instruction
// following 정확도를 우선. 다양성은 약간 ↓ 하지만 사용자 환불 사유 (숙소
// 흐름 누락) 회피가 더 중요. 다양성은 'angle' rotation + variation_seed 로
// 보조 (buildPrompt.js).
function buildModel(apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    generationConfig: {
      temperature: 0.5,
      thinkingConfig: { thinkingBudget: 32000 },
      maxOutputTokens: 32000,
      responseMimeType: 'application/json',
    },
  });
}

// Exported so the handler can reuse it for recommendedRestaurants — avoids
// reading the 1.27MB JSON twice per request.
export async function loadFoodIndex() {
  try {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync(new URL('../_food_index.json', import.meta.url), 'utf-8'));
  } catch {
    return [];
  }
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
 */
export async function runGeminiPipeline({ apiKey, systemPrompt, userMessage, area, language, mode, dietary, body }) {
  const model = buildModel(apiKey);
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

    console.log('[planner] Pass 3/3: Narrative enrichment...');
    const pass3Start = Date.now();
    itinerary = await pass3Enrich(model, itinerary, language);
    console.log('[planner] Pass 3 done:', Date.now() - pass3Start, 'ms');

    // P0-3: dietary 전달 + violation 시 retry. 3pass 는 retry 비용 큼 — pass1 만 재호출.
    let issues = validateResponse(itinerary, { lang: language, dietary: dietaryArr }, foodIndex);
    if (hasCriticalDietaryViolation(issues) && dietaryArr.length > 0) {
      console.warn('[planner] 🚨 dietary_violation detected — retrying pass1 with reinforced prompt');
      const reinforced = buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);
      try {
        const retryRaw = await withTimeout(pass1Intent(model, reinforced, userMessage), GEMINI_TIMEOUT_MS, 'pass1-retry');
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        itinerary = pass2Resolve(itinerary, foodIndex, area);
        itinerary = await pass3Enrich(model, itinerary, language);
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
    let patternErrors = validatePatternStructure(itinerary, body || {});
    if (patternErrors.length > 0) {
      console.warn('[planner] 🚨 pattern violation detected (3pass) — retrying with reinforced prompt:', patternErrors);
      const reinforced = buildPatternReinforcedPrompt(systemPrompt, patternErrors);
      try {
        const retryRaw = await withTimeout(pass1Intent(model, reinforced, userMessage), GEMINI_TIMEOUT_MS, 'pass1-retry-pattern');
        itinerary = repairAndParseJSON(retryRaw);
        cleanAddresses(itinerary);
        sanitizeStops(itinerary, language);
        itinerary = pass2Resolve(itinerary, foodIndex, area);
        itinerary = await pass3Enrich(model, itinerary, language);
        patternErrors = validatePatternStructure(itinerary, body || {});
      } catch (retryErr) {
        console.error('[planner] pattern retry failed:', retryErr.message);
      }
      if (patternErrors.length > 0) {
        captureError(new Error('Plan pattern violation persists after retry'), {
          route: 'ai-planner-full', mode: '3pass', errorCount: patternErrors.length,
          sample: patternErrors.slice(0, 5),
        }).catch(() => {});
        throttledTelegramAlert({
          key: 'plan-validation-failed-3pass',
          channel: 'error',
          severity: 'high',
          message: '🔴 <b>AI plan validation failed (3pass)</b>\n\n' + patternErrors.slice(0, 5).join('\n'),
          context: { errorCount: patternErrors.length, sample: patternErrors.slice(0, 3) },
        }).catch(() => {});
        const e = new Error(
          'AI response failed structural validation after retry. ' +
          'Please try again — the planner will produce a new plan. (Operations team notified.)'
        );
        e.code = 'PLAN_VALIDATION_FAILED';
        e.statusCode = 500;
        e.details = patternErrors.slice(0, 5);
        throw e;
      }
      console.log('[planner] pattern retry succeeded (3pass)');
    }

    applyDBMatcher(itinerary, foodIndex, area, language);

    console.log('[planner] 3-pass total:', Date.now() - geminiStart, 'ms');
  } else {
    // LEGACY single-pass
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
    console.log('[planner] Gemini:', Date.now() - geminiStart, 'ms');

    const rawText = result.response.text().trim();
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
      const reinforced = buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);
      try {
        const retryStart = Date.now();
        const retryResult = await withTimeout(
          model.generateContent({
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
    let patternErrors = validatePatternStructure(itinerary, body || {});
    if (patternErrors.length > 0) {
      console.warn('[planner] 🚨 pattern violation detected (legacy) — retrying with reinforced prompt:', patternErrors);
      const reinforced = buildPatternReinforcedPrompt(systemPrompt, patternErrors);
      try {
        const retryStart = Date.now();
        const retryResult = await withTimeout(
          model.generateContent({
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
        }).catch(() => {});
        throttledTelegramAlert({
          key: 'plan-validation-failed-legacy',
          channel: 'error',
          severity: 'high',
          message: '🔴 <b>AI plan validation failed (legacy)</b>\n\n' + patternErrors.slice(0, 5).join('\n'),
          context: { errorCount: patternErrors.length, sample: patternErrors.slice(0, 3) },
        }).catch(() => {});
        const e = new Error(
          'AI response failed structural validation after retry. ' +
          'Please try again — the planner will produce a new plan. (Operations team notified.)'
        );
        e.code = 'PLAN_VALIDATION_FAILED';
        e.statusCode = 500;
        e.details = patternErrors.slice(0, 5);
        throw e;
      }
      console.log('[planner] pattern retry succeeded (legacy)');
    }

    applyDBMatcher(itinerary, foodIndex, area, language);
  }

  return itinerary;
}
