/**
 * Vercel API Route: AI Planner Full v2
 * POST /api/ai-planner-full
 *
 * 2026-06-01: 오픈 후 개선 기능 플래그 8종 롤아웃 — fresh 배포로 Production env 반영
 *   (Vercel "Redeploy" 는 원본 배포의 env 스냅샷 재사용 → 신규 commit 으로 현재 env 적용).
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
// Gemini 90-150s + retry 발동 시 5분 초과 risk).
// P270 (2026-05-29): 600 → 800 + vercel.json:71 동기화. faab8777 plan (legacy 1-pass 다도시)
//   가 vercel.json maxDuration:300 (export 보다 우선) 직격 296s timeout 검증 (P266 cycle 진단).
//   Vercel Fluid Compute 한도 800s 활용. 운영자 액션 (Dashboard Functions Fluid Compute 활성화 토글) 동일.
export const maxDuration = 800;
export const config = { runtime: 'nodejs' };

export { inferDepartureAirport } from './_ai_core/airportInference.js';
export { default } from './_ai_core/handlerCore.js';
