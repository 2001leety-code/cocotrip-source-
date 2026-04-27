/**
 * Vercel API Route: Admin Test Push
 * POST /api/admin-test-push
 * Headers: Authorization: Bearer <Firebase-ID-token>
 * Body (선택): { title?: string, body?: string, url?: string }
 *
 * Admin 본인이 자신의 등록된 모든 push subscription에 테스트 알림 발사.
 * 결제 흐름 거치지 않고 push 동작만 검증할 때 사용.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_ai_core/firestoreAdmin.js';
import { sendPushToUser } from './_send-push.js';

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) return json(res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));

  try {
    const body = req.body || {};
    const payload = {
      title: body.title || '🔔 CocoTrip 테스트 알림',
      body: body.body || `Admin push test — ${new Date().toLocaleString('ko-KR')}`,
      url: body.url || '/mypage',
      tag: 'admin-test-' + Date.now(),
    };

    const adminDb = await initAdminDb();
    const result = await sendPushToUser(adminDb, tokenAuth.uid, payload);
    return json(res, 200, _ok({ uid: tokenAuth.uid, payload, ...result }));
  } catch (e) {
    console.error('[admin-test-push]', e);
    return json(res, 500, _err(e.message || 'send failed', 'SEND_FAILED'));
  }
}
