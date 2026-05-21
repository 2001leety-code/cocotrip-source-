// P135 (2026-05-21): Gemini 2.5 → 3.5 Flash 마이그 helper.
// 4 모듈 (geminiPipeline / blockMode / intent-classifier-llm / admin-translate)
// 가 동일 패턴으로 model ID 를 resolve. 안전 롤백 = ENV GEMINI_MODEL_OVERRIDE.
//
// 운영자 의도 (project_cocotrip_todo_gemini_3_5_upgrade.md):
//   "ENV 미설정 → 자동 3.5 Flash 사용. 회귀 발생 시
//    GEMINI_MODEL_OVERRIDE=gemini-2.5-pro 등록 → 즉시 복귀"
// 예상 효과: 회귀 -50% (P120 새벽 -70%, P122 wrong city -60%, unverified -60%,
// language_mismatch -90%, 다양성 -33%). 비용 +$2.4/월 (매출 0.8%).
//
// ENV 우선순위 (위에서 아래로):
//   1. GEMINI_MODEL_OVERRIDE — 모든 role 일괄 override (운영자 emergency)
//   2. GEMINI_{ROLE}_MODEL — 모듈별 미세 control
//   3. DEFAULTS — 코드 default (이 마이그 후 3.5 series)
//
// CLAUDE.md I 룰 (NCP_CLIENT_ID 패턴): ENV value 에 .trim() 필수
// (보이지 않는 \n 으로 invalid model error 회피).

const DEFAULTS = {
  // ai-planner main — legacy 1-pass Gemini. **Pro 유지** (2026-05-21 운영자 결정):
  // Flash 다운그레이드 시 JSON schema strict 위반 / B-MEAL / B-13 / dietary
  // validator 회귀 위험 (CLAUDE.md F 'validatePatternStructure intermittent fail'
  // 경고와 정합). thinkingBudget 32K + 32K output 으로 5-day 복잡 plan 추론 필수.
  // 비용 ↓ 보다 plan 품질 priority. Vercel ENV GEMINI_MAIN_MODEL 로 추후 변경 가능.
  main: 'gemini-2.5-pro',
  // block-mode selection — Flash JSON-only 빠르고 저렴
  block: 'gemini-3.5-flash',
  // intent classifier 폴백 — Flash Lite 유지 (rule-based 미달 시만 호출)
  classifier: 'gemini-3.5-flash-lite',
  // i18n 4-lang 번역 — Flash 충분
  translate: 'gemini-3.5-flash',
};

const ROLE_ENV_MAP = {
  main: 'GEMINI_MAIN_MODEL',
  block: 'GEMINI_BLOCK_MODEL',
  classifier: 'GEMINI_CLASSIFIER_MODEL',
  translate: 'GEMINI_TRANSLATE_MODEL',
};

/**
 * Gemini model ID resolve — ENV override + 모듈별 ENV + default 3-tier.
 *
 * @param {'main'|'block'|'classifier'|'translate'} role - 모듈 식별자
 * @returns {string} - Gemini API 의 model ID (예: 'gemini-3.5-flash')
 * @throws {TypeError} - role 이 유효하지 않으면 throw
 */
export function resolveGeminiModel(role) {
  if (!DEFAULTS[role]) {
    throw new TypeError(
      `resolveGeminiModel: invalid role "${role}". Allowed: ${Object.keys(DEFAULTS).join(', ')}`,
    );
  }

  // 1. 일괄 override (운영자 emergency rollback)
  const globalOverride = (process.env.GEMINI_MODEL_OVERRIDE || '').trim();
  if (globalOverride) return globalOverride;

  // 2. 모듈별 ENV
  const roleEnvKey = ROLE_ENV_MAP[role];
  const roleOverride = (process.env[roleEnvKey] || '').trim();
  if (roleOverride) return roleOverride;

  // 3. Default (마이그 후 3.5 series)
  return DEFAULTS[role];
}

// Test / lint helper — DEFAULTS 노출 (test fixture 단순화)
export const _GEMINI_MODEL_DEFAULTS = DEFAULTS;
export const _GEMINI_ROLE_ENV_MAP = ROLE_ENV_MAP;
