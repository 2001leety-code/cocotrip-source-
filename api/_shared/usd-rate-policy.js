/**
 * USD 청구 환율 정책.
 *
 * KRW 가격 상품은 정책 고정환율(spec.charter_usd_fix_rate=1350)로 KRW→USD 청구.
 * USD 표시·청구 일치를 위해 현재 운영 정책 1,350원/USD를 사용한다.
 *
 * AI 플래너(ai_planner_full)는 USD 정찰가라 KRW→USD 청구 환율 대상이 아니다 —
 * **고정 USD 판매가($9.90)** 가 됐다(환율 계산 자체를 안 탄다). 아래 fixedUsdPriceFor 참조.
 * createPaypalOrder.js 가 호출. 회귀: tests/unit/charter-usd-fix-rate.test.ts.
 */

import { AI_PLANNER_FULL_USD, loadPricingSpec } from './pricing.js';

/**
 * 🔴 2026-07-29 (운영자 가격 정책): USD 정찰가로 파는 상품표.
 *
 * 이전에는 AI 플래너도 KRW 를 live 환율로 나눠 청구해서, 환율 1,468 일 때 실제 청구가
 * $9.06 이었다(화면·마케팅은 $9.90). 이제 USD 가 정본이고 KRW 는 참고 표시용이다.
 * 여기 없는 상품은 기존 환율 로직 그대로 — 다른 상품 가격에 영향 없음.
 */
const FIXED_USD_PRICES = {
  ai_planner_full: AI_PLANNER_FULL_USD,
};

const norm = (productType) => String(productType || '').replace(/-/g, '_');

/** USD 정찰가 상품인가? */
export function isFixedUsdPriceProduct(productType) {
  const key = norm(productType);
  if (Object.prototype.hasOwnProperty.call(FIXED_USD_PRICES, key)) return true;
  const fixedProducts = loadPricingSpec()?.fixed_usd_products || {};
  return Object.prototype.hasOwnProperty.call(fixedProducts, key);
}

/**
 * 상품의 고정 USD 판매가. 정찰가 상품이 아니면 null (호출부가 기존 환율 계산을 탄다).
 * @returns {number|null}
 */
export function fixedUsdPriceFor(productType, passengers = 1) {
  const key = norm(productType);
  const direct = FIXED_USD_PRICES[key];
  if (typeof direct === 'number') return direct;
  const product = loadPricingSpec()?.fixed_usd_products?.[key];
  if (!product || typeof product.unit_price_usd !== 'number' || !Number.isFinite(product.unit_price_usd) || product.unit_price_usd <= 0) return null;
  const pax = Number(passengers);
  if (!Number.isSafeInteger(pax) || pax < 1) return null;
  const amount = product.pricing_unit === 'passenger' ? product.unit_price_usd * pax : product.unit_price_usd;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

/**
 * @param {string|undefined} productType
 * @returns {boolean} true = KRW 가격을 고정환율로 USD화 / false = native USD 가격 (ai_planner_full)
 */
export function usesFixedUsdRate(productType) {
  return String(productType || '').replace(/-/g, '_') !== 'ai_planner_full';
}
