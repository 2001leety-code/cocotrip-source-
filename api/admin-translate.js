/**
 * Vercel API Route: Admin AI Translate (Phase 4, 2026-05-19; Reverse 2026-05-20)
 *
 * POST /api/admin-translate
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 *
 * Body (Phase 5 — 4-lang any-direction):
 *   { source: { lang: 'ko'|'en'|'ja'|'zh', text: string },
 *     targets?: ('ko'|'en'|'ja'|'zh')[], context?: string }
 *
 * Body (Phase 4 backward compat — deprecated):
 *   { korean: string, targets?: ('en'|'ja'|'zh')[], context?: string }
 *   → 내부적으로 source={lang:'ko', text:korean} 로 변환.
 *
 *   - source.text: 번역할 텍스트 (필수)
 *   - source.lang: 텍스트의 언어 코드 (필수)
 *   - targets: 번역 대상 언어 (default = 4-lang 전체 − source.lang).
 *              source.lang 이 targets 에 포함돼도 자동 제거 (self-target skip).
 *   - context: "투어 제목" / "FAQ 답변" 같은 문맥 힌트 (선택, 번역 톤 보정용)
 *
 * Response: { ok: true, data: { ko?: string, en?: string, ja?: string, zh?: string } }
 *   (source.lang 키는 결과에서 제외)
 *
 * Gemini 2.0 Flash 직접 호출 (fetch). maxDuration=10s.
 * 비용: source 가 어느 lang 이든 단일 호출로 N target lang 일괄 번역 (N×호출 X).
 *
 * 사용 시나리오:
 *   1. ko 입력 → en/ja/zh 자동 (Phase 4 기존 동작)
 *   2. en 입력 (GYG/Klook 마켓플레이스 import) → ko/ja/zh 자동
 *   3. ja 입력 (외주 일본인 운영자) → ko/en/zh 자동
 *   4. zh 입력 (중국어 후기 인용 등) → ko/en/ja 자동
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export const config = { runtime: 'nodejs', maxDuration: 10 };

const CORS_METHODS = 'POST, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const GEMINI_MODEL = 'gemini-2.0-flash';

const SOURCE_LANG_LABELS = {
  ko: 'Korean (한국어)',
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Simplified Chinese (简体中文)',
};

export const ALL_LANGS = ['ko', 'en', 'ja', 'zh'];

/**
 * Resolve incoming request body to a { source, targets } shape. Returns null
 * source when body is malformed (caller emits 400). Supports both Phase 5
 * body ({ source: { lang, text }, targets? }) and legacy Phase 4 body
 * ({ korean, targets? }) — the legacy path is treated as source.lang='ko'.
 *
 * Exported for unit-test introspection.
 */
export function resolveSourceAndTargets(body) {
  let source = null;
  if (body && body.source && typeof body.source === 'object') {
    const srcLang = body.source.lang;
    const srcText = typeof body.source.text === 'string' ? body.source.text.trim() : '';
    if (ALL_LANGS.includes(srcLang) && srcText) {
      source = { lang: srcLang, text: srcText };
    }
  } else if (body && typeof body.korean === 'string' && body.korean.trim()) {
    source = { lang: 'ko', text: body.korean.trim() };
  }
  if (!source) return { source: null, targets: [] };

  const requestedTargets = Array.isArray(body.targets) && body.targets.length > 0
    ? body.targets.filter((t) => ALL_LANGS.includes(t))
    : ALL_LANGS.slice();
  const targets = requestedTargets.filter((t) => t !== source.lang);
  return { source, targets };
}

/**
 * Source-aware translation prompt. Generates JSON-only output for the listed
 * target lang codes. source.lang is omitted from targets automatically.
 *
 * Exported for unit-test introspection (tests/unit/admin-translate-prompt.test.ts).
 */
export function buildPrompt(source, targets, context) {
  const srcLabel = SOURCE_LANG_LABELS[source.lang];
  const effectiveTargets = targets.filter((t) => t !== source.lang);
  const targetList = effectiveTargets.map((t) => `"${t}": ${SOURCE_LANG_LABELS[t]}`).join(', ');
  const contextLine = context ? `\nContext: This is the ${context} of a tour product listing.` : '';
  // Example block reflects the actual requested targets (helps Gemini stay
  // on-schema when ja/zh are excluded, e.g. en source + only ko target).
  const examplePairs = effectiveTargets.map((t) => `"${t}":"..."`).join(',');
  return `You are a professional translator specializing in Korean tourism content.

Translate the following ${srcLabel} text into the requested target languages. Preserve tone, formatting (newlines, lists), and proper nouns. Use natural phrasing for native speakers of each target language.${contextLine}

Source (${srcLabel}):
"""
${source.text}
"""

Targets: ${targetList}

Respond ONLY with a JSON object using language codes as keys. No markdown fence, no commentary. Example:
{${examplePairs}}`;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini empty response');

  // responseMimeType=application/json 이라 그대로 parse. 혹시 markdown fence 가 섞이면 strip.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini response not JSON: ${cleaned.slice(0, 200)}`);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) return json(req, res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));

  const body = req.body || {};

  // Phase 5 (2026-05-20): source object 우선. legacy { korean: string } body 도
  // backward compat (source={lang:'ko', text:korean} 로 변환). 운영자가 외국어
  // 텍스트를 source 로 번역 호출하려면 새 body 형식 사용 — I18nField 각 lang
  // ✨ 버튼이 이 경로 사용. P104~ 어드민 상품 시스템 시너지.
  const { source, targets } = resolveSourceAndTargets(body);

  if (!source) {
    return json(req, res, 400, _err(
      'source.{lang,text} or legacy korean field is required',
      'INVALID_INPUT',
    ));
  }
  if (source.text.length > 4000) {
    return json(req, res, 400, _err('text too long (max 4000 chars)', 'TOO_LONG'));
  }
  if (targets.length === 0) {
    return json(req, res, 400, _err('no valid targets after self-skip', 'INVALID_INPUT'));
  }
  const context = typeof body.context === 'string' ? body.context.slice(0, 80) : '';

  try {
    const result = await callGemini(buildPrompt(source, targets, context));
    // 결과에 요청한 키만 추출 (Gemini 가 추가 키 만들 수 있어). source.lang 은
    // 항상 제외 (위 targets 필터링으로 이미 제거됐지만 방어).
    const filtered = {};
    for (const t of targets) {
      if (typeof result[t] === 'string') filtered[t] = result[t];
    }
    if (Object.keys(filtered).length === 0) {
      return json(req, res, 502, _err('translation result empty', 'TRANSLATION_EMPTY'));
    }
    return json(req, res, 200, _ok(filtered));
  } catch (e) {
    console.error('[admin-translate]', e);
    return json(req, res, 500, _err(e.message || 'translate failed', 'TRANSLATE_FAILED'));
  }
}
