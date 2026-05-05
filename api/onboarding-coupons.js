/**
 * POST /api/onboarding-coupons
 *
 * 회원가입 (첫 sign-in) 시 5% 쿠폰 2장 자동 발행:
 *   1) WELCOME-CHARTER-XXXXXX  (productScope='charter')
 *   2) WELCOME-TOUR-XXXXXX     (productScope='tour-package')
 *
 * 멱등성:
 *   - users/{uid}.onboardingCouponsIssued === true 면 즉시 200 reply (재발급 X)
 *   - 트랜잭션 내에서 flag 검사 + 쿠폰 추가 → 동시 호출도 정확히 1회만 발행됨
 *
 * 보안:
 *   - verifyUserToken (Bearer ID-token) — body 신뢰 X
 *   - 쿠폰 doc은 users/{uid}/coupons (rules: client write false → server only)
 *
 * 클라이언트 호출 (src/lib/firebase.js):
 *   const idToken = await user.getIdToken();
 *   await fetch('/api/onboarding-coupons', {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${idToken}` },
 *   });
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const COUPON_VALIDITY_MS = 90 * 24 * 3600 * 1000; // 90일

function randomSuffix(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 (I, O, 0, 1) 제외
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  try {
    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: auth.error }));
    }
    const { uid } = auth;

    const db = initAdminDb('onboarding-coupons');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const userRef = db.collection('users').doc(uid);

    // 트랜잭션: flag 체크 + 쿠폰 2장 add + flag set 원자적 처리
    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const data = userSnap.exists ? userSnap.data() : {};

      if (data.onboardingCouponsIssued === true) {
        return { issued: 0, alreadyIssued: true };
      }

      const now = Date.now();
      const expiresAt = now + COUPON_VALIDITY_MS;

      const couponsRef = userRef.collection('coupons');
      const charterCoupon = couponsRef.doc();
      const tourCoupon = couponsRef.doc();

      tx.set(charterCoupon, {
        code: `WELCOME-CHARTER-${randomSuffix(6)}`,
        type: 'percent',
        value: 5,
        label: 'Welcome 5% off Charter',
        productScope: 'charter',
        isUsed: false,
        expiresAt,
        createdAt: now,
        source: 'onboarding',
      });

      tx.set(tourCoupon, {
        code: `WELCOME-TOUR-${randomSuffix(6)}`,
        type: 'percent',
        value: 5,
        label: 'Welcome 5% off Tour',
        productScope: 'tour-package',
        isUsed: false,
        expiresAt,
        createdAt: now,
        source: 'onboarding',
      });

      tx.set(userRef, {
        onboardingCouponsIssued: true,
        onboardingAt: now,
      }, { merge: true });

      return { issued: 2, alreadyIssued: false };
    });

    console.log('[onboarding-coupons] uid=', uid, 'result=', result);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error('[onboarding-coupons] failed:', err.message);
    await captureError(err, { route: '/api/onboarding-coupons' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
