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

// ── 표시 헬퍼 (2026-07-29) ───────────────────────────────────────────────────
// 🔴 가격 문자열을 화면마다 따로 적지 않는다. 가격이 바뀌면 이 파일 한 곳만 고치면 되도록,
//    번역 JSON 은 `{price}` / `{krw}` placeholder 만 두고 값은 여기서 주입한다.

/** 번역 문자열의 {price}·{origPrice}·{krw} 를 실제 값으로 치환한다. */
export function fillPrice(template: string | undefined, language = 'en'): string {
  if (!template) return '';
  return template
    .replace(/\{price\}/g, formatAiPlannerUsd())
    .replace(/\{origPrice\}/g, formatAiPlannerUsd(AI_PLANNER_ORIGINAL_USD))
    .replace(/\{krw\}/g, formatAiPlannerApproxKrw(language));
}

/** "약" 접두 (언어별). 참고 금액임을 문구로 못 박는다. */
const APPROX_PREFIX: Record<string, string> = {
  ko: '약 ', ja: '約 ', zh: '约 ', en: '≈ ',
};

/**
 * 참고 원화 표기. **청구 금액이 아니다** — 실제 결제는 고정 USD 이고, 손님 카드사가
 * 자체 환율로 원화를 인출하므로 이 값과 다를 수 있다. 그래서 항상 "약"을 붙인다.
 *
 * 참고 환율은 서버 정책값(기본 1,343 = $9.90 기준 ₩13,300)을 쓰되, 호출부가 실환율을
 * 넘기면 그 값으로 계산한다(홈·마이페이지가 이미 환율을 들고 있으면 전달).
 */
export function formatAiPlannerApproxKrw(language = 'en', usdToKrw?: number): string {
  const rate = Number.isFinite(usdToKrw) && (usdToKrw as number) > 0
    ? (usdToKrw as number)
    : AI_PLANNER_REFERENCE_KRW / AI_PLANNER_FULL_USD;
  const krw = Math.round((AI_PLANNER_FULL_USD * rate) / 100) * 100; // 100원 단위 반올림
  const prefix = APPROX_PREFIX[language] || APPROX_PREFIX.en;
  return `${prefix}₩${krw.toLocaleString('ko-KR')}`;
}
