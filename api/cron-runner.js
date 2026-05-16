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
