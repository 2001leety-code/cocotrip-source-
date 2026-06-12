/**
 * coupon-charge.js — 결제(청구) 시점 개인 쿠폰 검증 (couponDocId 기준).
 *
 * 운영자 2026-06-07 (FEATURE_DISCOUNT_V2): WELCOME 쿠폰을 실제 청구가에 적용하기 위한
 * 서버측 검증. createPaypalOrder 가 v2 에서 사용한다.
 *   - 기존 버그: 프론트는 쿠폰 할인가를 표시하고 capturePaypalOrder 는 쿠폰을 1회 소진(isUsed)
 *     하지만, createPaypalOrder 는 쿠폰 할인을 청구가에 반영하지 않았음 → 정가 청구 + 쿠폰 burn.
 *   - 본 모듈은 '검증 + 할인%' 만 담당. 소진(isUsed=true 트랜잭션 락)은 capturePaypalOrder 가
 *     이미 수행하므로 여기서 중복 처리하지 않는다 (중복 적용/이중 소진 방지).
 *
 * couponMatchesProduct 는 applyPromoCode.js L70 의 동일 로직 mirror — scope 규칙 SSOT.
 * 변경 시 두 곳 동기. coupon-charge.test.js 가 동작(scope) 가드.
 */

/** 쿠폰 productScope ↔ productType 매칭 (applyPromoCode.couponMatchesProduct mirror). */
export function couponMatchesProduct(productScope, productType) {
  if (!productScope) return true; // legacy 쿠폰 — 모든 productType 허용
  if (!productType) return true;  // productType 미전달 — backward compat

  const pt = String(productType).toLowerCase().replace(/-/g, '_');
  const scope = String(productScope).toLowerCase();

  if (scope === 'both') {
    return pt.startsWith('charter_') || pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') || pt.startsWith('kpop_shuttle_') ||
           pt.startsWith('tour_package');
  }
  if (scope === 'charter') {
    return pt.startsWith('charter_') || pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') || pt.startsWith('kpop_shuttle_');
  }
  if (scope === 'tour_package' || scope === 'tour-package') {
    return pt.startsWith('tour_package');
  }
  if (scope === 'ai_planner') {
    return pt.startsWith('ai_planner');
  }
  return false; // 알 수 없는 scope — 보수적으로 reject
}

/**
 * couponDocId 로 개인 쿠폰 검증 → 유효하면 할인%(coupon.value) 반환.
 * 미사용(isUsed!==true) + 미만료 + scope 매치가 모두 충족돼야 valid.
 * 어떤 실패/에러든 { valid:false } (= 정가 청구, 절대 과할인 금지).
 * 소진(isUsed=true)은 capturePaypalOrder 트랜잭션이 담당.
 *
 * @param {object} db  initAdminDb 결과
 * @param {string} couponUserId  쿠폰 소유 uid
 * @param {string} couponDocId   쿠폰 문서 id
 * @param {string} productType   결제 상품 (scope 가드)
 * @returns {Promise<{valid:boolean, discountPct?:number}>}
 */
export async function verifyCouponForCharge(db, couponUserId, couponDocId, productType) {
  if (!db || !couponUserId || !couponDocId) return { valid: false };
  try {
    const snap = await db.collection('users').doc(couponUserId)
      .collection('coupons').doc(couponDocId).get();
    if (!snap.exists) return { valid: false };
    const c = snap.data() || {};
    if (c.isUsed === true) return { valid: false };
    if (typeof c.expiresAt === 'number' && c.expiresAt < Date.now()) return { valid: false };
    if (!couponMatchesProduct(c.productScope, productType)) return { valid: false };
    // 정액(fixed) 쿠폰은 청구 경로에서 미적용 → 정가(안전). 이 함수는 c.value 를 퍼센트로
    // 읽으므로 fixed($X off)면 X% 로 오해석된다(예: $8 off → 8% off, 표시≠청구). v1 은
    // 정가 청구로 수렴(과/오할인 방지). 표시단(applyPromoCode)도 fixed 쿠폰을 이 경로로
    // 넘기지 않도록 호출처에서 방어 권장.
    if (c.type && c.type !== 'percent') return { valid: false };
    const pct = typeof c.value === 'number' ? c.value : 0;
    if (!(pct > 0)) return { valid: false };
    // 안전 상한 10% — 개인 쿠폰 단일 적용 (운영자 정책: 쿠폰 5%). 변조/이상치 방어.
    return { valid: true, discountPct: Math.min(pct, 10) };
  } catch (err) {
    return { valid: false }; // 검증 중 에러 = 미적용(정가). 과할인보다 미적용이 안전.
  }
}
