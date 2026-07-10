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
 *   4. PR-S — Foreigner place-name autocomplete (place-search.js)
 *      → translatePlaceName() with 4-layer accuracy stack:
 *        Layer 1 = Gemini (Korean Romanization standard prompt)
 *        Layer 2 = Firestore `place_translations` cache (manual override 보호)
 *        Layer 3 = chain mapping table `place-name-map.json` (substring match)
 *        Layer 4 = AdminTranslations.tsx 운영자 검수 UI
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
import { readFileSync } from 'fs';
import { recordGeminiUsage } from './apiUsageRecorder.js';

// 사용량 실측 기록(비용 가시화 2026-07-09) — fire-and-forget, 실패해도 번역 흐름 영향 0.
function recordTranslatorUsage(stage, r) {
  try {
    const um = r && r.response && r.response.usageMetadata;
    if (!um) return;
    recordGeminiUsage({
      stage,
      model: 'gemini-2.5-flash',
      cm: {
        total: Number(um.promptTokenCount) || 0,
        cached: Number(um.cachedContentTokenCount) || 0,
        output: Number(um.candidatesTokenCount) || 0,
      },
    });
  } catch { /* ignore */ }
}
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getCachedTranslation,
  setCachedTranslation,
} from './place-translation-cache.js';

const GEMINI_VERSION = 'gemini-2.5-flash';

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
    recordTranslatorUsage('translator-detect', r);
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
    recordTranslatorUsage('translator-translate', r);
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

// ─────────────────────────────────────────────────────────────────────────────
// PR-S — Place-name translation (4-layer accuracy stack)
// ─────────────────────────────────────────────────────────────────────────────

// Layer 3: chain mapping table (loaded once)
let _placeNameMap = null;
function loadPlaceNameMap() {
  if (_placeNameMap) return _placeNameMap;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const mapPath = join(__dirname, 'place-name-map.json');
    const raw = readFileSync(mapPath, 'utf8');
    _placeNameMap = JSON.parse(raw);
    return _placeNameMap;
  } catch (err) {
    console.warn('[translator.loadPlaceNameMap] failed:', err.message);
    _placeNameMap = {};
    return _placeNameMap;
  }
}

/**
 * Layer 3 substring matching — 입력에서 매핑 테이블의 키를 찾아 치환.
 * 예: "롯데호텔 명동점" + lang='en' → "Lotte Hotel Myeongdong" (롯데호텔, 명동 둘 다 매칭)
 *
 * 알고리즘:
 *   1. 매핑 테이블 키를 길이 내림차순 정렬 (긴 키 먼저 → 부분 매칭 충돌 방지)
 *   2. 입력에서 발견되는 키마다 해당 언어 번역으로 치환
 *   3. 매칭 0건이면 null 반환 (Gemini fallback 신호)
 *   4. 매칭 1+건이면 한글 잔존 여부 검사 — 100% 치환됐으면 'mapping' source 반환,
 *      일부 한글 남아있으면 Gemini 보정 필요 → null 반환
 *
 * @param {string} originalText
 * @param {'en'|'ja'|'zh'} lang
 * @returns {string|null} 완전 치환된 결과 또는 null
 */
export function applyMappingTable(originalText, lang) {
  if (!originalText || !['en', 'ja', 'zh'].includes(lang)) return null;
  const map = loadPlaceNameMap();
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  let result = originalText;
  let matched = false;
  for (const key of keys) {
    if (result.includes(key)) {
      const repl = map[key]?.[lang];
      if (typeof repl === 'string' && repl) {
        result = result.split(key).join(repl);
        matched = true;
      }
    }
  }
  if (!matched) return null;
  // 한글 잔존 확인 — 일부만 매칭됐으면 Gemini 보정 필요
  if (HANGUL_RE.test(result)) return null;
  return result;
}

/**
 * Layer 1: 강화된 Gemini system prompt (한국 표준 로마자/외래어 표기법).
 *
 * 영어 = Revised Romanization (한국 정부 공식 — 2000년 고시)
 *   - 명동 → "Myeongdong" (X "Myeong-dong")
 *   - 을지로 → "Eulji-ro" (-ro / -gil 같은 행정 단위만 hyphen)
 *   - ㅇ + 모음 → 모음만 (이태원 → "Itaewon" not "Yitaewon")
 * 일본어 = 외래어 카타카나 + 한자 (가능 시 한자 우선)
 *   - 롯데호텔 → ロッテホテル (외래어)
 *   - 명동 → 明洞 (한자 가능)
 * 중국어 = 간체 + 음역
 *   - 롯데호텔 → 乐天酒店
 *   - 명동 → 明洞
 *
 * 혼합 입력 처리 (Layer 3 부분 치환 후 Gemini fallthrough 케이스):
 *   - Layer 3 매핑 테이블이 일부 한글만 치환하고 나머지 한글이 남은 경우,
 *     applyMappingTable()이 null을 반환하여 여기로 fallthrough.
 *   - 원문이 완전 한글인 경우도 동일 prompt 처리.
 *   - 주의: Layer 3가 미리 치환한 결과(한글+영문 혼합)는 이 함수에 도달하지 않음.
 *     (applyMappingTable은 완전 치환 성공 시만 반환, 실패 시 원문 그대로 넘김)
 *     → 따라서 text는 항상 "완전 한글" 또는 "부분 한글 잔존 혼합"이 가능.
 */
