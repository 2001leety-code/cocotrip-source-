/**
 * Inngest client singleton — P220 (2026-05-26).
 *
 * 배경: 5/26 prod alerts (P181 "Plan save failed (4)" = gRPC DEADLINE_EXCEEDED,
 *   route-enrich-timeout, 27분 hang) → Vercel 300s function cap 회피 + Firestore
 *   write 의 durable retry 가 필요. 3 AI second opinion (Claude/GPT-thinking/Gemini)
 *   합의: async worker 분리 = 장기 필수 architecture.
 *
 * 본 모듈은 Inngest event publisher 만 export. 실제 worker function 정의는
 * `api/_inngest/functions/*.js` 가 import 해서 사용. `api/inngest.js` 가 serve()
 * handler 진입점.
 *
 * 안전장치:
 *   - INNGEST_EVENT_KEY 없으면 client 생성은 되지만 send() = no-op (개발 모드).
 *   - Vercel ENV 미설정 시 silent fail 차단: ai-planner-full.js 진입점에서
 *     `isInngestConfigured()` 검사 → false 면 기존 inline pipeline fallback.
 *
 * Related:
 *   - [[feedback_mistake_p220_inngest_async_worker]] (예정)
 *   - api/_ai_core/backgroundPipelines.js — P168/P169 fire-and-forget pattern (본 PR 의 전신)
 *   - api/_ai_core/handlerCore.js — main planner pipeline
 */
import { Inngest } from 'inngest';

/**
 * P220: Inngest client.
 *
 * `id` = Inngest 대시보드에서 app 식별. 'cocotrip' 고정 — prod / preview 모두 동일.
 * `eventKey` 는 INNGEST_EVENT_KEY env 가 있으면 SDK 가 자동 픽업. 명시 인자 X (보안).
 * `isDev` 는 INNGEST_DEV=1 자동. local 개발 시 dev server 자동 연결.
 */
export const inngest = new Inngest({
  id: 'cocotrip',
  // eventKey: process.env.INNGEST_EVENT_KEY  — SDK auto-pickup (보안 권장 패턴, docs 명시).
  // signingKey: process.env.INNGEST_SIGNING_KEY — serve() handler 에서 검사.
});

/**
 * P220 안전장치: Inngest 가 prod 에서 활성화됐는지 검사.
 *
 * - true: send() 가 실제 Inngest API 로 dispatch → durable worker 실행.
 * - false: 운영자가 ENV 추가 안 했음 → ai-planner-full 이 기존 inline pipeline 으로 fallback.
 *
 * 운영자 후속 의무:
 *   1. Inngest 계정 가입 (https://app.inngest.com)
 *   2. App 생성 → Event Key + Signing Key 발급
 *   3. Vercel Dashboard → Settings → Environment Variables:
 *      - INNGEST_EVENT_KEY = (Event Key)
 *      - INNGEST_SIGNING_KEY = (Signing Key)
 *   4. Vercel redeploy → 자동 활성화.
 *
 * @returns {boolean}
 */
export function isInngestConfigured() {
  // INNGEST_EVENT_KEY 가 publisher 측, INNGEST_SIGNING_KEY 가 worker 측.
  // 둘 다 있어야 round-trip 동작. 한 쪽만 있으면 silent fail 방지 위해 false.
  return !!(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

/**
 * Event name constants — typo 방지 + grep 가능성. functions/*.js 정의도 동일 키 사용.
 */
export const INNGEST_EVENTS = {
  /** Gemini + validate + DB match 완료 후 발행. worker 가 routeEnrich + persistPlan 진행. */
  PLAN_AI_COMPLETE: 'plan/ai.complete',
};
