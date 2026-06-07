/**
 * GET/POST /api/admin-promo-config — 프로모 배너 설정 어드민 관리.
 *   GET         : 현재 설정 읽기.
 *   POST {config}: 화이트리스트 필드 검증 후 저장, 갱신된 설정 반환.
 * admin 인증 필수 (verifyAdminToken). admin-runtime-flags.js 패턴 동일.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getPromoConfig, setPromoConfig } from './_shared/promo-config.js';

export const config = { runtime: 'nodejs' };
const CORS_METHODS = 'GET, POST, OPTIONS';

export default async function handler(req, res) {
  const HEADERS = {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }),
  };
  if (req.method === 'OPTIONS') { res.writeHead(200, HEADERS); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET/POST only' }));
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status || 401, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const db = initAdminDb('admin-promo-config');
  if (!db) {
    res.writeHead(500, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'adminDb unavailable' }));
  }

  if (req.method === 'GET') {
    const promoConfig = await getPromoConfig(db);
    res.writeHead(200, HEADERS);
    return res.end(JSON.stringify({ ok: true, config: promoConfig }));
  }

  // POST — 설정 저장
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const inputConfig = body && body.config;
  if (!inputConfig || typeof inputConfig !== 'object') {
    res.writeHead(400, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '{ config: {...} } 형식 필요' }));
  }

  const result = await setPromoConfig(db, inputConfig, auth.email);
  if (!result.ok) {
    res.writeHead(400, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: result.error }));
  }

  console.log('[admin-promo-config] updated by', auth.email, 'keys:', Object.keys(inputConfig).join(','));
  const promoConfig = await getPromoConfig(db);
  res.writeHead(200, HEADERS);
  return res.end(JSON.stringify({ ok: true, config: promoConfig }));
}
