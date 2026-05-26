/**
 * Vercel API route: /api/inngest — Inngest serve handler (P220, 2026-05-26).
 *
 * 본 endpoint 는 Inngest platform 이 worker 를 trigger 할 때 호출.
 *   - GET  /api/inngest  → function registry sync (Inngest dashboard 가 호출)
 *   - POST /api/inngest  → event-triggered function invocation
 *   - PUT  /api/inngest  → manual sync from dashboard ("Sync" 버튼)
 *
 * 운영자 후속 의무:
 *   1. Inngest 대시보드에서 "Add App" → URL = https://cocotripkr.com/api/inngest
 *   2. Vercel ENV 추가:
 *      - INNGEST_EVENT_KEY  (publisher 측 — ai-planner-full 이 send() 할 때)
 *      - INNGEST_SIGNING_KEY (worker 측 — Inngest 가 본 endpoint 호출 시 서명 검증)
 *   3. 첫 dispatch 확인: Inngest 대시보드 → Functions → "Plan post-AI pipeline" run history
 *
 * Vercel config:
 *   - maxDuration = 300 (5분) — 1 step.run 호출 cap. 누적 시간 무관 (Inngest 가 step 마다 invocation 분리).
 *   - Fluid Compute 활성화 시 800s 까지 가능 (P165 패턴 동일).
 *
 * SAFETY:
 *   - serve() 가 INNGEST_SIGNING_KEY 자동 검증 → 외부 spoofing 차단.
 *   - dev 환경 (INNGEST_DEV=1) 에서는 signing skip.
 */
import { serve } from 'inngest/node';
import { inngest } from './_inngest/client.js';
import { processPlanAfterAI } from './_inngest/functions/processPlanAfterAI.js';

// Vercel runtime config — 본 endpoint 는 GET/POST/PUT 모두 지원해야 함.
// maxDuration = 300 (Pro 기본 5분 cap). step.run 1회 cap — 누적 시간 무관.
export const config = { runtime: 'nodejs' };
export const maxDuration = 300;

/**
 * Vercel default export 는 (req, res) => void 시그니처.
 * `serve()` 는 http.RequestListener 반환 — 정확히 일치.
 */
export default serve({
  client: inngest,
  functions: [
    processPlanAfterAI,
    // 추후 worker 추가 시 여기에 push (예: refundProcessor, scheduledEmail 등)
  ],
});
