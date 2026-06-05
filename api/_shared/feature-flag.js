/**
 * FEATURE_* env 플래그 파싱 — 공백 방어 (2026-06-05).
 *
 * 배경 (prod 사고): Vercel env `FEATURE_TRANSFER_CHECKOUT = "\ttrue"` (앞 탭 문자) 였는데
 *   결제 핸들러가 `String(env).toLowerCase() === 'true'` (trim 없음) 로 비교 → `"\ttrue" !== "true"`
 *   → transfer 즉시결제가 백엔드에서 silent OFF (프론트 VITE 플래그는 깨끗 → ON 표시) → 고객 결제 실패.
 *   CLAUDE.md I 의 env 공백 footgun (NCP_CLIENT_ID `.trim()` 필수)과 동일 부류.
 *
 * 정답: env 값은 항상 trim 후 비교. 운영자가 스프레드시트/복붙으로 보이지 않는 공백·탭·개행을
 *   넣어도 의도(true)대로 동작. 결제 게이트는 운영자가 켠 플래그를 정확히 honor 해야 함.
 *
 * @param {string|undefined|null} envValue  process.env.FEATURE_X
 * @returns {boolean} 공백 제거 + 소문자 후 'true' 면 true
 */
export function featureEnabled(envValue) {
  // (envValue || '') = '' for undefined/null/empty — nullish 연산자 회피 (pre-commit hook). env 는 string|undefined.
  return String(envValue || '').trim().toLowerCase() === 'true';
}
