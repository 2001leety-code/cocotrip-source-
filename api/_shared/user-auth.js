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

/**
 * 게스트 전용 익명 Firebase idToken 검증. 결제 인증(verifyUserToken)과 분리된 채널.
 * x-guest-anon-token 헤더에서 토큰을 읽어 sign_in_provider==='anonymous' 인 경우만 uid 반환.
 * 익명 토큰만 허용 = 실제 계정 uid 사칭(plan.uid 주입)으로 남의 플랜 목록에 주입하는 것 방지.
 *
 * @param {object} req - HTTP request (Vercel/Next)
 * @returns {Promise<{ok: true, uid: string} | {ok: false}>}
 */
export async function verifyGuestAnonToken(req) {
  const raw = req.headers?.['x-guest-anon-token'] || '';
  const tokenStr = Array.isArray(raw) ? raw[0] : String(raw || '');
  if (!tokenStr) return { ok: false };
  try {
    const decoded = await (await getAuthInstance()).verifyIdToken(tokenStr, true);
    const provider = decoded.firebase && decoded.firebase.sign_in_provider;
    if (provider !== 'anonymous') return { ok: false };
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false };
  }
}

/**
 * FEATURE_GUEST_ANON_AUTH: 게스트(비로그인) 플랜 소유자 uid 해석.
 * 플래그 ON + 로그인 uid 없음 + 유효한 익명 토큰일 때만 격리된 익명 uid 부여.
 * 그 외 전부 { planOwnerUid: uid(원본), forceGuestToken: false } = 기존 동작 byte-identical.
 *
 * 결제/버킷팅/로깅 이후 호출 = 그 경로엔 영향 0 (planOwnerUid 는 persistence 4곳에서만 사용).
 * graceful: verifyGuestAnonToken throw 시 게스트 uid=null 로 진행 (기존 동작).
 *
 * @param {object} req
 * @param {string|null|undefined} uid - 로그인 사용자 uid (없으면 게스트)
 * @returns {Promise<{ planOwnerUid: string|null|undefined, forceGuestToken: boolean }>}
 */
export async function resolveGuestAnonOwner(req, uid) {
  if (uid || String(process.env.FEATURE_GUEST_ANON_AUTH || '').toLowerCase() !== 'true') {
    return { planOwnerUid: uid, forceGuestToken: false };
  }
  try {
    const guestAnon = await verifyGuestAnonToken(req);
    if (guestAnon.ok) return { planOwnerUid: guestAnon.uid, forceGuestToken: true };
  } catch { /* graceful */ }
  return { planOwnerUid: uid, forceGuestToken: false };
}

/**
 * 게스트(비로그인) AI 플래너 결제 허용 여부 — 순수 함수 (handlerCore 가 사용).
 *
 * 광고 유입 손님이 가입 없이 바로 결제하게 하는 핵심 가드. 허용 조건 (전부 AND):
 *   1. authOk=false (비로그인) — 로그인 사용자는 기존 경로(이 함수 무관).
 *   2. flagOn (FEATURE_GUEST_ANON_AUTH) — OFF(기본)면 항상 false = 기존 401 byte-identical.
 *   3. !revisionOf — revision 은 원본 소유자 필요 → 게스트 불가.
 *   4. paypalOrderId 가 **일반 PayPal order**(prefix 없는 10자+ alphanumeric).
 *      ⚠️ ADMIN-BYPASS-/TEST-/MANUAL- prefix 는 '-' 를 포함 → 정규식 불일치 → 게스트 불가.
 *      = 게스트는 admin 무료우회·TEST 모드·수동결제 경로로 권한 위조 못 함(paymentGate 가드 유지).
 *      실제 결제 인증은 paymentGate 가 PayPal order API 로 수행 (이 함수는 진입 게이트일 뿐).
 *
 * @param {{authOk: boolean, flagOn: boolean, revisionOf?: any, paypalOrderId?: any}} p
 * @returns {boolean}
 */
export function isGuestCheckoutAllowed({ authOk, flagOn, revisionOf, paypalOrderId } = {}) {
  if (authOk) return false;
  if (!flagOn) return false;
  if (revisionOf) return false;
  const pid = typeof paypalOrderId === 'string' ? paypalOrderId : '';
  return /^[A-Za-z0-9]{10,}$/.test(pid);
}

export default verifyUserToken;
