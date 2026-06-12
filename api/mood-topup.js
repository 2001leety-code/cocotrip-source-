/**
 * POST /api/mood-topup — MOOD 선불 충전 (운영자 전용)
 *
 * 광고사 client 의 선불 잔액 (mood_clients/{clientId}.balanceKRW) 을 증가.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.admins (운영자만) 에 없으면 403.
 *     (allowlist.emails 만 있고 admins 가 아닌 광고사 직원은 충전 불가.)
 *
 * Body: { clientId, amountKRW (양의 정수) }
 *
 * runTransaction 으로 ① 잔액 += amountKRW ② mood_topups 이력 기록 (한 트랜잭션).
 * client doc 이 없으면 생성하지 않음 (운영자가 먼저 client 등록해야 함) → CLIENT_NOT_FOUND.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;
  // 돈 변경 경계 — 미검증 이메일 토큰 차단 (defense-in-depth).
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { clientId, amountKRW } = body;

  if (!clientId || typeof clientId !== 'string') {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'clientId 필수' }));
  }
  const amount = Number(amountKRW);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'amountKRW 는 양의 숫자' }));
  }

  try {
    const db = initAdminDb('mood-topup');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // 운영자(admins) 만 충전 가능 — allowlist.emails 만으로는 부족.
    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '충전 권한 없음 (운영자 전용)' }));
    }

    const clientRef = db.collection('mood_clients').doc(clientId);
    const topupRef = db.collection('mood_topups').doc();

    const txResult = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      }
      const clientData = clientSnap.data() || {};
      const balanceKRW = Number(clientData.balanceKRW) || 0;
      const newBalance = balanceKRW + amount;
      const at = Date.now();

      tx.update(clientRef, { balanceKRW: newBalance });
      tx.set(topupRef, {
        clientId,
        amountKRW: amount,
        byEmail: email,
        at,
      });

      return { ok: true, topupId: topupRef.id, newBalance, clientName: clientData.name || clientId };
    });

    if (!txResult.ok) {
      res.writeHead(txResult.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: txResult.error }));
    }

    console.log('[mood-topup]', email, '→', clientId, '+', amount, '원 | 잔액', txResult.newBalance);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: { topupId: txResult.topupId, clientId, balanceKRW: txResult.newBalance },
    }));
  } catch (err) {
    console.error('[mood-topup] failed:', err.message);
    await captureError(err, { route: '/api/mood-topup', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
