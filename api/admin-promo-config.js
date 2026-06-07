/**
 * GET/POST /api/admin-promo-config — 프로모 배너 + 팝업 설정 어드민 관리.
 *   GET                           : 현재 설정 읽기 (banner + popup 모두).
 *   POST {target:'banner', config}: 배너 설정 저장.
 *   POST {target:'popup',  config}: 팝업 설정 저장.
 *   POST {config} (target 없음)   : 배너 호환 (기존 PromoBannerPanel 클라이언트 호환).
 * admin 인증 필수 (verifyAdminToken). admin-runtime-flags.js 패턴 동일.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import {
  getPromoConfig, setPromoConfig,
  getPopupConfig, setPopupConfig,
} from './_shared/promo-config.js';

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
    // 배너 + 팝업 병렬 조회
    const [banner, popup] = await Promise.all([getPromoConfig(db), getPopupConfig(db)]);
    res.writeHead(200, HEADERS);
    return res.end(JSON.stringify({ ok: true, banner, popup }));
  }

  // POST — 설정 저장
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const inputConfig = body && body.config;
  if (!inputConfig || typeof inputConfig !== 'object') {
    res.writeHead(400, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '{ config: {...} } 형식 필요' }));
  }

  // target 분기: 'popup' → 팝업, 그 외(없거나 'banner') → 배너 (기존 호환)
  const target = body.target || 'banner';
  let result;
  if (target === 'popup') {
    result = await setPopupConfig(db, inputConfig, auth.email);
  } else {
    result = await setPromoConfig(db, inputConfig, auth.email);
  }
  if (!result.ok) {
    res.writeHead(400, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: result.error }));
  }

  console.log('[admin-promo-config] updated by', auth.email, 'target:', target, 'keys:', Object.keys(inputConfig).join(','));
  // 갱신 후 banner + popup 모두 반환
  const [banner, popup] = await Promise.all([getPromoConfig(db), getPopupConfig(db)]);
  res.writeHead(200, HEADERS);
  return res.end(JSON.stringify({ ok: true, banner, popup }));
}
