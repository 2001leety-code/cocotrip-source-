// 2026-11-23: 새 플랜의 무료 재생성 횟수. 재생성 결과 플랜은 0 — 남은 횟수는 원본 플랜에만 있다
//   (paymentGate 가 원본 횟수를 이미 1 줄였다). 플랜을 처음 쓰는 곳(뼈대·Inngest 뼈대·완성 문서)은
//   이 함수만 쓴다. 숫자를 직접 쓰면 tests/unit/revision-credits-no-refill.test.tsx 가 실패한다.
const PAID_PLAN_REVISION_CREDITS = 2; // not exported — write sites must call initialRevisionCredits

export function initialRevisionCredits(body) {
  return body?.revisionOf ? 0 : PAID_PLAN_REVISION_CREDITS;
}
