/**
 * CocoTripKR — Cron Job Dispatcher
 * GET /api/cron-runner?job=<job-name>
 *
 * Dispatches to individual cron handlers in api/_crons/
 * Vercel cron paths: /api/cron-runner?job=daily-report etc.
 *
 * Auth (PR #419, Audit CZ3 / WC5 — 2026-05-13): every invocation must
 * present either CRON_SECRET (Bearer), the Vercel `x-vercel-cron: 1`
 * platform header, or an admin Firebase ID token. Otherwise the dispatcher
 * could be called publicly to fire mass email / Telegram blasts (operator
 * spam, customer email quota abuse). Detail in api/_shared/cron-auth.js.
 */

import dailyReport from './_crons/daily-report.js';
import refundReminder from './_crons/refund-reminder.js';
import dispatchTimeoutSweep from './_crons/dispatch-timeout-sweep.js';
import weeklyQualityReport from './_crons/weekly-quality-report.js';
import dispatchReminder from './_crons/dispatch-reminder.js';
import operatorTodoReminder from './_crons/operator-todo-reminder.js';
import processorRetrySweep from './_crons/processor-retry-sweep.js';
import emailRetrySweep from './_crons/email-retry-sweep.js';
import aiPlannerRetrySweep from './_crons/ai-planner-retry-sweep.js';
import slotPendingSweep from './_crons/slot-pending-sweep.js';
// P292 (2026-05-29): plans.status='streaming' stuck sweep — 5/29 핸드오프 큐 #1.
import planStreamingSweep from './_crons/plan-streaming-sweep.js';
// Track B trend cron foundation (2026-05-21) — zone_courses placeholder data.
import scanNaverRising from './_crons/scan-naver-rising.js';
import scanRedditPainpoints from './_crons/scan-reddit-painpoints.js';
import scanVisitkoreaAttractions from './_crons/scan-visitkorea-attractions.js';
// P130 (2026-05-21) — weekly intent classifier 모니터링.
import intentClassifierSummary from './_crons/intent-classifier-summary.js';
import morningBriefing from './_crons/morning-briefing.js';
import reviewRequest from './_crons/review-request.js';
import contentDraft from './_crons/content-draft.js';
import opsWatchdog from './_crons/ops-watchdog.js';
import kpopCalendarCheck from './_crons/kpop-calendar-check.js';
// 2026-08-19 — 무료 미리보기(free-preview) 이탈 회복 이메일 (🔒 PREVIEW_RECOVERY_ENABLED OFF=dryRun).
import previewLeadRecovery from './_crons/preview-lead-recovery.js';
import { verifyCronRequest } from './_shared/cron-auth.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const JOBS = {
  'daily-report':            dailyReport,
  'refund-reminder':         refundReminder,
  'dispatch-timeout-sweep':  dispatchTimeoutSweep,
  'weekly-quality-report':   weeklyQualityReport,
  'dispatch-reminder':       dispatchReminder,
  'operator-todo-reminder':  operatorTodoReminder,
  'processor-retry-sweep':   processorRetrySweep,
  'email-retry-sweep':       emailRetrySweep,
  'ai-planner-retry-sweep':  aiPlannerRetrySweep,
  'slot-pending-sweep':      slotPendingSweep,
  // P292 (2026-05-29)
  'plan-streaming-sweep':    planStreamingSweep,
  // Track B trend cron foundation (2026-05-21)
  'scan-naver-rising':           scanNaverRising,
  'scan-reddit-painpoints':      scanRedditPainpoints,
  'scan-visitkorea-attractions': scanVisitkoreaAttractions,
  // P130 (2026-05-21) — weekly intent classifier 모니터링.
  'intent-classifier-summary':   intentClassifierSummary,
  // 2026-06-10 자가운영 에이전시 P1 — 매일 아침 운영자 텔레그램 브리핑 (AI 0, Firestore 집계).
  'morning-briefing':            morningBriefing,
  // 2026-06-10 자가운영 에이전시 배치B — 투어 후 리뷰요청 (🔒 REVIEW_REQUEST_ENABLED 플래그 OFF=dryRun).
  'review-request':              reviewRequest,
  // 2026-06-10 자가운영 에이전시 P3 — 마케팅 콘텐츠 직원 (🔒 CONTENT_WORKER_ENABLED 플래그 OFF=비활성, draft만).
  'content-draft':               contentDraft,
  // 2026-06-10 자가운영 에이전시 P2심화 — 수정팀(운영 감시원). 어제 데이터 재검산→의사결정 큐 (🔒 OPS_WATCHDOG_ENABLED OFF, 발견만/수정 X).
  'ops-watchdog':                opsWatchdog,
  // 2026-07-25 — K-pop 공연 목록 소진 감시 (매월 1일). AI 0·외부 API 0, JSON 만 읽음.
  //   목록이 마르면 차터 K-pop 탭이 조용히 빈 화면이 되던 것 방지.
  'kpop-calendar-check':         kpopCalendarCheck,
  // 2026-08-19 — free-preview 이탈 회복 이메일 (🔒 PREVIEW_RECOVERY_ENABLED OFF, dryRun만).
  'preview-lead-recovery':       previewLeadRecovery,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }

  // Auth gate first — refuses unknown callers before touching Firestore /
  // sending emails / firing Telegram alerts. PR #419 (Audit CZ3 / WC5).
  const auth = await verifyCronRequest(req);
  if (!auth.ok) {
    res.writeHead(auth.status, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: false,
      error: auth.error,
      code: 'AUTH_REQUIRED',
    }));
  }

  const job = req.query?.job
    || new URL(req.url, 'http://localhost').searchParams.get('job');

  if (!job || !JOBS[job]) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: `Unknown job: "${job}"`,
      available: Object.keys(JOBS),
    }));
  }

  console.log(`[cron-runner] executing job: ${job} (source=${auth.source})`);
  return JOBS[job](req, res);
}
