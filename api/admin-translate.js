/**
 * Vercel API Route: Admin AI Translate (Phase 4, 2026-05-19)
 *
 * POST /api/admin-translate
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 * Body: { korean: string, targets?: ('en'|'ja'|'zh')[], context?: string }
 *   - korean: 번역할 한국어 텍스트 (필수)
 *   - targets: 번역 대상 언어 (default ['en','ja','zh'])
 *   - context: "투어 제목" / "FAQ 답변" 같은 문맥 힌트 (선택, 번역 톤 보정용)
 *
 * Response: { ok: true, data: { en?: string, ja?: string, zh?: string } }
 *
 * Gemini 2.5 Flash 직접 호출 (fetch). maxDuration=10s.
 * 비용 절감: 단일 API 호출로 3 언어 한꺼번에 번역 (3× 호출 X).
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

function buildPrompt(korean, targets, context) {
  const langLabels = { en: 'English', ja: 'Japanese (日本語)', zh: 'Simplified Chinese (简体中文)' };
  const targetList = targets.map((t) => `"${t}": ${langLabels[t]}`).join(', ');
  const contextLine = context ? `\nContext: This is the ${context} of a tour product listing.` : '';
  return `You are a professional translator specializing in Korean tourism content.

Translate the following Korean text into the requested languages. Preserve tone, formatting (newlines, lists), and proper nouns. Use natural phrasing for native speakers of each target language.${contextLine}

Korean source:
"""
${korean}
"""

Targets: ${targetList}

Respond ONLY with a JSON object using language codes as keys. No markdown fence, no commentary. Example:
{"en":"...","ja":"...","zh":"..."}`;
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
  const korean = typeof body.korean === 'string' ? body.korean.trim() : '';
  const targets = Array.isArray(body.targets) && body.targets.length > 0
    ? body.targets.filter((t) => ['en', 'ja', 'zh'].includes(t))
    : ['en', 'ja', 'zh'];
  const context = typeof body.context === 'string' ? body.context.slice(0, 80) : '';

  if (!korean) return json(req, res, 400, _err('korean text is required', 'INVALID_INPUT'));
  if (korean.length > 4000) return json(req, res, 400, _err('text too long (max 4000 chars)', 'TOO_LONG'));
  if (targets.length === 0) return json(req, res, 400, _err('no valid targets', 'INVALID_INPUT'));

  try {
    const result = await callGemini(buildPrompt(korean, targets, context));
    // 결과에 요청한 키만 추출 (Gemini 가 추가 키 만들 수 있어)
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
