/**
 * 프론트 할인 플래그 SSOT — FEATURE_DISCOUNT_V2 (운영자 2026-06-07).
 *
 * v2 ON: 다일(3일+) 차터 + 왕복 transfer 기본할인 10%→5%. 백엔드 FEATURE_DISCOUNT_V2 와 **쌍**.
 *
 * 🔴 P311 (표시가 == 청구가): 멀티데이/transfer 견적을 화면에 표시하는 **모든** 호출처
 *   (resolveProductType · MultiDayReceipt · TransferReceipt · useQuoteCalculator)는 calc 함수에
 *   `{ discountV2: discountV2Enabled() }` 를 **반드시** 넘겨야 한다. 안 넘기면 표시=10%인데 백엔드 청구=5%
 *   → 손님이 본 가격보다 5.56% 더 청구되는 오과금 버그 (2026-06-10 감사로 발견·수정).
 *
 * ⚠️ 프론트 VITE_FEATURE_DISCOUNT_V2 와 백엔드 FEATURE_DISCOUNT_V2 는 **항상 같은 값**이어야 한다
 *   (둘 다 ON 또는 둘 다 OFF). 한쪽만 켜면 다시 표시≠청구.
 *
 * 함수(상수 아님)인 이유: 모듈 로드 시점 1회 고정이 아니라 호출 시점에 env 를 읽어야 단위 테스트가
 *   vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', …) 로 양쪽(ON/OFF) 경로를 검증할 수 있다.
 */
export function discountV2Enabled(): boolean {
  return import.meta.env.VITE_FEATURE_DISCOUNT_V2 === 'true';
}
