/**
 * Vercel API Route: AI Planner Full v2
 * POST /api/ai-planner-full
 *
 * Gemini 2.5 Pro → RouteAgent → T-money 계산 → Firestore 저장 (blocking)
 * → planId + planUrl 응답 → 알림 이메일 (non-blocking)
 *
 * PR #129 (P129, 2026-05-21): 800L → 30L 모듈 분해.
 *   - api/_ai_core/handlerCore.js : try/catch + withStep + hangWarn (~330L)
 *   - api/_ai_core/requestShaper.js : body 정규화 (~190L)
 *   - api/_ai_core/userMessageBuilder.js : Gemini userMessage 조립 (~210L)
 *   - api/_ai_core/postResponsePipeline.js : Route+backfill+T-money+persist (~140L)
 *   - api/_ai_core/airportInference.js : inferDepartureAirport (~30L)
 *
 * 본 파일은 Vercel handler 진입점만 — maxDuration / config / default export
 * re-export. inferDepartureAirport named export 는 backward-compat 유지.
 *
 * Phase 4 A/B test (2026-05-13): mode resolved per-request via
 * decidePlannerMode (api/_ai_core/plannerMode.js). 자세한 흐름은 handlerCore.js.
 */
// P165 (2026-05-23): 300→600 안전망. Vercel Fluid Compute (2025-04-23 default) 으로
// Pro 800s 까지 가능. 단축 효과 0 — 5분 cap fail 위험만 차단 (P138 routeEnrich 39s +
// Gemini 90-150s + retry 발동 시 5분 초과 risk). 운영자 액션: Vercel Dashboard 의
// Settings → Functions → Fluid Compute 활성화 토글 확인.
export const maxDuration = 600;
export const config = { runtime: 'nodejs' };

export { inferDepartureAirport } from './_ai_core/airportInference.js';
export { default } from './_ai_core/handlerCore.js';
