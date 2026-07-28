/**
 * AI 플래너 판매가 — 프론트 미러 (2026-07-29 운영자 가격 정책 확정).
 *
 * 백엔드 정본 = api/_shared/pricing.js (AI_PLANNER_FULL_USD)
 *              + api/_shared/usd-rate-policy.js (fixedUsdPriceFor)
 *
 * 🔴 정책: AI 플래너는 **고정 USD $9.90** 으로 판다.
 *   이전에는 ₩13,300 을 live 환율로 나눠 청구해서, 환율 1,468 일 때 실제 청구가 $9.06
 *   이었는데 화면·마케팅은 $9.90 고정이었다 → 표시가 ≠ 청구가.
 *   이제 USD 가 정본이고 KRW 는 **참고 표시용**이다. 결제·환불 판정에 KRW 를 쓰지 않는다.
 *
 * ⚠️ 값 변경 시 백엔드와 동기 필수 — tests/unit/ai-planner-price-parity.test.ts 가 가드.
 *   (charter-extras.js ↔ lib/charterExtras.ts 와 같은 미러 규약)
 */

/** 실제 PayPal 승인·Capture 금액. 화면에 보이는 금액과 같아야 한다. */
export const AI_PLANNER_FULL_USD = 9.90;

/** 마케팅 정가 비교용(표시 전용). 실제 청구 아님. */
export const AI_PLANNER_ORIGINAL_USD = 19.90;

/** 참고 표시용 KRW. 청구 근거 아님 — 환율 변동 시 실제 청구액과 다를 수 있다. */
export const AI_PLANNER_REFERENCE_KRW = 13_300;

/** 화면 표기용 문자열 ("$9.90"). 하드코딩 금지 — 여기서만 만든다. */
export function formatAiPlannerUsd(value: number = AI_PLANNER_FULL_USD): string {
  return `$${value.toFixed(2)}`;
}
