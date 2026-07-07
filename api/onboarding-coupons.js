/**
 * POST /api/onboarding-coupons
 *
 * 회원가입 (첫 sign-in) 시 쿠폰 3장 자동 발행:
 *   1) WELCOME-CHARTER-XXXXXX  (charter 5%)
 *   2) WELCOME-TOUR-XXXXXX     (tour-package 5%)
 *   3) WELCOME-AIPLAN-XXXXXX   (ai-plan 무료, 1~3일 일정 — 여름 이벤트)
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
// 마감일 = Vercel 환경변수 ONBOARDING_PROMO_END 로 조정(여름 이벤트 '2026-08-10'). 빈값/미설정=상시 발급.
// env 로 뺀 이유(P1-②): 운영자가 코드 수정 없이 Vercel 에서 이벤트 연장/종료 가능.
const ONBOARDING_PROMO_END = (process.env.ONBOARDING_PROMO_END || '').trim();

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

    // 여름 이벤트(마감 ONBOARDING_PROMO_END): AI 플랜 무료 쿠폰 — 1~3일 일정만(maxDays:3).
    // productScope='ai-plan' + type='free'(value:100). 실제 0원 결제 검증은 paymentGate.js
    // 'ai-coupon' provider 가 담당(소유·미사용·일수·멱등). 차터/투어 5% 쿠폰과 별개로 추가 발급.
    const aiPlanCoupon = couponsRef.doc();
    tx.set(aiPlanCoupon, {
      code: `WELCOME-AIPLAN-${randomSuffix(6)}`,
      type: 'free',
      value: 100,
      label: 'Welcome — Free AI Plan (1~3 days)',
      productScope: 'ai-plan',
      maxDays: 3,
      isUsed: false,
      expiresAt,
      createdAt: now,
      source: 'onboarding',
    });

    tx.set(userRef, {
      onboardingCouponsIssued: true,
      onboardingAt: now,
    }, { merge: true });

    return { issued: 3, alreadyIssued: false };
  });
}

/**
 * $9.90 AI 플래너 구매 완료 시 차터5%+투어5% 쿠폰 발급 (멱등, orderID 기준).
 * 운영자 정책 2026-07-07: "가입 때도, 구매 때도 둘 다" → 가입(issueOnboardingCouponsForUid)과
 * 별개로 구매 1건당 1쌍 발급. 같은 orderID 재캡처(멱등 재시도)는 users/{uid}/purchaseCouponOrders/{orderID}
 * 마커로 중복 발급 차단. 발급 실패는 호출처(capturePaypalOrder)에서 non-fatal 처리(결제는 이미 완료).
 * 소진(redeem) 시 총 할인 10% 상한은 createPaypalOrder total-discount cap 이 강제.
 * @returns {Promise<{issued:number, alreadyIssued?:boolean}>}
 */
export async function issuePurchaseCouponsForOrder(db, uid, orderID) {
  if (!db || !uid || !orderID) return { issued: 0 };
  const userRef = db.collection('users').doc(uid);
  const markerRef = userRef.collection('purchaseCouponOrders').doc(String(orderID));

  return db.runTransaction(async (tx) => {
    const markerSnap = await tx.get(markerRef);
    if (markerSnap.exists) return { issued: 0, alreadyIssued: true };

    const now = Date.now();
    const expiresAt = now + COUPON_VALIDITY_MS;
    const couponsRef = userRef.collection('coupons');

    tx.set(couponsRef.doc(), {
      code: `BUY-CHARTER-${randomSuffix(6)}`,
      type: 'percent',
      value: 5,
      label: 'Charter 5% off (AI plan purchase)',
      productScope: 'charter',
      isUsed: false,
      expiresAt,
      createdAt: now,
      source: 'ai-plan-purchase',
    });
    tx.set(couponsRef.doc(), {
      code: `BUY-TOUR-${randomSuffix(6)}`,
      type: 'percent',
      value: 5,
      label: 'Tour 5% off (AI plan purchase)',
      productScope: 'tour-package',
      isUsed: false,
      expiresAt,
      createdAt: now,
      source: 'ai-plan-purchase',
    });
    tx.set(markerRef, { issuedAt: now, orderID: String(orderID) });

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