function buildPlaceNamePrompt(text, targetLang) {
  if (targetLang === 'en') {
    return `You are translating a Korean place name (business, landmark, neighborhood, station, district) to English for a foreign tourist booking service.

MIXED INPUT HANDLING:
- The input may contain mixed Korean and English/Romanized text — some parts may already be partially translated by a mapping table.
- Translate ONLY the remaining Korean fragments while preserving already-translated English/Romanized parts AS-IS.
- If the input is fully Korean, translate the entire text.
- If the input is already fully in English, return it unchanged.

Examples of mixed input:
- Input: "Lotte Hotel 강남"  → Output: "Lotte Hotel Gangnam"
- Input: "Seoul Tower 남산"  → Output: "Seoul Tower Namsan"
- Input: "롯데호텔 강남"      → Output: "Lotte Hotel Gangnam"
- Input: "Haeundae Beach 해수욕장" → Output: "Haeundae Beach"

STRICT RULES:
- Use Korean Government Revised Romanization of Korean (2000 standard).
- Examples: 명동 → "Myeongdong", 강남 → "Gangnam", 이태원 → "Itaewon", 광안리 → "Gwangalli", 해운대 → "Haeundae".
- Hyphens ONLY for administrative suffixes: 구 (-gu), 동 (-dong), 로 (-ro), 길 (-gil). Example: 을지로 → "Eulji-ro", 강남구 → "Gangnam-gu".
- For well-known international brands, use their English brand name: 롯데호텔 → "Lotte Hotel", 스타벅스 → "Starbucks".
- Output ONLY the final result. No explanation, no quotes, no labels, no romanization parenthetical.
- Use consistent capitalization (Title Case for proper nouns).
- Preserve numbers, branch indicators ("점" → branch), unit suffixes naturally.

Place name:
${text}`;
  }
  if (targetLang === 'ja') {
    return `You are translating a Korean place name to Japanese for a Japanese tourist booking service.

MIXED INPUT HANDLING:
- The input may contain mixed Korean and Japanese/Kanji/Katakana text — some parts may already be partially translated.
- Translate ONLY the remaining Korean fragments (Hangul: 가-힣) while preserving already-translated Japanese parts AS-IS.
- If the input is fully Korean (Hangul only), translate the entire text.
- If the input is already fully in Japanese, return it unchanged.

Examples of mixed input:
- Input: "ロッテホテル 강남"       → Output: "ロッテホテル 江南"
- Input: "明洞 롯데호텔"           → Output: "明洞 ロッテホテル"
- Input: "롯데호텔 명동"           → Output: "ロッテホテル 明洞"

STRICT RULES:
- Use Hanja (kanji) form when the place name has a clear Sino-Korean reading: 명동 → 明洞, 강남 → 江南, 인사동 → 仁寺洞, 한강 → 漢江, 경복궁 → 景福宮.
- Use Katakana for Western brand names: 롯데호텔 → ロッテホテル, 스타벅스 → スターバックス, JW매리어트 → JWマリオット.
- Use kanji phonetic form where available for native Korean words: 광안리 → 広安里, 해운대 → 海雲台.
- Output ONLY the final result. No explanation, no quotes, no labels, no romanization.
- Preserve numbers and branch indicators (점 → 店).

Place name:
${text}`;
  }
  if (targetLang === 'zh') {
    return `You are translating a Korean place name to Simplified Chinese for a Chinese tourist booking service.

MIXED INPUT HANDLING:
- The input may contain mixed Korean and Chinese/Simplified characters — some parts may already be partially translated.
- Translate ONLY the remaining Korean fragments (Hangul: 가-힣) while preserving already-translated Chinese parts AS-IS.
- If the input is fully Korean (Hangul only), translate the entire text.
- If the input is already fully in Chinese, return it unchanged.

Examples of mixed input:
- Input: "乐天酒店 강남"   → Output: "乐天酒店 江南"
- Input: "明洞 롯데호텔"   → Output: "明洞 乐天酒店"
- Input: "롯데호텔 명동"   → Output: "乐天酒店 明洞"

STRICT RULES:
- Use Simplified Chinese characters (简体中文).
- Use Hanja-equivalent Chinese form when available: 명동 → 明洞, 강남 → 江南, 한강 → 汉江, 경복궁 → 景福宫.
- Use established Chinese brand names: 롯데호텔 → 乐天酒店, 신라호텔 → 新罗酒店, 스타벅스 → 星巴克.
- Output ONLY the final result. No explanation, no quotes, no labels, no pinyin.
- Preserve numbers and branch indicators (점 → 店).

Place name:
${text}`;
  }
  // ko fallback (caller usually short-circuits)
  return text;
}

