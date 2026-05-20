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
 *
 * PR #441 (Audit Y-H12 — 2026-05-16): cold-start init 강화 (module-cached bootstrap).
 *
 * Pre-fix: getAdminAuth() 가 매 요청 dynamic import + GOOGLE_SERVICE_ACCOUNT_KEY
 * 만 시도. firebase-admin.js (Firestore bootstrap) 는 FIREBASE_PROJECT_ID +
 * FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY 3-tuple 도 지원하는데 이쪽은
 * 안 함. Vercel 에 FIREBASE_* 만 설정된 환경 (prod 현재 상태) 에서 cold-start
 * 시 JSON.parse('') throw → 500 cryptic error. 또 매 요청 lazy import → cold-
 * start latency.
 *
 * Post-fix:
 *   - 같은 bootstrap 패턴 (firebase-admin.js 와 동일) 을 module 레벨에서 1회
 *   - FIREBASE_* 우선 + GOOGLE_SERVICE_ACCOUNT_KEY fallback
 *   - getApps() 재사용 (double-init 방지 — firebase-admin.js 가 이미 init 했을 수도)
 *   - 결과를 module 변수에 캐싱 → 요청당 import/init 오버헤드 제거
 *   - 인증 helper 자체가 init 실패 시 명시적 500 + 점검 안내 메시지
 */
import { Buffer } from 'buffer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let _adminAuth = null;
let _bootstrapTried = false;

function bootstrapAdminAuth() {
  if (_adminAuth) return _adminAuth;
  if (_bootstrapTried && !_adminAuth) {
    // Already tried + failed — don't retry every request, but allow ENV
    // hot-reload in dev: re-bootstrap if env vars changed since last try.
    // Cheap shortcut: just retry once per cold start (lazy re-init).
  }
  _bootstrapTried = true;

  // 1) Existing app — firebase-admin.js bootstrap may have already initialized one.
  if (getApps().length) {
    try {
      _adminAuth = getAuth(getApps()[0]);
      return _adminAuth;
    } catch (e) {
      console.warn('[admin-auth] getAuth on existing app failed:', e.message);
    }
  }

  // 2) Canonical FIREBASE_* env triple (preferred — matches firebase-admin.js)
  let credential = null;
  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    try {
      credential = cert({ projectId, clientEmail, privateKey });
    } catch (e) {
      console.warn('[admin-auth] cert() with FIREBASE_* failed:', e.message);
    }
  }

  // 3) Fallback: GOOGLE_SERVICE_ACCOUNT_KEY (base64 JSON)
  if (!credential && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const sa = JSON.parse(
        Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'),
      );
      credential = cert(sa);
    } catch (e) {
      console.warn('[admin-auth] GOOGLE_SERVICE_ACCOUNT_KEY parse failed:', e.message);
    }
  }

  if (!credential) {
    // No usable creds — caller will return 500. Don't log every request.
    return null;
  }

  try {
    const app = initializeApp({ credential });
    _adminAuth = getAuth(app);
    return _adminAuth;
  } catch (e) {
    console.error('[admin-auth] initializeApp failed:', e.message);
    return null;
  }
}

/**
 * @param {object} req - HTTP request (Vercel/Next)
 * @returns {Promise<{ok: true, email: string, uid: string, claims?: object, roles?: string[]} | {ok: false, status: number, error: string}>}
 *   - claims: decoded ID token claims (subset — admin, roles).
 *   - roles: shortcut to claims.roles (string[] or []).
 *
 * P110 (2026-05-20): admin claim 통과 시 ADMIN_EMAIL allowlist 와 동등하게
 * 인증. RBAC 마이그 Phase 1 — email 와 admin claim 양쪽 통과 허용 (점진 마이그
 * 안전). caller 는 .roles 로 행위별 분기 가능 (예: super-admin only set claims).
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

  const auth = bootstrapAdminAuth();
  if (!auth) {
    // Explicit, actionable error — no more cryptic JSON.parse stack traces.
    return {
      ok: false,
      status: 500,
      error: 'firebase-admin init failed — set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY or GOOGLE_SERVICE_ACCOUNT_KEY env vars',
    };
  }

  try {
    const decoded = await auth.verifyIdToken(m[1], true);
    const email = (decoded.email || '').toLowerCase().trim();
    if (!email || !decoded.email_verified) {
      return { ok: false, status: 403, error: 'Email not verified' };
    }
    // P110 (2026-05-20): admin claim 또는 ADMIN_EMAIL allowlist 매칭 시 통과.
    // 마이그 Phase 1 — 양쪽 동시 허용. Phase 3 (운영자 확인 후) 에 email 비교
    // 제거 + claim-only 전환. extractRoles 가 claims.roles 정규화.
    const adminClaim = decoded.admin === true;
    const emailMatch = email === adminEmail;
    if (!adminClaim && !emailMatch) {
      return { ok: false, status: 403, error: 'Not admin' };
    }
    const roles = extractRoles(decoded.roles);
    return {
      ok: true,
      email,
      uid: decoded.uid,
      claims: { admin: !!decoded.admin, roles },
      roles,
    };
  } catch (err) {
    return { ok: false, status: 401, error: `Token verification failed: ${err.code || err.message}` };
  }
}

/**
 * P110: roles claim 정규화 — string[] 형태 보장. 잘못된 형태 (undefined / 비
 * 배열 / 비 string 요소) 는 [] 반환.
 */
export function extractRoles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().toLowerCase());
}

/**
 * P110: caller 가 특정 role 검증할 때 사용. super-admin 은 모든 role 묵시
 * 통과 (정책 — super-admin 은 RBAC 우회). 그 외는 정확 매칭.
 *
 * 예: requireRole(auth.roles, 'product-manager') → super-admin 또는
 *     product-manager 보유 시 true.
 */
export function requireRole(roles, neededRole) {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  if (roles.includes('super-admin')) return true;
  return roles.includes(neededRole);
}

/**
 * Test helper — clear the cached admin auth so tests can re-bootstrap.
 * NEVER call from production code paths.
 */
export function __resetAdminAuthCacheForTests() {
  _adminAuth = null;
  _bootstrapTried = false;
}

export default verifyAdminToken;
