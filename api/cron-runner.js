/**
 * CocoTripKR — Cron Job Dispatcher
 * GET /api/cron-runner?job=<job-name>
 *
 * Dispatches to individual cron handlers in api/_crons/
 * Vercel cron paths: /api/cron-runner?job=daily-report etc.
 */

import dailyReport from './_crons/daily-report.js';
// ── 비활성화된 크론 (2026-04-10) ──────────────────────
// import trafficAlert from './_crons/traffic-alert.js';
// import contentGenerator from './_crons/content-generator.js';
// import competitorMonitor from './_crons/competitor-monitor.js';
// import retargetScheduler from './_crons/retarget-scheduler.js';
// import reviewScheduler from './_crons/review-scheduler.js';
// import redditMonitor from './_crons/reddit-monitor.js';
// import weatherCheck from './_crons/weather-check.js';
// import blogPublisher from './_crons/blog-publisher.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const JOBS = {
  'daily-report':       dailyReport,
  // 'traffic-alert':      trafficAlert,
  // 'content-generator':  contentGenerator,
  // 'competitor-monitor': competitorMonitor,
  // 'retarget-scheduler': retargetScheduler,
  // 'review-scheduler':   reviewScheduler,
  // 'reddit-monitor':     redditMonitor,
  // 'weather-check':      weatherCheck,
  // 'blog-publisher':     blogPublisher,
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
