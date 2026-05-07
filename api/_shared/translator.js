/**
 * CocoTripKR — Bidirectional translator helper (Gemini 2.5 Flash).
 *
 * Use cases:
 *   1. Customer chat (en/ja/zh) → Korean (for operator on Telegram)
 *      → telegram-webhook-inquiry.js / telegram-webhook-admin.js / chat.js
 *   2. Operator reply (Korean) → customer language (for ChatWidget display)
 *      → relayAdminReply (via chat-relay.js) before saveChatMessage
 *   3. InquiryForm details (en/ja/zh) → Korean (for operator on Telegram)
 *      → inquiry-submit.js
 *
 * Design:
 *   - Single Gemini API call (model gemini-2.5-flash, low temperature for fidelity)
 *   - Language detect: cheap regex first (Hangul / Kana / CJK Han), Gemini fallback only
 *     for ambiguous cases (e.g. only Latin chars but could be 'en' or 'other')
 *   - Memory LRU cache (size 100). Same {text, targetLang} → cached translation
 *     to absorb identical short messages ("yes", "thanks", "OK" etc.)
 *   - On any Gemini error: caller receives the original text. Caller is responsible
 *     for surfacing "translation failed" UX. translator.js never throws.
 *
 * Env: reuses GEMINI_API_KEY (already set in production for ai-planner-full / chat).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Internal: lazy genAI client ──
let _genAI = null;
function getClient() {
  if (_genAI) return _genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

// ── Internal: simple LRU cache ──
const CACHE_MAX = 100;
const _cache = new Map(); // key = `${targetLang}:${text}` -> translation

function cacheGet(key) {
  if (!_cache.has(key)) return null;
  const v = _cache.get(key);
  // refresh recency (delete + set)
  _cache.delete(key);
  _cache.set(key, v);
  return v;
}

function cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_MAX) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
}

// ── Public: language detection ──
const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/; // Korean syllables/jamo
const HIRA_KATA_RE = /[぀-ヿㇰ-ㇿ]/;            // Japanese kana
const HAN_RE = /[一-鿿]/;                                // CJK Unified Ideographs

/**
 * Detect language. Cheap regex fast-path; Gemini fallback for ambiguous Latin-only
 * text. Returns 'ko'|'en'|'ja'|'zh'|'other'.
 *
 * Heuristic priority:
 *   - Hangul present → ko
 *   - Hiragana/Katakana present → ja (may also have Han, that's fine)
 *   - Han only (no kana, no hangul) → zh
 *   - Latin only and length < 200 → 'en' (most common case for cocotrip)
 *   - Latin long or unusual → Gemini detect
 */
export async function detectLanguage(text) {
  const s = String(text || '').trim();
  if (!s) return 'other';
  if (HANGUL_RE.test(s)) return 'ko';
  if (HIRA_KATA_RE.test(s)) return 'ja';
  if (HAN_RE.test(s)) return 'zh';
  // Latin / cyrillic / etc. — assume en for cocotrip's audience (most common).
  // Skip Gemini call for short messages to save cost.
  if (s.length < 200) return 'en';

  // Long non-CJK: ask Gemini for confidence.
  const client = getClient();
  if (!client) return 'en';
  try {
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    });
    const prompt = `Detect the language of the following text. Reply with ONE of: ko, en, ja, zh, other. No explanation.\n\nText: ${s.slice(0, 500)}`;
    const r = await model.generateContent(prompt);
    const out = (r.response.text() || '').trim().toLowerCase();
    if (['ko', 'en', 'ja', 'zh', 'other'].includes(out)) return out;
    return 'en';
  } catch (err) {
    console.warn('[translator.detectLanguage] gemini fallback failed:', err.message);
    return 'en';
  }
}

const LANG_NAMES = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese (Simplified)' };

/**
 * Translate text into target language. Returns translation, or null on failure.
 * Caller must handle null (typically by displaying original + "translation failed" badge).
 *
 * @param {string} text
 * @param {'ko'|'en'|'ja'|'zh'} targetLang
 * @returns {Promise<string|null>}
 */
export async function translate(text, targetLang) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (!['ko', 'en', 'ja', 'zh'].includes(targetLang)) {
    console.warn('[translator.translate] invalid targetLang:', targetLang);
    return null;
  }

  // Cache hit?
  const cacheKey = `${targetLang}:${s}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  const client = getClient();
  if (!client) {
    console.warn('[translator.translate] GEMINI_API_KEY not set');
    return null;
  }

  const langName = LANG_NAMES[targetLang];
  const prompt = `You are a professional translator for a Korean tour booking service. Translate the following text to ${langName}.

Rules:
- Output ONLY the translation. No explanation, no quotes, no labels.
- Preserve formality, tone, and emojis.
- Keep numbers, prices (₩, $), times, URLs, and proper nouns reasonable for the target language.
- If the text is already in ${langName}, output it unchanged.
- Do not add greetings or signatures that are not in the source.

Text:
${s}`;

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(prompt);
    const out = (r.response.text() || '').trim();
    if (!out) return null;
    cacheSet(cacheKey, out);
    return out;
  } catch (err) {
    console.error('[translator.translate] gemini failed:', err.message);
    return null;
  }
}

/**
 * Convenience: detect source language, and if it differs from target, translate.
 * Returns { sourceLang, translation, isOriginal }.
 *   - isOriginal=true: source already matches target (translation === text).
 *   - translation=null: detection or translation failed (caller falls back to original).
 */
export async function detectAndTranslate(text, targetLang) {
  const sourceLang = await detectLanguage(text);
  if (sourceLang === targetLang) {
    return { sourceLang, translation: text, isOriginal: true };
  }
  const translation = await translate(text, targetLang);
  return { sourceLang, translation, isOriginal: false };
}

/** For tests / debug */
export function _clearCache() { _cache.clear(); }
export function _cacheSize() { return _cache.size; }
