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

import { getUsdToKrw } from './_exchange-rate.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// ── 글로벌 (하드코딩) 프로모 코드 ──
// limit 기본값은 환경변수 / Firestore admin doc 으로 override 가능 (getGlobalPromoLimit 참조).
// 실 사용량 카운트는 Firestore global_promo_usage/{code} 에서 추적 (capturePaypalOrder 가 increment).
const GLOBAL_PROMOS = {
  'EARLY50': { discount: 0.20, label: 'Early Bird 20% OFF', limit: 50, stackable: false },
  'COCO5':   { discount: 0.05, label: 'Base 5% OFF', limit: 9999, stackable: true },
  'COCO10':  { discount: 0.10, label: '10% OFF', limit: 9999, stackable: false },
};

// 글로벌 프로모 maxUses override — Firestore admin/global_promo_limits doc 또는 env var.
// env: GLOBAL_PROMO_LIMIT_COCO5=20000 → COCO5 limit 20000 으로 override.
async function getGlobalPromoLimit(db, code) {
  const upper = code.toUpperCase();
  const envKey = `GLOBAL_PROMO_LIMIT_${upper}`;
  const envVal = process.env[envKey];
  if (envVal && Number.isFinite(Number(envVal))) return Number(envVal);

  if (db) {
    try {
      const doc = await db.collection('admin').doc('global_promo_limits').get();
      if (doc.exists) {
        const v = doc.data()?.[upper];
        if (Number.isFinite(Number(v))) return Number(v);
      }
    } catch (err) {
      console.warn('[applyPromoCode] admin/global_promo_limits read failed:', err.message);
    }
  }

  return GLOBAL_PROMOS[upper]?.limit ?? 9999;
}

// global_promo_usage/{code}.usedCount < maxUses 검증 (read-only). 실제 increment 는
// capturePaypalOrder 의 트랜잭션 내에서 수행 — 여기는 사용자 UX gate.
async function checkGlobalPromoLimit(db, code) {
  const upper = code.toUpperCase();
  const maxUses = await getGlobalPromoLimit(db, upper);
  if (!db) return { ok: true, usedCount: 0, maxUses };
  try {
    const doc = await db.collection('global_promo_usage').doc(upper).get();
    const usedCount = doc.exists ? Number(doc.data()?.usedCount || 0) : 0;
    return { ok: usedCount < maxUses, usedCount, maxUses };
  } catch (err) {
    console.warn('[applyPromoCode] global_promo_usage read failed:', err.message);
    return { ok: true, usedCount: 0, maxUses }; // soft fail — read 에러 시 통과
  }
}

