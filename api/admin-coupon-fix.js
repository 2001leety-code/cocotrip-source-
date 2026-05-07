/**
 * Vercel API Route: Admin Coupon Fix — 회원가입 쿠폰 0건 회원 1-click 보정
 * POST /api/admin-coupon-fix
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 * Body:    { uid?: string, email?: string }
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
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { issueOnboardingCouponsForUid } from './onboarding-coupons.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

// 이메일 → uid 조회 (firebase-admin auth getUserByEmail).
async function lookupUidByEmail(email) {
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
  const userRecord = await getAuth().getUserByEmail(email);
  return userRecord.uid;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  let { uid, email } = body;
  uid = (uid || '').trim();
  email = (email || '').trim().toLowerCase();

  if (!uid && !email) {
    return json(res, 400, _err('uid or email required', 'MISSING_FIELDS'));
  }

  try {
    const db = initAdminDb('admin-coupon-fix');
    if (!db) {
      return json(res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    // 이메일 → uid 변환
    if (!uid && email) {
      try {
        uid = await lookupUidByEmail(email);
      } catch (lookupErr) {
        if (lookupErr.code === 'auth/user-not-found') {
          return json(res, 404, _err(`User not found for email: ${email}`, 'USER_NOT_FOUND'));
        }
        throw lookupErr;
      }
    }

    if (!uid) {
      return json(res, 400, _err('uid resolution failed', 'MISSING_FIELDS'));
    }

    const result = await issueOnboardingCouponsForUid(db, uid);
    console.log('[admin-coupon-fix] uid=', uid, 'email=', email || '(via uid)', 'result=', result);

    return json(res, 200, _ok({ uid, email: email || null, ...result }));
  } catch (err) {
    console.error('[admin-coupon-fix]', err);
    await captureError(err, { route: '/api/admin-coupon-fix', method: req.method });
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
