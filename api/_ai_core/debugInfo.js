/**
 * P177 (2026-05-24): admin-bypass 한정 _debug 정보 생성.
 *
 * handlerCore.js 의 _ok response 에 노출 — measure script + 자율 검증이 model +
 * plannerMode + abReason 자동 식별. Vercel Dashboard ENV (`GEMINI_ADMIN_BYPASS_MODEL`)
 * 직접 확인 우회.
 *
 * 보안: gate.isAdminBypass=false 시 undefined 반환 → _ok spread 시 _debug 키
 * 미포함. 일반 user 영향 0 — Pro vs Flash A/B 정보 leak 차단 (R-P177 lint 강제).
 *
 * 추출 이유 (P170 후속 메타 lesson): handlerCore.js cap 500 line 압박 — 본 함수
 * 별도 모듈로 line 절약.
 *
 * @module api/_ai_core/debugInfo
 */
import { resolveGeminiModel } from './geminiModelResolver.js';

/**
 * Build admin-bypass _debug payload. Returns undefined for non-admin-bypass
 * requests so the caller can spread `...(d ? { _debug: d } : {})`.
 *
 * @param {object} args
 * @param {object} args.gate                  paymentGate output (gate.isAdminBypass)
 * @param {string} args.plannerMode           PLANNER_MODE ('legacy' | '3pass')
 * @param {object} args.abDecision            decidePlannerMode output (reason / bucket)
 * @param {string|null} args.identifierForBucketing  pickIdentifier output
 * @param {boolean} args.blockModeUsed
 * @param {string[]} args.blocksUsed
 * @param {boolean} args.useStreaming
 * @returns {object|undefined}
 */
export function buildAdminDebug({
  gate, plannerMode, abDecision, identifierForBucketing,
  blockModeUsed, blocksUsed, useStreaming,
}) {
  if (!gate || !gate.isAdminBypass) return undefined;
  return {
    isAdminBypass: true,
    plannerMode,
    modelMain: resolveGeminiModel('main', { isAdminBypass: true, identifierForBucketing }),
    abReason: abDecision && abDecision.reason,
    abBucket: abDecision && abDecision.bucket,
    blockModeUsed,
    ...(Array.isArray(blocksUsed) && blocksUsed.length > 0 ? { blocksUsed } : {}),
    streamingEnabled: useStreaming,
  };
}
