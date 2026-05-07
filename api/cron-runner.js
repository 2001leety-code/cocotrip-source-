/**
 * CocoTripKR — Cron Job Dispatcher
 * GET /api/cron-runner?job=<job-name>
 *
 * Dispatches to individual cron handlers in api/_crons/
 * Vercel cron paths: /api/cron-runner?job=daily-report etc.
 */

import dailyReport from './_crons/daily-report.js';
import refundReminder from './_crons/refund-reminder.js';
import dispatchTimeoutSweep from './_crons/dispatch-timeout-sweep.js';
import weeklyQualityReport from './_crons/weekly-quality-report.js';
import dispatchReminder from './_crons/dispatch-reminder.js';
import operatorTodoReminder from './_crons/operator-todo-reminder.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const JOBS = {
  'daily-report':            dailyReport,
  'refund-reminder':         refundReminder,
  'dispatch-timeout-sweep':  dispatchTimeoutSweep,
  'weekly-quality-report':   weeklyQualityReport,
  'dispatch-reminder':       dispatchReminder,
  'operator-todo-reminder':  operatorTodoReminder,
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

  const job = req.query?.job
    || new URL(req.url, 'http://localhost').searchParams.get('job');

  if (!job || !JOBS[job]) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: `Unknown job: "${job}"`,
      available: Object.keys(JOBS),
    }));
  }

  console.log(`[cron-runner] executing job: ${job}`);
  return JOBS[job](req, res);
}