// ── Firestore 쿠폰 검증 (WELCOME5 등 개인 쿠폰) ──
async function verifyFirestoreCoupon(userId, code) {
  if (!userId) return null;

  try {
    const db = initAdminDb('applyPromoCode');
    if (!db) return null;

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

    // raw 값 반환 — 할인 계산은 handler에서 (환율 필요)
    return {
      couponDocId: couponDoc.id,
      userId,
      label: coupon.label,
      type: coupon.type,
      value: coupon.value,
      currency: coupon.currency || 'USD',
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
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { code, originalPrice, userId, codes } = body;

    // 실시간 환율 조회 (공통 유틸 — cap 1350 적용)
    const usdToKrw = await getUsdToKrw();

    // Firestore admin db (글로벌 프로모 사용량 검증용 — 실패해도 soft fail)
    const db = initAdminDb('applyPromoCode');

    // ── 복수 코드 적용 (5+5% 합산) ──
    if (codes && Array.isArray(codes)) {
      let totalDiscount = 0;
      const appliedCodes = [];
      const seenCodes = new Set(); // 중복 코드 방지

      for (const c of codes) {
        const upper = c.toUpperCase();
        if (seenCodes.has(upper)) continue; // 같은 코드 중복 적용 방지
        seenCodes.add(upper);

        // 글로벌 프로모 확인 (limit 도달 시 skip)
        const globalPromo = GLOBAL_PROMOS[upper];
        if (globalPromo && globalPromo.stackable) {
          const limitGate = await checkGlobalPromoLimit(db, upper);
          if (!limitGate.ok) {
            console.warn('[applyPromoCode] global promo limit reached:', upper, limitGate);
            continue; // limit 초과 — 적용하지 않음
          }
          totalDiscount += globalPromo.discount;
          appliedCodes.push({ code: upper, discount: globalPromo.discount, label: globalPromo.label });
          continue;
        }

        // Firestore 개인 쿠폰 확인
        const fsCoupon = await verifyFirestoreCoupon(userId, upper);
        if (fsCoupon && fsCoupon.stackable) {
          let disc;
          if (fsCoupon.type === 'fixed' && fsCoupon.currency === 'USD') {
            const discountKRW = fsCoupon.value * usdToKrw;
            disc = Math.min(discountKRW, originalPrice) / originalPrice;
          } else {
            disc = fsCoupon.value / 100;
          }
          totalDiscount += disc;
          appliedCodes.push({ code: upper, discount: disc, label: fsCoupon.label, couponDocId: fsCoupon.couponDocId });
        }
      }

      // 최대 할인 cap: 30%
      totalDiscount = Math.min(totalDiscount, 0.30);

      const savedAmount = Math.round(originalPrice * totalDiscount * 100) / 100;
      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({
        valid: true,
        stacked: true,
        appliedCodes,
        totalDiscount,
        originalPrice,
        savedAmount,
        discountedPrice,
      })));
    }

    // ── 단일 코드 적용 (기존 호환) ──
    if (!code || !originalPrice) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Missing code or originalPrice', 'MISSING_FIELDS')));
    }

    const upper = code.toUpperCase();

    // 1. 글로벌 프로모 확인 (limit 도달 시 reject)
    const promo = GLOBAL_PROMOS[upper];
    if (promo) {
      const limitGate = await checkGlobalPromoLimit(db, upper);
      if (!limitGate.ok) {
        console.warn('[applyPromoCode] global promo limit reached:', upper, limitGate);
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err(`Promo code limit reached (${limitGate.usedCount}/${limitGate.maxUses})`, 'PROMO_LIMIT_REACHED')));
      }

      const savedAmount = Math.round(originalPrice * promo.discount * 100) / 100;
      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;
      console.log('[applyPromoCode] Global:', { code: upper, originalPrice, discountedPrice, usedCount: limitGate.usedCount, maxUses: limitGate.maxUses });

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({
        valid: true,
        code: upper,
        label: promo.label,
        discountRate: promo.discount,
        originalPrice,
        savedAmount,
        discountedPrice,
        stackable: promo.stackable,
      })));
    }

    // 2. Firestore 개인 쿠폰 확인
    const fsCoupon = await verifyFirestoreCoupon(userId, upper);
    if (fsCoupon) {
      let savedAmount;
      let discountRate;

      if (fsCoupon.type === 'fixed' && fsCoupon.currency === 'USD') {
        // USD 고정 금액 쿠폰 → KRW 환산 (실시간 환율)
        const discountKRW = fsCoupon.value * usdToKrw;
        savedAmount = Math.min(discountKRW, originalPrice); // 주문액 초과 방지
        discountRate = savedAmount / originalPrice;
      } else {
        // percent 쿠폰
        discountRate = fsCoupon.value / 100;
        savedAmount = Math.round(originalPrice * discountRate * 100) / 100;
      }

      const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;
      console.log('[applyPromoCode] Firestore coupon:', { code: upper, originalPrice, discountedPrice, usdToKrw });

      res.writeHead(200, JSON_CORS);
      return res.end(JSON.stringify(_ok({
        valid: true,
        code: upper,
        label: fsCoupon.label,
        discountRate,
        originalPrice,
        savedAmount,
        discountedPrice,
        stackable: fsCoupon.stackable,
        couponDocId: fsCoupon.couponDocId,
        userId: fsCoupon.userId,
        exchangeRate: Math.round(usdToKrw),
      })));
    }

    // 3. 미등록 코드
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify(_err('Invalid promo code', 'INVALID_CODE')));

  } catch (err) {
    console.error('[applyPromoCode] Error:', err);
    await captureError(err, { route: '/api/applyPromoCode', method: req.method });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}