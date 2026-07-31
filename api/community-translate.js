/**
 * Vercel API Route: Community Translation (원탭 번역 — UIUX 가이드 P9 'Ask & Translate')
 *   POST /api/community-translate
 *   Body: { postId, replyId?, targetLang: 'ko'|'en'|'ja'|'zh' }
 *
 * 2026-07-12 실전화 백엔드 3/3.
 * 흐름: Firestore translations.<lang> 캐시 조회 → 없으면 Gemini 2.5 Flash 번역
 *       (_shared/translator.js 재사용) → 캐시 저장 → 반환.
 * 같은 글은 언어당 1회만 Gemini 호출 = 비용 상한이 글 수 × 3 에 고정.
 * 익명 허용(읽기 편의) — IP rate limit 시간당 30건으로 abuse 차단.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { translate } from './_shared/translator.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LANGS = new Set(['ko', 'en', 'ja', 'zh']);

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}
const _ok = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { postId, targetLang } = body;
    const replyId = typeof body.replyId === 'string' ? body.replyId : null;

    if (!postId || typeof postId !== 'string') return json(res, 400, _err('postId required', 'MISSING_POST_ID'));
    if (!LANGS.has(targetLang)) return json(res, 400, _err('invalid targetLang', 'INVALID_LANG'));

    const db = initAdminDb('community-translate');
    if (!db) return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));

    const ipCheck = await checkIpRateLimit({
      db, ip: getClientIp(req), collection: 'community_rate_limits', maxRequests: 30, errorLabel: 'community translations',
    });
    if (!ipCheck.ok) return json(res, ipCheck.status, _err(ipCheck.error, 'RATE_LIMITED'));

    // 🔴 2026-07-30 (P1-3): 댓글 번역은 **부모 글이 살아 있을 때만** 준다.
    //   이전에는 댓글 문서의 status 만 봤다. 글이 숨겨지거나(신고 검토) 삭제돼도 그 아래 댓글은
    //   status='active' 로 남으므로, replyId 만 알면 숨겨진 글의 대화 내용을 계속 꺼낼 수 있었다.
    //   (원문 언어 요청 `d.lang === targetLang` 도 이 검사 뒤에 있으므로 같이 막힌다.)
    const postRef = db.collection('community_posts').doc(postId);
    if (replyId) {
      const parent = await postRef.get();
      if (!parent.exists || parent.data().status !== 'active') {
        return json(res, 404, _err('Not found', 'NOT_FOUND'));
      }
    }

    const docRef = replyId ? postRef.collection('replies').doc(replyId) : postRef;
    const doc = await docRef.get();
    if (!doc.exists || doc.data().status !== 'active') return json(res, 404, _err('Not found', 'NOT_FOUND'));

    const d = doc.data();
    if (d.lang === targetLang) {
      return json(res, 200, _ok({ title: d.title || null, body: d.body, cached: true, isOriginal: true }));
    }

    // 캐시 히트?
    const cached = d.translations && d.translations[targetLang];
    if (cached && cached.body) {
      return json(res, 200, _ok({ title: cached.title || null, body: cached.body, cached: true }));
    }

    // Gemini 번역 (글 = 제목+본문, 댓글 = 본문만)
    const [tTitle, tBody] = await Promise.all([
      d.title ? translate(d.title, targetLang) : Promise.resolve(null),
      translate(d.body, targetLang),
    ]);
    if (!tBody) return json(res, 502, _err('Translation failed — try again later', 'TRANSLATE_FAILED'));

    const entry = { title: tTitle || null, body: tBody };
    await docRef.update({ [`translations.${targetLang}`]: entry });
    return json(res, 200, _ok({ ...entry, cached: false }));
  } catch (err) {
    console.error('[community-translate]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
