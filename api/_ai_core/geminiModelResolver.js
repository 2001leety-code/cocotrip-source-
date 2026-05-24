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
//   2. GEMINI_ADMIN_BYPASS_MODEL — P171: admin Test Mode 전용 (isAdminBypass=true)
//   3. PLANNER_FLASH_PCT bucketing — P172: 일반 사용자 일부 Flash A/B (0 default = 영향 0)
//   4. GEMINI_{ROLE}_MODEL — 모듈별 미세 control
//   5. DEFAULTS — 코드 default (이 마이그 후 3.5 series)
//
// CLAUDE.md I 룰 (NCP_CLIENT_ID 패턴): ENV value 에 .trim() 필수
// (보이지 않는 \n 으로 invalid model error 회피).
//
// P172 신규 ENV:
//   PLANNER_FLASH_PCT: 0-100 integer. default 0 (영향 0).
//   GEMINI_FLASH_BUCKET_MODEL: Flash bucket 에 적용할 모델. default 'gemini-3.5-flash'.
import { parsePct, bucketFor } from './plannerMode.js';

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
 * Gemini model ID resolve — ENV override + admin bypass + PCT bucketing + 모듈별 ENV + default.
 *
 * 결정 우선순위 (위에서 아래로):
 *   1. GEMINI_MODEL_OVERRIDE (전역 emergency) — 모든 분기 무시 (안전망)
 *   2. isAdminBypass + GEMINI_ADMIN_BYPASS_MODEL — P171: admin Test Mode 전용
 *   3. PLANNER_FLASH_PCT bucketing — P172: 일반 사용자 일부 Flash A/B
 *      - PLANNER_FLASH_PCT 미설정/0 → skip (기존 동작)
 *      - identifierForBucketing 미제공 → skip (fallback Pro)
 *      - bucket < PCT → GEMINI_FLASH_BUCKET_MODEL 또는 'gemini-3.5-flash'
 *   4. GEMINI_{ROLE}_MODEL — 모듈별 미세 control
 *   5. DEFAULTS — 코드 default
 *
 * @param {'main'|'block'|'classifier'|'translate'} role - 모듈 식별자
 * @param {object} [opts]
 * @param {boolean} [opts.isAdminBypass] - P171 (2026-05-23): admin Test Mode 면
 *   env GEMINI_ADMIN_BYPASS_MODEL 우선 (운영자가 Pro→Flash 품질 직접 비교용).
 *   default 미설정 → 기존 동작 (Pro 또는 ENV override). backward-compat 100%.
 *   GEMINI_MODEL_OVERRIDE (전역 emergency) 가 있으면 admin bypass 보다 우선 (안전망).
 *   admin (P171) 이 PCT bucketing (P172) 보다 우선 — 운영자 admin 으로 직접 비교 시
 *   PCT 영향 받지 않게.
 * @param {string|null} [opts.identifierForBucketing] - P172 (2026-05-24): uid/guestEmail/sessionId
 *   중 첫 non-empty (plannerMode.pickIdentifier 와 동일 패턴). PCT bucketing 의 입력.
 *   미제공 또는 null → PCT bucketing skip → fallback Pro (안전).
 *   deterministic — 동일 identifier 는 동일 bucket (사용자 mid-revision 시 모델 안 바뀜).
 * @param {object} [opts._env] - (테스트 전용) process.env 대신 사용할 env 오브젝트.
 * @returns {string} - Gemini API 의 model ID (예: 'gemini-3.5-flash')
 * @throws {TypeError} - role 이 유효하지 않으면 throw
 */
export function resolveGeminiModel(role, opts = {}) {
  if (!DEFAULTS[role]) {
    throw new TypeError(
      `resolveGeminiModel: invalid role "${role}". Allowed: ${Object.keys(DEFAULTS).join(', ')}`,
    );
  }

  const envSource = opts._env || process.env;

  // 1. 일괄 override (운영자 emergency rollback) — P171: admin bypass 보다 우선 (안전망)
  const globalOverride = (envSource.GEMINI_MODEL_OVERRIDE || '').trim();
  if (globalOverride) return globalOverride;

  // 2. P171 (2026-05-23): admin Test Mode + GEMINI_ADMIN_BYPASS_MODEL 설정 시 우선.
  // 운영자가 TEST- prefix orderId 로 5-10 plan 생성해 Pro vs Flash 품질 직접 비교.
  // 미설정 (default) → 기존 분기 (Pro 유지 — P135 운영자 결정).
  // 일반 사용자 (isAdminBypass=false) → 이 분기 진입 안 함 → 영향 0.
  // admin (P171) 이 PCT bucketing (P172) 보다 우선 — 운영자 admin 비교 시 PCT 영향 방지.
  if (opts.isAdminBypass) {
    const adminBypassModel = (envSource.GEMINI_ADMIN_BYPASS_MODEL || '').trim();
    if (adminBypassModel) return adminBypassModel;
  }

  // 3. P172 (2026-05-24): PLANNER_FLASH_PCT bucketing — 일반 사용자 일부 Flash A/B.
  // ENV default 0 = 영향 0 (기존 동작 100% backward-compat).
  // identifier 미제공 시 → fallback Pro (안전). 동일 identifier = 동일 bucket (deterministic).
  // isAdminBypass=true → 위쪽 분기 (P171) 에서 이미 처리 → 여기 도달 안 함.
  if (role === 'main') {
    const flashPct = parsePct(envSource.PLANNER_FLASH_PCT);
    if (flashPct > 0 && opts.identifierForBucketing) {
      const bucket = bucketFor(opts.identifierForBucketing);
      if (bucket < flashPct) {
        const flashBucketModel = (envSource.GEMINI_FLASH_BUCKET_MODEL || '').trim() || 'gemini-3.5-flash';
        return flashBucketModel;
      }
    }
  }

  // 4. 모듈별 ENV
  const roleEnvKey = ROLE_ENV_MAP[role];
  const roleOverride = (envSource[roleEnvKey] || '').trim();
  if (roleOverride) return roleOverride;

  // 5. Default (마이그 후 3.5 series)
  return DEFAULTS[role];
}

// Test / lint helper — DEFAULTS 노출 (test fixture 단순화)
export const _GEMINI_MODEL_DEFAULTS = DEFAULTS;
export const _GEMINI_ROLE_ENV_MAP = ROLE_ENV_MAP;
