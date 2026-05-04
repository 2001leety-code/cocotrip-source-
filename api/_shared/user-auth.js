/**
 * Firebase ID Token user verification (non-admin variant of admin-auth.js).
 *
 * Audit P0-#2 fix (2026-05-04): /api/ai-planner-full 등에서 body.email 신뢰 → 인증된 email 사용.
 * 클라이언트는 `Authorization: Bearer <ID-token>` 헤더로 호출.
 * 서버는 firebase-admin auth().verifyIdToken() 으로 검증 후 인증된 email/uid 반환.
 *
 * 패턴 출처: api/_shared/admin-auth.js (admin 검증) — 동일한 토큰 검증 + email 추출.
 *
 * 사용 예시:
 *   import { verifyUserToken } from './_shared/user-auth.js';
 *   const auth = await verifyUserToken(req);
 *   if (!auth.ok) {
 *     res.writeHead(auth.status, { 'Content-Type': 'application/json' });
 *     return res.end(JSON.stringify({ ok: false, error: auth.error }));
 *   }
 *   const userEmail = auth.email; // 인증된 email — body.email 무시
 */
import { Buffer } from 'buffer';

async function getAuthInstance() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8'));
    initializeApp({ credential: cert(sa) });
  }
  return getAuth();
}

/**
 * @param {object} req - HTTP request (Vercel/Next)
 * @returns {Promise<{ok: true, email: string, uid: string, emailVerified: boolean} | {ok: false, status: number, error: string}>}
 */
export async function verifyUserToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) {
    return { ok: false, status: 401, error: 'Authorization Bearer token required' };
  }
  try {
    const decoded = await (await getAuthInstance()).verifyIdToken(m[1], true);
    const email = (decoded.email || '').toLowerCase().trim();
    if (!email) {
      return { ok: false, status: 403, error: 'Token has no email claim' };
    }
    return {
      ok: true,
      email,
      uid: decoded.uid,
      emailVerified: !!decoded.email_verified,
    };
  } catch (err) {
    return { ok: false, status: 401, error: `Token verification failed: ${err.code || err.message}` };
  }
}

export default verifyUserToken;
