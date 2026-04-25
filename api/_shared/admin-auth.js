/**
 * Firebase ID Token 기반 admin 인증 헬퍼
 *
 * 클라이언트는 `Authorization: Bearer <ID-token>` 헤더로 호출.
 * 서버는 firebase-admin auth().verifyIdToken() 으로 검증 후 ADMIN_EMAIL 비교.
 *
 * 사용 예시:
 *   import { verifyAdminToken } from './_shared/admin-auth.js';
 *   const auth = await verifyAdminToken(req);
 *   if (!auth.ok) { res.writeHead(auth.status, ...); return res.end(JSON.stringify({error: auth.error})); }
 *   // proceed — auth.email 은 검증된 admin 이메일
 */
import { Buffer } from 'buffer';

async function getAdminAuth() {
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
 * @returns {Promise<{ok: true, email: string, uid: string} | {ok: false, status: number, error: string}>}
 */
export async function verifyAdminToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) {
    return { ok: false, status: 401, error: 'Authorization Bearer token required' };
  }

  const adminEmail = (process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || '').toLowerCase().trim();
  if (!adminEmail) {
    return { ok: false, status: 500, error: 'ADMIN_EMAIL env var not configured' };
  }

  try {
    const decoded = await (await getAdminAuth()).verifyIdToken(m[1], true);
    const email = (decoded.email || '').toLowerCase().trim();
    if (!email || !decoded.email_verified) {
      return { ok: false, status: 403, error: 'Email not verified' };
    }
    if (email !== adminEmail) {
      return { ok: false, status: 403, error: 'Not admin' };
    }
    return { ok: true, email, uid: decoded.uid };
  } catch (err) {
    return { ok: false, status: 401, error: `Token verification failed: ${err.code || err.message}` };
  }
}

export default verifyAdminToken;