/**
 * Layer 1: Gemini 호출 — 강화된 prompt, temperature=0.1 (확정적).
 *
 * 응답 검증:
 *   - Gemini가 한글을 여전히 포함한 응답을 반환하면 console.warn 후 null 반환.
 *   - caller(translatePlaceName)는 null 수신 시 원문(source='fallback') 반환.
 *   - targetLang='ja'/'zh'는 한자/한글 구분이 필요하므로 Hangul 전용 체크만 수행.
 *
 * @returns {Promise<string|null>}
 */
async function geminiTranslatePlaceName(text, targetLang) {
  const client = getClient();
  if (!client) {
    console.warn('[translator.geminiTranslatePlaceName] GEMINI_API_KEY not set');
    return null;
  }
  try {
    const model = client.getGenerativeModel({
      model: GEMINI_VERSION,
      generationConfig: {
        temperature: 0.1, // 확정적 (place name 일관성)
        maxOutputTokens: 128,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(buildPlaceNamePrompt(text, targetLang));
    recordTranslatorUsage('translator-place', r);
    let out = (r.response.text() || '').trim();
    // Gemini 가 quotes 또는 explanation 을 반환하면 정리
    out = out.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!out) return null;

    // 응답 검증: 한글 잔존 체크 (Hangul syllable/jamo)
    // targetLang='en'의 경우 한글이 남아있으면 번역 실패로 간주.
    // targetLang='ja'/'zh'의 경우 한자(CJK)는 정상이지만 Hangul은 여전히 비정상.
    if (HANGUL_RE.test(out)) {
      console.warn(
        `[translator.geminiTranslatePlaceName] Hangul remains in ${targetLang} output — falling back to original.`,
        { input: text, output: out }
      );
      return null;
    }

    return out;
  } catch (err) {
    console.error('[translator.geminiTranslatePlaceName] gemini failed:', err.message);
    return null;
  }
}

/**
 * 4-Layer 통합 — 외국인 사용자용 한국 장소명 번역.
 *
 * 흐름:
 *   1. lang='ko' → 원문 그대로 (한국어 사용자는 한글 보존)
 *   2. Layer 2: Firestore 캐시 조회 (있으면 즉시 반환, manual 우선)
 *   3. Layer 3: 매핑 테이블 substring 매칭 (전체 치환 성공 시 캐시 후 반환)
 *   4. Layer 1: Gemini 호출 (실패 시 원문 fallback, 성공 시 캐시)
 *
 * @param {string} originalText  한글 원문 (예: "롯데호텔 명동점")
 * @param {'ko'|'en'|'ja'|'zh'} lang
 * @returns {Promise<{text: string, source: 'original'|'cache'|'mapping'|'gemini'|'fallback'}>}
 */
export async function translatePlaceName(originalText, lang) {
  const s = String(originalText || '').trim();
  if (!s) return { text: '', source: 'original' };

  // 한국어 사용자 → 한글 그대로 (어드민 본인 테스트, 한국어 사용 외국인)
  if (lang === 'ko') return { text: s, source: 'original' };
  if (!['en', 'ja', 'zh'].includes(lang)) return { text: s, source: 'original' };

  // 한글 미포함 (이미 영문/일문/중문) → 그대로 반환
  if (!HANGUL_RE.test(s)) return { text: s, source: 'original' };

  // Layer 2: Firestore 캐시
  const cached = await getCachedTranslation(s, lang);
  if (cached?.translatedText) {
    return { text: cached.translatedText, source: 'cache' };
  }

  // Layer 3: 매핑 테이블 substring 매칭
  const mapped = applyMappingTable(s, lang);
  if (mapped) {
    // 캐시에 저장 (백그라운드 — 응답 지연 방지)
    setCachedTranslation(s, lang, mapped, 'mapping', { geminiVersion: null }).catch(() => {});
    return { text: mapped, source: 'mapping' };
  }

  // Layer 1: Gemini 호출
  const gemini = await geminiTranslatePlaceName(s, lang);
  if (gemini) {
    setCachedTranslation(s, lang, gemini, 'gemini', { geminiVersion: GEMINI_VERSION }).catch(() => {});
    return { text: gemini, source: 'gemini' };
  }

  // Gemini 실패 → 원문 그대로 (silent fail X — caller 가 source 로 인지 가능)
  return { text: s, source: 'fallback' };
}

/**
 * 다중 텍스트 번역 — place-search.js 의 items 배열 일괄 처리용.
 * 동일 lang 으로 N개 항목을 병렬 번역. 실패는 원문 fallback.
 *
 * @param {string[]} texts
 * @param {'ko'|'en'|'ja'|'zh'} lang
 * @returns {Promise<Array<{text: string, source: string, original: string}>>}
 */
export async function translatePlaceNames(texts, lang) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const results = await Promise.all(
    texts.map(async (t) => {
      const r = await translatePlaceName(t, lang);
      return { text: r.text, source: r.source, original: String(t || '') };
    })
  );
  return results;
}
