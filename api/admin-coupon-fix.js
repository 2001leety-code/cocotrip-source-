/**
 * Vercel API Route: Admin Coupon Fix — 회원가입 쿠폰 0건 회원 1-click 보정
 * POST /api/admin-coupon-fix
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 * Body:    { uid?: string, email?: string }
 * Production only. Other environments are rejected before Firebase modules load.
 *
 * 배경: PR #253 silent fail 후 일부 회원의 onboarding 5% 쿠폰 2장이 발급되지 않음.
 * 운영자가 uid 또는 이메일로 검출 + onboarding-coupons 발급 helper 호출.
 *
 * 멱등성: users/{uid}.onboardingCouponsIssued===true 면 즉시 alreadyIssued:true 반환.
 *
 * 결과:
 *   - { ok:true, data:{ uid, issued:2, alreadyIssued:false } }   → 신규 발급
 *   - { ok:true, data:{ uid, issued:0, alreadyIssued:true } }    → 이미 발급됨 (멱등)
 *   - { ok:false, error:... , code: 'AUTH_FAILED' | 'USER_NOT_FOUND' | ... }
 */
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'POST, OPTIONS';

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

// 두 입력 경로 모두 Auth 사용자 존재를 확인한다. UID가 있으면 기존 우선순위를 유지한다.
async function lookupUidFromAuth(uid, email) {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || '';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (projectId && clientEmail && privateKey) {
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
      initializeApp({ credential: cert(sa) });
    } else {
      throw new Error('Firebase admin credentials missing');
    }
  }
  const auth = getAuth();
  const userRecord = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email);
  return userRecord.uid;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'POST') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  if (process.env.VERCEL_ENV !== 'production') {
    return json(req, res, 503, _err('Coupon recovery is unavailable outside production', 'RECOVERY_PRODUCTION_ONLY'));
  }

  // Preserve the production bootstrap path without loading it in Preview/local.
  // onboarding-coupons also imports firebase-admin, so it must stay behind this gate.
  let verifyAdminToken, initAdminDb, issueOnboardingCouponsForUid;
  try {
    ({ verifyAdminToken } = await import('./_shared/admin-auth.js'));
    ({ initAdminDb } = await import('./_shared/firebase-admin.js'));
    ({ issueOnboardingCouponsForUid } = await import('./onboarding-coupons.js'));
  } catch {
    console.error('[admin-coupon-fix] recovery runtime import failed');
    return json(req, res, 500, _err('Coupon recovery runtime unavailable', 'RECOVERY_RUNTIME_UNAVAILABLE'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(req, res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  let { uid, email } = body;
  // Non-string identifiers (e.g. {uid:123}) are a bad request, not an unhandled 500.
  if ((uid != null && typeof uid !== 'string') || (email != null && typeof email !== 'string')) {
    return json(req, res, 400, _err('uid and email must be strings', 'INVALID_FIELDS'));
  }
  uid = (uid || '').trim();
  email = (email || '').trim().toLowerCase();

  if (!uid && !email) {
    return json(req, res, 400, _err('uid or email required', 'MISSING_FIELDS'));
  }

  try {
    const db = initAdminDb('admin-coupon-fix');
    if (!db) {
      return json(req, res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    // 직접 입력한 UID도 Auth 조회를 통과해야 발급 함수로 전달한다.
    try {
      uid = await lookupUidFromAuth(uid, email);
    } catch (lookupErr) {
      if (lookupErr.code === 'auth/user-not-found') {
        const target = uid ? `uid: ${uid}` : `email: ${email}`;
        return json(req, res, 404, _err(`User not found for ${target}`, 'USER_NOT_FOUND'));
      }
      throw lookupErr;
    }

    if (!uid) {
      return json(req, res, 400, _err('uid resolution failed', 'MISSING_FIELDS'));
    }

    const result = await issueOnboardingCouponsForUid(db, uid, {
      audit: { callerUid: tokenAuth.uid, callerEmail: tokenAuth.email, action: 'onboarding_coupon_fix' },
    });
    console.log('[admin-coupon-fix] uid=', uid, 'email=', email || '(via uid)', 'result=', result);

    return json(req, res, 200, _ok({ uid, email: email || null, ...result }));
  } catch (err) {
    console.error('[admin-coupon-fix]', err);
    await captureError(err, { route: '/api/admin-coupon-fix', method: req.method });
    return json(req, res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
