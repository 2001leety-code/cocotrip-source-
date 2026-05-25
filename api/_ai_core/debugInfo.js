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
 * @param {object} [args.itinerary]  P195: itinerary._cache_metadata 를 pop 해서 _debug 에 노출 + Firestore 저장 제외.
 * @returns {object|undefined}
 */
export function buildAdminDebug({
  gate, plannerMode, abDecision, identifierForBucketing,
  blockModeUsed, blocksUsed, useStreaming, itinerary,
}) {
  if (!gate || !gate.isAdminBypass) return undefined;
  // P195 (2026-05-25): itinerary._cache_metadata pop — admin _debug 노출 전용.
  // Firestore 저장 / 응답 itinerary 에서 제거 (handlerCore 가 호출 후 즉시 persist).
  // 3pass mode + block-mode 등 metadata 미수집 분기 = null fallback → 0 표시.
  const cm = (itinerary && itinerary._cache_metadata) || { cached: 0, total: 0, output: 0 };
  if (itinerary && '_cache_metadata' in itinerary) delete itinerary._cache_metadata;
  const cacheHitRate = cm.total > 0
    ? Math.round((cm.cached / cm.total) * 1000) / 10  // 0.1% 단위
    : 0;
  return {
    isAdminBypass: true,
    plannerMode,
    modelMain: resolveGeminiModel('main', { isAdminBypass: true, identifierForBucketing }),
    abReason: abDecision && abDecision.reason,
    abBucket: abDecision && abDecision.bucket,
    blockModeUsed,
    ...(Array.isArray(blocksUsed) && blocksUsed.length > 0 ? { blocksUsed } : {}),
    streamingEnabled: useStreaming,
    // P195: implicit cache instrumentation (Phase 0 — Gemini 2.5+ auto caching).
    cachedInputTokens: cm.cached,
    totalInputTokens: cm.total,
    outputTokens: cm.output,
    cacheHitRate,
  };
}
