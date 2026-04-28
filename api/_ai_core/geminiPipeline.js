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
import { repairAndParseJSON, cleanAddresses, sanitizeStops, validateResponse } from './responseValidator.js';
import { applyDBMatcher } from './dbMatcher.js';
import { pass1Intent, pass2Resolve, pass3Enrich } from './threePassPipeline.js';
import { sendErrorAlert } from '../_telegram.js';

const GEMINI_TIMEOUT_MS = 240000;

// 2026-04-28 Flash → Pro: instruction following + JSON schema 압도적, thinking budget 8K→32K.
// Plan당 비용 ~$0.02 → ~$0.10 (결제 $9.90 대비 1%).
function buildModel(apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    generationConfig: {
      temperature: 0.7,
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
    sendErrorAlert('🚨 GEMINI QUOTA EXCEEDED', err).catch(() => {});
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
 */
export async function runGeminiPipeline({ apiKey, systemPrompt, userMessage, area, language, mode }) {
  const model = buildModel(apiKey);
  const foodIndex = await loadFoodIndex();
  const geminiStart = Date.now();
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

    validateResponse(itinerary, { lang: language }, foodIndex);
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
    validateResponse(itinerary, { lang: language }, foodIndex);
    applyDBMatcher(itinerary, foodIndex, area, language);
  }

  return itinerary;
}
