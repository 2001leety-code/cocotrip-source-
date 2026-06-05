/**
 * USD 청구 환율 정책 (2026-06-05 운영자 결정).
 *
 * 차터 전체(transfer/airport/tour/multiday/kpop/custom)는 정책 고정환율
 * (spec.charter_usd_fix_rate=1400)로 KRW→USD 청구 → live 환율 변동 무관 안정 USD.
 * 원화 약세장 헤지를 고객 USD 안정으로 이전 — 손익분기 ~1400, 실 환율 높을수록 운영자 KRW 수령 ↑.
 *
 * AI 플래너(ai_planner_full)만 제외 = live 환율 유지 ($9.90 마케팅가 정책 분리).
 * createPaypalOrder.js 가 호출. 회귀: tests/unit/charter-usd-fix-rate.test.ts.
 */

/**
 * @param {string|undefined} productType
 * @returns {boolean} true = 고정환율(차터 전체) / false = live 환율(ai_planner_full 만)
 */
export function usesFixedUsdRate(productType) {
  return String(productType || '').replace(/-/g, '_') !== 'ai_planner_full';
}
