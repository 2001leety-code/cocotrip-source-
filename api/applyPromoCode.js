/**
 * Vercel API: Apply Promo Code (5+5% 시스템)
 * POST /api/applyPromoCode
 *
 * 프로모션 구조:
 * - 기본 프로모션: COCO5 → 5% 할인 (누구나)
 * - 가입 보너스: WELCOME5 → 5% 추가 (신규 가입자 전용, Firestore 쿠폰)
 * - Early Bird: EARLY50 → 20% 할인
 * - 합산 가능: COCO5 + WELCOME5 = 총 10% 할인
 */

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── 글로벌 (하드코딩) 프로모 코드 ──
const GLOBAL_PROMOS = {
  'EARLY50': { discount: 0.20, label: 'Early Bird 20% OFF', limit: 50, stackable: false },
  'COCO5':   { discount: 0.05, label: 'Base 5% OFF', limit: 99999, stackable: true },
  'COCO10':  { discount: 0.10, label: '10% OFF', limit: 99999, stackable: false },
};

// ── Firestore 쿠폰 검증 (WELCOME5 등 개인 쿠폰) ──
async function verifyFirestoreCoupon(userId, code) {
  if (!userId) return null;

  try {
    // Dynamic import — Vercel serverless에서 Firebase Admin 대신 REST API 사용
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');

    if (!getApps().length) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8')
      );
      initializeApp({ credential: cert(serviceAccount) });
    }
    const db = getFirestore();

    // 유저의 쿠폰 중 code가 일치하고 미사용인 것 검색
    const snap = await db.collection('users').doc(userId)
      .collection('coupons')
      .where('code', '==', code.toUpperCase())
      .where('isUsed', '==', false)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const couponDoc = snap.docs[0];
    const coupon = couponDoc.data();

    // 만료 확인
    if (coupon.expiresAt && coupon.expiresAt < Date.now()) return null;

    // percent: value=5 → 0.05 / fixed: value=5 → $5 할인
    const discount = coupon.type === 'fixed'
      ? coupon.value / (originalPrice || 1)   // 고정금액을 비율로 변환
      : coupon.value / 100;

    return {
      couponDocId: couponDoc.id,
      userId,
      discount,
      label: coupon.label,
      type: coupon.type,
      value: coupon.value,
      stackable: true,
    };
  } catch (err) {
    console.warn('[applyPromoCode] Firestore coupon check failed:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { code, originalPrice, userId, codes } = body;

    // ── 복수 코드 적용 (5+5% 합산) ──
    if (codes && Array.isArray(codes)) {
      let totalDiscount = 0;
      const appliedCodes = [];
      const seenCodes = new Set(); // 중복 코드 방지

      for (const c of codes) {
        const upper = c.toUpperCase();
        if (seenCodes.has(upper)) continue; // 같은 코드 중복 적용 방지
        seenCodes.add(upper);

        // 글로벌 프로모 확인
        const globalPromo = GLOBAL_PROMOS[upper];
        if (globalPromo && globalPromo.stackable) {
          totalDiscount += globalPromo.discount;
          appliedCodes.push({ code: upper, discount: globalPromo.discount, label: globalPromo.label });
          continue;
        }

        // Firestore 개인 쿠폰 확인
        const fsCoupon = await verifyFirestoreCoupon(userId, upper);
        if (fsCoupon && fsCoupon.stackable) {
          totalDiscount += fsCoupon.discount;
          appliedCodes.push({ code: upper, discount: fsCoupon.discount, label: fsCoupon.label });
        }
      }

      // 최대 할인 cap: 30%
      totalDiscount = Math.min(totalDiscount, 0.30);

      const savedAmount = Math.round(originalPrice * totalDiscount * 100) / 100;
      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        valid: true,
        stacked: true,
        appliedCodes,
        totalDiscount,
        originalPrice,
        savedAmount,
        discountedPrice,
      }));
    }

    // ── 단일 코드 적용 (기존 호환) ──
    if (!code || !originalPrice) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing code or originalPrice' }));
    }

    const upper = code.toUpperCase();

    // 1. 글로벌 프로모 확인
    const promo = GLOBAL_PROMOS[upper];
    if (promo) {
      const savedAmount = Math.round(originalPrice * promo.discount * 100) / 100;
      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;
      console.log('[applyPromoCode] Global:', { code: upper, originalPrice, discountedPrice });

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        valid: true,
        code: upper,
        label: promo.label,
        discountRate: promo.discount,
        originalPrice,
        savedAmount,
        discountedPrice,
        stackable: promo.stackable,
      }));
    }

    // 2. Firestore 개인 쿠폰 확인
    const fsCoupon = await verifyFirestoreCoupon(userId, upper);
    if (fsCoupon) {
      const savedAmount = Math.round(originalPrice * fsCoupon.discount * 100) / 100;
      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;
      console.log('[applyPromoCode] Firestore coupon:', { code: upper, originalPrice, discountedPrice });

      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        valid: true,
        code: upper,
        label: fsCoupon.label,
        discountRate: fsCoupon.discount,
        originalPrice,
        savedAmount,
        discountedPrice,
        stackable: fsCoupon.stackable,
      }));
    }

    // 3. 미등록 코드
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: 'invalid_code', message: 'Invalid promo code.' }));

  } catch (err) {
    console.error('[applyPromoCode] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}