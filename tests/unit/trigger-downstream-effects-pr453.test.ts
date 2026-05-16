/**
 * PR #453 — Audit Z-H7 regression slot.
 *
 * Pre-fix: api/_shared/booking-confirm.js's triggerDownstreamEffects had
 * three silent-failure paths:
 *   1. AI Planner branch: `fetch('/api/ai-planner-full', ...).catch()` —
 *      same silent-fail class as Y-H8 booking-processor. HTTP 500/504
 *      didn't fire .catch → user paid for AI plan, no plan generated.
 *   2. Missing itineraryData case: console.warn only → operator never
 *      saw it → user stuck with paid-but-no-plan.
 *   3. Outer try/catch (procErr): console.warn only → if both branches
 *      threw synchronously, the entire downstream chain disappeared.
 *
 * Post-fix:
 *   - New api/_shared/ai-planner-trigger.js (mirror of P60 booking-
 *     processor-trigger): AbortController 60s + response.ok + retry
 *     queue (pending_ai_planner_retries) + throttled operator alert.
 *   - New cron `ai-planner-retry-sweep` (5min, MAX_ATTEMPTS=3).
 *   - Missing itineraryData path: throttledTelegramAlert with
 *     key='ai-planner-itinerary-missing'.
 *   - Outer try/catch: throttledTelegramAlert with
 *     key='booking-confirm-downstream-throw'.
 *   - Drive-by P55: replaced stale 1380 fallback rate with env
 *     precedence KRW_USD_RATE > VITE_USD_KRW_RATE > 1430.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  triggerAiPlanner,
  PENDING_AI_PLANNER_RETRIES_COLLECTION,
} from '../../api/_shared/ai-planner-trigger.js';

const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/ai-planner-trigger.js'),
  'utf8',
);
const confirmSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/booking-confirm.js'),
  'utf8',
);
const cronSrc = readFileSync(
  resolve(process.cwd(), 'api/_crons/ai-planner-retry-sweep.js'),
  'utf8',
);
const cronRunnerSrc = readFileSync(
  resolve(process.cwd(), 'api/cron-runner.js'),
  'utf8',
);
const vercelJsonSrc = readFileSync(
  resolve(process.cwd(), 'vercel.json'),
  'utf8',
);
const rulesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #453 Z-H7 — triggerAiPlanner helper', () => {
  it('exports PENDING_AI_PLANNER_RETRIES_COLLECTION constant', () => {
    expect(PENDING_AI_PLANNER_RETRIES_COLLECTION).toBe('pending_ai_planner_retries');
  });

  it('helper shape: AbortController + response.ok + retry persist + notify', () => {
    expect(helperSrc).toMatch(/AbortController/);
    expect(helperSrc).toMatch(/r\.ok/);
    expect(helperSrc).toMatch(/pending_ai_planner_retries/);
    expect(helperSrc).toMatch(/notify\(\s*['"]booking['"]/);
  });

  it('60s timeout (AI planner can take 30-50s on multi-city)', () => {
    expect(helperSrc).toMatch(/DEFAULT_TIMEOUT_MS\s*=\s*60_?000/);
  });

  it('returns ok:false on invalid args (caller fire-and-forget safe)', async () => {
    const r1 = await triggerAiPlanner({} as any);
    expect(r1.ok).toBe(false);
    const r2 = await triggerAiPlanner({ siteUrl: 'x' } as any);
    expect(r2.ok).toBe(false);
  });
});

describe('PR #453 Z-H7 — booking-confirm wire-up', () => {
  it('imports triggerAiPlanner + throttledTelegramAlert', () => {
    expect(confirmSrc).toMatch(/import\s*\{[^}]*triggerAiPlanner[^}]*\}\s*from\s*['"]\.\/ai-planner-trigger\.js['"]/);
    expect(confirmSrc).toMatch(/import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\/telegram-throttle\.js['"]/);
  });

  it('AI planner branch uses triggerAiPlanner (NOT raw fetch().catch())', () => {
    expect(confirmSrc).toMatch(/triggerAiPlanner\s*\(\s*\{/);
    // Regression guard: no raw fetch('/api/ai-planner-full').catch()
    const silentFetch = /fetch\(\s*`?\$\{[^}]*\}\/api\/ai-planner-full`?[\s\S]*?\}\s*\)\s*\.\s*catch\(/;
    expect(confirmSrc).not.toMatch(silentFetch);
  });

  it('missing itineraryData path fires throttledTelegramAlert', () => {
    expect(confirmSrc).toMatch(/key:\s*['"]ai-planner-itinerary-missing['"]/);
  });

  it('outer try/catch (procErr) fires throttledTelegramAlert (not just console.warn)', () => {
    expect(confirmSrc).toMatch(/key:\s*['"]booking-confirm-downstream-throw['"]/);
  });

  it('P55 drive-by: replaced stale 1380 fallback with env precedence + 1430', () => {
    // No bare `/ 1380` literal remains
    expect(confirmSrc).not.toMatch(/\/\s*1380(?![0-9])/);
    expect(confirmSrc).toMatch(/Number\(\s*process\.env\.KRW_USD_RATE\s*\)/);
    expect(confirmSrc).toMatch(/Number\(\s*process\.env\.VITE_USD_KRW_RATE\s*\)/);
    expect(confirmSrc).toMatch(/\|\|\s*1430/);
  });
});

describe('PR #453 Z-H7 — cron + infra wiring', () => {
  it('cron-runner registers ai-planner-retry-sweep job', () => {
    expect(cronRunnerSrc).toMatch(/['"]ai-planner-retry-sweep['"]\s*:\s*aiPlannerRetrySweep/);
  });

  it('vercel.json schedules ai-planner-retry-sweep every 5 minutes', () => {
    const json = JSON.parse(vercelJsonSrc);
    const cron = json.crons.find((c: any) => c.path?.includes('ai-planner-retry-sweep'));
    expect(cron, 'ai-planner-retry-sweep cron must be registered').toBeTruthy();
    expect(cron.schedule).toBe('*/5 * * * *');
  });

  it('firestore.rules locks down pending_ai_planner_retries (server-only)', () => {
    expect(rulesSrc).toMatch(
      /match\s+\/pending_ai_planner_retries\/\{bookingRef\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false/,
    );
  });

  it('cron sweep MAX_ATTEMPTS=3 with manual-intervention escalation', () => {
    expect(cronSrc).toMatch(/MAX_ATTEMPTS\s*=\s*3/);
    expect(cronSrc).toMatch(/manual-intervention/);
    expect(cronSrc).toMatch(/notify\s*\(\s*['"]booking['"]/);
  });
});
