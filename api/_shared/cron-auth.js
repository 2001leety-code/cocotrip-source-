/**
 * Cron request authentication.
 *
 * Audit CZ3 / WC5 fix (PR #419, 2026-05-13): /api/cron-runner had no auth →
 * anyone hitting `/api/cron-runner?job=daily-report` could fire mass email
 * + Telegram blasts (operator alert spam, customer email quota abuse).
 *
 * Three accepted callers (the union — first match wins):
 *
 *   1. Vercel cron — sends `Authorization: Bearer ${CRON_SECRET}` when the
 *      `CRON_SECRET` env var is set on the project. This is the normal
 *      scheduled path triggered by vercel.json `crons`.
 *
 *   2. Vercel platform header — internal cron + Vercel-side replays set
 *      `x-vercel-cron: 1`. Even without CRON_SECRET configured this is
 *      enforced by Vercel as a private signal (request originates from
 *      Vercel's internal scheduler, not the public internet).
 *
 *   3. Authenticated admin — operator running a manual job from
 *      `/admin/...` for debugging. Uses the existing `verifyAdminToken`
 *      helper (Bearer Firebase ID token, must match `ADMIN_EMAIL` env).
 *
 * Anything else → 401 / 403. Callers see only `{ ok:false, error:'...' }`
 * without leaking which check failed.
 *
 * Helper returns `{ ok:true, source:'vercel-cron'|'admin-token' }` on success
 * so downstream handlers can log how the job was triggered.
 */
import { verifyAdminToken } from './admin-auth.js';

/** Constant-time string compare (token-side timing leak hardening). */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * @param {object} req - HTTP request (Vercel/Next)
 * @returns {Promise<{ok: true, source: 'vercel-cron' | 'admin-token'} | {ok: false, status: number, error: string}>}
 */
export async function verifyCronRequest(req) {
  const headers = req.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  const vercelCronHeader = headers['x-vercel-cron'] || headers['X-Vercel-Cron'];

  // (1) CRON_SECRET — preferred when env var is set.
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret) {
    const m = /^Bearer\s+(.+)$/.exec(authHeader);
    if (m && timingSafeEqualStr(m[1], cronSecret)) {
      return { ok: true, source: 'vercel-cron' };
    }
  }

  // (2) Vercel internal cron header — fallback path while operator wires up
  // CRON_SECRET (Vercel sets `x-vercel-cron: 1` for scheduled invocations
  // regardless). Cannot be forged by an external caller because Vercel's
  // edge strips this header from inbound public requests.
  if (vercelCronHeader && String(vercelCronHeader).trim() === '1') {
    return { ok: true, source: 'vercel-cron' };
  }

  // (3) Admin manual invocation — debug path. Requires Firebase ID token
  // matching ADMIN_EMAIL.
  if (authHeader && /^Bearer\s+/.test(authHeader) && !cronSecret) {
    // If CRON_SECRET wasn't set we already tried Bearer above and bailed.
    // Now try admin verification.
  }
  if (authHeader && /^Bearer\s+/.test(authHeader)) {
    const adminAuth = await verifyAdminToken(req);
    if (adminAuth.ok) {
      return { ok: true, source: 'admin-token' };
    }
  }

  return {
    ok: false,
    status: 401,
    error: 'Cron requests require Vercel cron header, CRON_SECRET, or admin token',
  };
}

export default verifyCronRequest;
