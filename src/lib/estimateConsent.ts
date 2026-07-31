/**
 * 추정가(charter_custom_estimate) 결제 전 동의 — 프론트 미러 (2026-07-30).
 *
 * 🔴 고친 문제: `/charter` 공개 본문 4개 언어가 "결제 후 추가 청구는 하지 않습니다" 라고
 *   단정했다. 그런데 `charter_custom_estimate` 는 실제 거리·시간이 추정과 ±10% 넘게
 *   다르면 추가 청구 또는 부분 환불을 한다(바우처·월렛패스·메일이 그렇게 안내한다).
 *   즉 결제 **전** 화면은 "추가 없음", 결제 **후** 서류는 "정산 있음" 이었다.
 *   `estimatePayDisclaimer`·`estimatePayAgreeLabel` 번역 키는 있었지만 호출처가 0건이었다.
 *
 * 정책 정본 = 서버 `api/_shared/estimate-consent.js`.
 * 두 파일의 상수는 `tests/unit/estimate-consent-parity.test.ts` 가 동기를 강제한다.
 * (정책 자체를 바꾸는 파일이 아니다 — 이미 시행 중인 ±10% 정산을 **결제 전에 고지**한다.)
 */

/** 정산 허용 오차(%). 이 값을 넘는 실제 거리·시간 차이만 정산 대상. */
export const ESTIMATE_RECONCILE_TOLERANCE_PCT = 10;

/**
 * 동의 문구의 버전. 문구·정책이 바뀌면 이 값을 올린다 → 옛 화면(캐시된 번들)이 보낸
 * 동의는 서버에서 거부되고 사용자는 새 문구를 다시 읽는다.
 */
export const ESTIMATE_POLICY_VERSION = '2026-07-30.reconcile-10pct';
