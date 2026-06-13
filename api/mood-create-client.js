/**
 * POST /api/mood-create-client — MOOD 광고사(client) 생성 (운영자 전용)
 *
 * mood_clients/{clientId} 생성 (잔액 0). 충전(mood-topup)·예약(mood-book)의 대상.
 * 첫 client 면 mood_config/allowlist.clientId 에 자동 지정(단일-client v1 기본값) —
 *   clientId 필드만 merge 로 세팅하고 admins/emails(접근권한)는 절대 건드리지 않음.
 *
 * 인증: Authorization: Bearer <Firebase ID token>, email 이 allowlist.admins 에 있어야 함.
 *   (mood-topup.js 와 동일 게이트.)
 *
 * Body: { name (필수, <=100자), clientId (선택 — 영문/숫자/하이픈 2~50, 미입력 시 자동생성) }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{2,50}$/;

/** 이름 기반 slug + 랜덤 접미. 한글 등 비영문이면 random 만. */
function generateClientId(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  const rand = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${rand}` : `client-${rand}`;
}

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  // 돈/잔액 엔티티 생성 경계 — 미검증 이메일 토큰 차단 (mood-topup 동일).
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }
  const email = auth.email;

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const name = String(body.name || '').trim();
  if (!name || name.length > 100) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'name 필수 (100자 이하)' }));
  }

  let clientId = String(body.clientId || '').trim();
  if (clientId && !CLIENT_ID_RE.test(clientId)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'clientId 는 영문/숫자/하이픈 2~50자' }));
  }
  if (!clientId) clientId = generateClientId(name);

  try {
    const db = initAdminDb('mood-create-client');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // 운영자(admins) 만 — allowlist.emails 만으로는 부족.
    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const clientRef = db.collection('mood_clients').doc(clientId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(clientRef);
      if (snap.exists) return { ok: false, status: 409, error: 'CLIENT_EXISTS' };
      tx.set(clientRef, { name, balanceKRW: 0, createdByEmail: email, createdAt: Date.now() });
      return { ok: true };
    });
    if (!result.ok) {
      res.writeHead(result.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error }));
    }

    // 첫 client → 단일-client v1 기본값 지정. clientId 필드만 merge(접근권한 admins/emails 무변경).
    let setAsDefault = false;
    if (!allowlist.clientId) {
      await db.collection('mood_config').doc('allowlist').set({ clientId }, { merge: true });
      setAsDefault = true;
    }

    console.log('[mood-create-client]', email, '→', clientId, '|', name, setAsDefault ? '(기본지정)' : '');
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, data: { clientId, name, setAsDefault } }));
  } catch (err) {
    console.error('[mood-create-client] failed:', err.message);
    await captureError(err, { route: '/api/mood-create-client', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
