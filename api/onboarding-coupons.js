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

// 운영자 2026-06-07: 90일 → 1년. 외국인은 몇 달 전부터 여행 계획 → 90일은 짧음(만료 위험).
export const COUPON_VALIDITY_MS = 365 * 24 * 3600 * 1000; // 1년

// 🚨 운영자: 오픈기념 가입 쿠폰 발급 마감일(KST). 3주 가입창 = 이 날짜까지 가입자만 WELCOME 쿠폰 발급.
//    '' = 제한 없음(상시 발급). 배너 PROMO_END_DATE 와 맞추세요. 마감 후 신규 가입자는 쿠폰 미발급.
const ONBOARDING_PROMO_END = ''; // 2026-06-19 상시 발급(빈값, 운영자 "자율진행") — 광고 재개 시 가입→웰컴쿠폰 funnel 유지. 종료하려면 'YYYY-MM-DD'.

/** 가입 쿠폰 발급 창이 열려있는지 (마감일 미설정/파싱실패 → 안전하게 발급). */
export function isOnboardingPromoOpen(now = Date.now()) {
  if (!ONBOARDING_PROMO_END) return true;
  const end = new Date(`${ONBOARDING_PROMO_END}T23:59:59+09:00`).getTime();
  if (!Number.isFinite(end)) return true;
  return now <= end;
}

function randomSuffix(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 (I, O, 0, 1) 제외
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * 회원가입 쿠폰 2장 발급 (멱등). admin-coupon-fix.js 가 재사용.
 * @returns {Promise<{issued:number, alreadyIssued:boolean}>}
 */
export async function issueOnboardingCouponsForUid(db, uid) {
  if (!db || !uid) throw new Error('db and uid required');
  // 3주 오픈 프로모 창 게이트 — 마감 후 가입자는 WELCOME 쿠폰 미발급 (운영자 2026-06-07).
  if (!isOnboardingPromoOpen()) {
    return { issued: 0, promoClosed: true };
  }
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (tx) => {
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

    const result = await issueOnboardingCouponsForUid(db, uid);
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
