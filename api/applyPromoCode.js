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
// PR #434 (Audit Y-H11 — 2026-05-16): 정의 + cap 해석을 api/_shared/global-promo.js
// 로 추출. capturePaypalOrder 의 transactional cap check 와 같은 source of truth.
// limit 기본값은 환경변수 / Firestore admin doc 으로 override 가능 (resolveGlobalPromoLimit).
// 실 사용량 카운트는 Firestore global_promo_usage/{code} 에서 추적
// (capturePaypalOrder 의 incrementGlobalPromoUsage 가 transaction 으로 cap-check 후 +1).
import { GLOBAL_PROMO_DEFAULTS, resolveGlobalPromoLimit } from './_shared/global-promo.js';
const GLOBAL_PROMOS = GLOBAL_PROMO_DEFAULTS;

// global_promo_usage/{code}.usedCount < maxUses 검증 (read-only). 실제 increment 는
// capturePaypalOrder 의 트랜잭션 내에서 수행 — 여기는 사용자 UX gate.
async function checkGlobalPromoLimit(db, code) {
  const upper = code.toUpperCase();
  const maxUses = await resolveGlobalPromoLimit({ db, code: upper });
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

// productType (예: charter_seoul_city, charter_busan, charter_custom_estimate,
// tour-package_X, ai_planner_full, ai-planner-quick, airport_seoul_central,
// kpop_shuttle_oneway, combo_airport_seoul) → coupon.productScope (예: 'charter',
// 'tour-package', 'ai_planner', 'both') 매칭.
//
// 정책 (2026-05-05):
//  - productScope 미지정 (legacy 쿠폰) → 모든 productType 허용 (backward compat)
//  - productScope='both' → charter + tour-package 허용 (AI 플래너 reject)
//  - productScope='charter' → charter_*, combo_airport_*, kpop_shuttle_*, airport_*
//    중 charter / 차터 호환 productType 만 허용
//  - productScope='tour-package' → tour-package_* 만 허용
//  - productScope='ai_planner' → ai_planner_*, ai-planner-* 만 허용
//
// AI 플래너는 디지털 상품 — 운영자 정책상 모든 사용자 쿠폰 reject (productScope
// 미설정 legacy 쿠폰도). 이는 별도 isAiPlanner 가드로 호출처에서 처리.
function couponMatchesProduct(productScope, productType) {
  if (!productScope) return true; // legacy 쿠폰 — 모든 productType 허용
  if (!productType) return true; // productType 미전달 — backward compat (소비처가 전달하지 않으면 적용)

  const pt = String(productType).toLowerCase().replace(/-/g, '_');
  const scope = String(productScope).toLowerCase();

  if (scope === 'both') {
    return pt.startsWith('charter_') ||
           pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') ||
           pt.startsWith('kpop_shuttle_') ||
           pt.startsWith('tour_package');
  }
  if (scope === 'charter') {
    return pt.startsWith('charter_') ||
           pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') ||
           pt.startsWith('kpop_shuttle_');
  }
  if (scope === 'tour_package' || scope === 'tour-package') {
    return pt.startsWith('tour_package');
  }
  if (scope === 'ai_planner') {
    return pt.startsWith('ai_planner');
  }
  // 알 수 없는 scope 값 — 보수적으로 reject
  return false;
}

// ── Firestore 쿠폰 검증 (WELCOME5 등 개인 쿠폰) ──
// 반환값:
//   null            — 쿠폰 없음 / 만료됨
//   { ...coupon }   — 정상 쿠폰
//   { error, code } — 매치 실패 (productScope mismatch)
async function verifyFirestoreCoupon(userId, code, productType) {
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

    // productScope 가드 (2026-05-07): charter ↔ tour 쿠폰 혼용 차단.
    // productScope 미지정 (legacy) 쿠폰은 backward compat 으로 모든 productType 허용.
    if (!couponMatchesProduct(coupon.productScope, productType)) {
      return {
        error: 'COUPON_PRODUCT_SCOPE_MISMATCH',
        productScope: coupon.productScope,
        productType: productType || null,
        label: coupon.label,
      };
    }

    // raw 값 반환 — 할인 계산은 handler에서 (환율 필요)
    return {
      couponDocId: couponDoc.id,
      userId,
      label: coupon.label,
      type: coupon.type,
      value: coupon.value,
      currency: coupon.currency || 'USD',
      productScope: coupon.productScope || null,
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

    const { code, originalPrice, userId, codes, productType } = body;

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

        // Firestore 개인 쿠폰 확인 (productScope 가드 포함)
        const fsCoupon = await verifyFirestoreCoupon(userId, upper, productType);
        // productScope mismatch — 합산 path 에선 silent skip (다른 코드 적용은 계속)
        // + UX 가시성 위해 응답에 reject 항목 포함.
        if (fsCoupon && fsCoupon.error === 'COUPON_PRODUCT_SCOPE_MISMATCH') {
          console.warn('[applyPromoCode] coupon scope mismatch (multi):', upper, fsCoupon.productScope, '≠', productType);
          appliedCodes.push({
            code: upper,
            discount: 0,
            label: fsCoupon.label,
            rejected: true,
            rejectCode: 'COUPON_PRODUCT_SCOPE_MISMATCH',
          });
          continue;
        }
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

    // 2. Firestore 개인 쿠폰 확인 (productScope 가드 포함)
    const fsCoupon = await verifyFirestoreCoupon(userId, upper, productType);
    // productScope mismatch — 단일 코드 path 에선 명시적 400 반환 (사용자 UX:
    // "이 쿠폰은 ___ 상품에만 사용 가능합니다" 메시지로 변환 가능).
    if (fsCoupon && fsCoupon.error === 'COUPON_PRODUCT_SCOPE_MISMATCH') {
      console.warn('[applyPromoCode] coupon scope mismatch:', upper, fsCoupon.productScope, '≠', productType);
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(
        `Coupon "${fsCoupon.label || upper}" is restricted to ${fsCoupon.productScope} products and cannot be applied to ${productType || 'this product'}.`,
        'COUPON_PRODUCT_SCOPE_MISMATCH',
      )));
    }
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