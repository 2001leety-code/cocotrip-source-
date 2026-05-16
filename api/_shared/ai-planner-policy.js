/**
 * AI Planner product policy (single source of truth).
 *
 * 운영자 정책 (2026-05-05): AI 플래너 = 디지털 상품. 모든 쿠폰/프로모는 reject.
 * - applyPromoCode.js 는 productScope='ai_planner' 인 쿠폰이 ai_planner_*
 *   매칭하도록 *허용* 하는 매칭 로직이 있긴 하지만, 결제 흐름 (createPaypalOrder
 *   + capturePaypalOrder) 는 어떤 쿠폰/프로모도 reject. 향후 정책 바뀌면
 *   여기 한 곳만 풀면 된다.
 *
 * PR #433 (Audit Y-H10 — 2026-05-16): 이전엔 createPaypalOrder 에만 gate 가
 * 있고 capturePaypalOrder 는 그대로 통과 → product='ai_planner_full' +
 * couponDocId 조합을 capture-time 에 보내면 booking 이 AI planner 로 기록되되
 * 쿠폰을 함께 소비할 수 있었다. PayPal 결제 자체는 createPaypalOrder 시점의
 * krwAmount 로 굳어지므로 "할인된 가격으로 AI planner 받는" 의 진짜 exploit
 * 은 product 위변조 (예: 차터로 order 생성 후 ai_planner 로 capture) 시나리오.
 * capturePaypalOrder 도 동일 gate 적용하면 어느 흐름이든 AI planner +
 * coupon 조합 자체가 차단됨.
 */

/**
 * @param {string|undefined|null} productType
 * @returns {boolean}
 */
export function isAiPlannerProduct(productType) {
  if (!productType || typeof productType !== 'string') return false;
  // hyphen / underscore variant 둘 다 정상화 — 코드 곳곳에서 'ai-planner-full'
  // 과 'ai_planner_full' 가 섞여 쓰임.
  const normalized = productType.toLowerCase().replace(/-/g, '_');
  return normalized.startsWith('ai_planner');
}

/**
 * Returns the AI-Planner-no-coupon rejection if the (product, coupon-or-promo)
 * tuple violates policy. Caller fires it back to the client as a 400.
 *
 * @param {object} args
 * @param {string} [args.product]
 * @param {string} [args.productType]   alias of `product` for backward compat
 * @param {string} [args.promoCode]
 * @param {string} [args.couponDocId]
 * @returns {{ok: true} | {ok: false, status: 400, code: 'AI_PLANNER_NO_COUPON', error: string, debug: object}}
 */
export function checkAiPlannerCouponPolicy({ product, productType, promoCode, couponDocId } = {}) {
  const effectiveType = product ?? productType ?? null;
  if (!isAiPlannerProduct(effectiveType)) return { ok: true };
  if (!promoCode && !couponDocId) return { ok: true };
  return {
    ok: false,
    status: 400,
    code: 'AI_PLANNER_NO_COUPON',
    error: 'AI Planner does not accept coupons',
    debug: { productType: effectiveType, promoCode: promoCode || null, couponDocId: couponDocId || null },
  };
}

export default checkAiPlannerCouponPolicy;
