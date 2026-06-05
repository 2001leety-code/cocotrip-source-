/**
 * GET/POST /api/admin-runtime-flags — 어드민 조종석 런타임 토글 (2026-06-06).
 *   GET            : 현재 플래그 값 + 화이트리스트 스키마(label/desc).
 *   POST {key,value}: 화이트리스트 플래그 1개 토글 (value=boolean).
 * admin 인증 필수 (verifyAdminToken). RUNTIME_FLAG_KEYS 화이트리스트만 허용 (임의 키 거부).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getRuntimeFlags, setRuntimeFlag, RUNTIME_FLAG_KEYS } from './_shared/runtime-flags.js';

export const config = { runtime: 'nodejs' };
const CORS_METHODS = 'GET, POST, OPTIONS';

export default async function handler(req, res) {
  const HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };
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
  const db = initAdminDb('admin-runtime-flags');
  if (!db) {
    res.writeHead(500, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'adminDb unavailable' }));
  }

  if (req.method === 'GET') {
    const flags = await getRuntimeFlags(db);
    res.writeHead(200, HEADERS);
    return res.end(JSON.stringify({ ok: true, flags, schema: RUNTIME_FLAG_KEYS }));
  }

  // POST — 토글 set
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const key = body && body.key;
  const value = body && body.value;
  if (!RUNTIME_FLAG_KEYS[key] || typeof value !== 'boolean') {
    res.writeHead(400, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'key(화이트리스트) + value(boolean) 필요' }));
  }
  const okSet = await setRuntimeFlag(db, key, value, auth.email);
  if (!okSet) {
    res.writeHead(500, HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'set 실패' }));
  }
  console.log('[admin-runtime-flags] set', key, '=', value, 'by', auth.email);
  const flags = await getRuntimeFlags(db);
  res.writeHead(200, HEADERS);
  return res.end(JSON.stringify({ ok: true, flags, schema: RUNTIME_FLAG_KEYS }));
}
