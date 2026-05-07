/**
 * /api/admin-translations — 운영자 번역 캐시 검수 엔드포인트 (Layer 4 backend).
 *
 * 모든 메서드는 Authorization: Bearer <Firebase ID token> 필수, ADMIN_EMAIL 매칭만 허용.
 *
 *   GET    /api/admin-translations?lang=en&source=manual&search=롯데&limit=50&offset=0
 *          → { items: [{id, lang, originalText, translatedText, source, updatedAt, updatedBy}], total }
 *
 *   PATCH  /api/admin-translations
 *          body: { originalText, lang, translatedText }
 *          → 운영자 수동 수정 (source='manual' 마킹). 이후 Gemini 재번역 안 됨.
 *
 *   DELETE /api/admin-translations
 *          body: { docId } (또는 { originalText, lang })
 *          → 항목 삭제 → 다음 호출 시 Gemini 재번역.
 *
 * 한국어 admin 정책 — i18n 키 X, 인라인 한국어. 사용자 미노출.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import {
  listCachedTranslations,
  updateManualTranslation,
  deleteCachedTranslation,
} from './_shared/place-translation-cache.js';
import { wrapHandler, captureError } from './_shared/sentry.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

function json(res, status, body) {
  res.writeHead(status, JSON_CORS);
  return res.end(JSON.stringify(body));
}

async function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });
  }

  try {
    if (req.method === 'GET') {
      const lang   = (req.query?.lang   || '').toString().trim().toLowerCase();
      const source = (req.query?.source || '').toString().trim().toLowerCase();
      const search = (req.query?.search || '').toString().trim();
      const limit  = Math.min(Math.max(parseInt(req.query?.limit  || '50', 10), 1), 500);
      const offset = Math.max(parseInt(req.query?.offset || '0', 10), 0);

      const result = await listCachedTranslations({
        lang: lang || undefined,
        source: source || undefined,
        search: search || undefined,
        limit,
        offset,
      });
      return json(res, 200, {
        items: result.items,
        total: result.total,
        offset,
        limit,
        generatedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const originalText   = String(body?.originalText   || '').trim();
      const lang           = String(body?.lang           || '').trim().toLowerCase();
      const translatedText = String(body?.translatedText || '').trim();

      if (!originalText || !translatedText) {
        return json(res, 400, { error: 'originalText 와 translatedText 모두 필요', code: 'BAD_REQUEST' });
      }
      if (!['en', 'ja', 'zh'].includes(lang)) {
        return json(res, 400, { error: 'lang 은 en/ja/zh 중 하나', code: 'BAD_LANG' });
      }

      const ok = await updateManualTranslation(originalText, lang, translatedText, auth.email);
      if (!ok) {
        return json(res, 500, { error: 'Firestore 업데이트 실패', code: 'UPDATE_FAILED' });
      }
      return json(res, 200, { ok: true, updatedBy: auth.email, source: 'manual' });
    }

    if (req.method === 'DELETE') {
      const body = await readBody(req);
      const docId = String(body?.docId || '').trim();
      if (!docId) {
        return json(res, 400, { error: 'docId 필요', code: 'BAD_REQUEST' });
      }
      const ok = await deleteCachedTranslation(docId);
      if (!ok) {
        return json(res, 500, { error: 'Firestore 삭제 실패', code: 'DELETE_FAILED' });
      }
      return json(res, 200, { ok: true, docId });
    }

    return json(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    await captureError(err, { route: '/api/admin-translations', method: req.method });
    console.error('[admin-translations] error:', err);
    return json(res, 500, { error: err.message, code: 'ADMIN_TRANSLATIONS_FAILED' });
  }
}

export default wrapHandler(handler);
