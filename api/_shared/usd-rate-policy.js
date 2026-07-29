/**
 * USD 청구 환율 정책 (2026-06-05 운영자 결정).
 *
 * 차터 전체(transfer/airport/tour/multiday/kpop/custom)는 정책 고정환율
 * (spec.charter_usd_fix_rate=1400)로 KRW→USD 청구 → live 환율 변동 무관 안정 USD.
 * 원화 약세장 헤지를 고객 USD 안정으로 이전 — 손익분기 ~1400, 실 환율 높을수록 운영자 KRW 수령 ↑.
 *
 * AI 플래너(ai_planner_full)는 이 환율 정책 대상이 아니다 — 2026-07-29 운영자 결정으로
 * **고정 USD 판매가($9.90)** 가 됐다(환율 계산 자체를 안 탄다). 아래 fixedUsdPriceFor 참조.
 * createPaypalOrder.js 가 호출. 회귀: tests/unit/charter-usd-fix-rate.test.ts.
 */

import { AI_PLANNER_FULL_USD } from './pricing.js';

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
  return Object.prototype.hasOwnProperty.call(FIXED_USD_PRICES, norm(productType));
}

/**
 * 상품의 고정 USD 판매가. 정찰가 상품이 아니면 null (호출부가 기존 환율 계산을 탄다).
 * @returns {number|null}
 */
export function fixedUsdPriceFor(productType) {
  const v = FIXED_USD_PRICES[norm(productType)];
  return typeof v === 'number' ? v : null;
}

/**
 * @param {string|undefined} productType
 * @returns {boolean} true = 고정환율(차터 전체) / false = live 환율(ai_planner_full 만)
 */
export function usesFixedUsdRate(productType) {
  return String(productType || '').replace(/-/g, '_') !== 'ai_planner_full';
}
