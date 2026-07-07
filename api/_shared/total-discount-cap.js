/**
 * total-discount-cap.js — 총 할인 상한(운영자 정책 "딜+쿠폰 합산 최대 10%").
 *
 * 배경 2026-07-07: FEATURE_DISCOUNT_V2 ON 시 다일/왕복 딜(5%)과 개인 쿠폰(5%)이 청구가에
 * 곱셈으로 누적된다(0.95×0.95=9.75%). 실 쿠폰은 5% 라 자연히 10% 이하지만, 어드민이 5% 초과
 * 개인 쿠폰(예: 10%)을 발급하면 딜과 겹쳐 10% 를 넘을 수 있다(5%+10% ≈ 14.5%).
 * 이 헬퍼가 정가(할인 전) 대비 총 할인을 capPct% 로 floor 해 "최대 10%" 불변식을 강제한다.
 *
 * createPaypalOrder 가 쿠폰 적용 직후 호출. 정가(listBaseKrw)는 딜 있는 경로(다일/왕복)만
 * 별도 산출하고, 딜 없는 경로는 청구가가 곧 정가다. 정가 산출 실패(null/0/NaN) 시 원금 유지(안전).
 */

/** 총 할인 상한 % (운영자 정책). */
export const TOTAL_DISCOUNT_CAP_PCT = 10;

/**
 * 딜+쿠폰 합산 할인이 정가의 capPct% 를 넘으면 정가×(1-capPct/100) 로 floor.
 * @param {number} krwAmount   딜+쿠폰 모두 적용된 청구가
 * @param {number} listBaseKrw 할인 전 정가
 * @param {number} [capPct=TOTAL_DISCOUNT_CAP_PCT] 최대 총 할인 %
 * @returns {number} floor 적용된 청구가 (정가 무효 시 krwAmount 원본)
 */
export function applyTotalDiscountCap(krwAmount, listBaseKrw, capPct = TOTAL_DISCOUNT_CAP_PCT) {
  if (!Number.isFinite(krwAmount)) return krwAmount;
  if (!Number.isFinite(listBaseKrw) || listBaseKrw <= 0) return krwAmount;
  const floorKrw = Math.round(listBaseKrw * (1 - capPct / 100));
  return krwAmount < floorKrw ? floorKrw : krwAmount;
}
