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
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';

// Vercel runtime config — 본 endpoint 는 GET/POST/PUT 모두 지원해야 함.
// maxDuration = 300 (Pro 기본 5분 cap). step.run 1회 cap — 누적 시간 무관.
export const config = { runtime: 'nodejs' };
export const maxDuration = 300;

// P96 (PR #482) hang 진단 — withStep + hangWarnTimer 패턴 (ai-planner-full.js 동일).
// 본 endpoint 는 Inngest 가 GET/POST/PUT 3종 호출. step.run instrumentation 은 worker
// function 내부 자체 (Inngest SDK 가 step elapsed 로그 + retry). 본 wrapper 는 serve()
// 호출 자체가 hang 하는 케이스 (Inngest API outage) 진단용.
const HANG_WARN_MS = 270_000; // cap (300s) - 30s
async function withStep(label, fn) {
  const t0 = Date.now();
  console.log(`[inngest-serve] step=${label} ENTER`);
  try {
    const result = await fn();
    console.log(`[inngest-serve] step=${label} DONE ${Date.now() - t0}ms`);
    return result;
  } catch (err) {
    console.error(`[inngest-serve] step=${label} FAILED ${Date.now() - t0}ms — ${err.message}`);
    throw err;
  }
}

const baseHandler = serve({ client: inngest, functions: [processPlanAfterAI] });

/**
 * Vercel default export — (req, res) => void. P96 hang alert wrapper 추가.
 * serve() 자체가 long-running 하면 4분30초 시점에 admin telegram alert.
 */
export default async function handler(req, res) {
  const hangWarnTimer = setTimeout(() => {
    throttledTelegramAlert({
      key: 'inngest-serve-hang',
      channel: 'admin',
      severity: 'high',
      message: `Inngest serve() 4분30초 hang — method=${req.method} url=${req.url}`,
    }).catch(() => {});
  }, HANG_WARN_MS);
  if (hangWarnTimer.unref) hangWarnTimer.unref();
  try {
    return await withStep(`serve:${req.method}`, () => baseHandler(req, res));
  } finally {
    clearTimeout(hangWarnTimer);
  }
}
