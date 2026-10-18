// 의도적으로 잘못된 모듈 (통합 2026-10-17) — 실제 Node ESM 로더가 "Duplicate export" 로 거부해야 한다.
// esm-load-dup.mjs 만 import 한다. 고치지 말 것 (smoke 러너의 음성 대조군).
export const A = 1;
export { A };
