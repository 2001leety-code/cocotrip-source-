// 프론트 기능 플래그 판정 — 백엔드 featureEnabled(api/_shared/feature-flag.js:15)와 유사(trim).
//
// 🔴 trim 필수: Vercel env 값에 보이지 않는 앞뒤 공백/탭이 섞여도 안 깨지게.
//    2026-06-11 사고 — 운영자가 VITE_FEATURE_CART 를 켰는데(UI엔 "true") 실제 값은 " true"(앞 공백),
//    VITE_FEATURE_REVIEW_EDIT 는 "\ttrue"(앞 탭) → 바닐라 `=== 'true'` 가 false → 장바구니/검수 안 보임.
//    백엔드는 featureEnabled 가 이미 trim 해서 무사했고 프론트만 당함. 신규 프론트 플래그는 전부 이 헬퍼로.
//
// ⚠️ value 는 엄격 'true'(case-sensitive) — isCartEnabled 의 "정확히 true 만 활성"(실수 활성 방지) 의도 보존.
//    백엔드는 lowercase 까지 하지만 프론트는 trim 만(기존 cart-types 테스트와 일치). 운영자 관례 값은 소문자 'true'.
// (v || '') 로 빈/누락 폴백 — nullish 연산자 대신 || 사용 (pre-commit mojibake 훅이 nullish 기호를 깨진한글로 오탐).
export function isFeatureFlagOn(envValue: string | undefined): boolean {
  return String(envValue || '').trim() === 'true';
}
