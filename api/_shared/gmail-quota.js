/**
 * Gmail SMTP daily-quota guard.
 *
 * PR #447 (Audit Z-H8 — 2026-05-16).
 *
 * Gmail's SMTP send limit for free accounts is 500/day (Workspace: 2000/day).
 * If we exceed it, Gmail returns "550 5.4.5 Daily user sending quota exceeded"
 * and locks the account for ~24 hours. Pre-fix: no quota tracking →
 * customer confirmation emails just started silent-failing once the cap
 * was hit (operator only noticed via PR #439's pending_email_retries
 * queue after multiple failed sweeps).
 *
 * This helper:
 *   1. Maintains a Firestore counter at `email_send_counter/{YYYY-MM-DD}.count`
 *      (atomic FieldValue.increment, no race).
 *   2. At 80% of quota → throttled operator alert ("Gmail usage 80%")
 *      with 1-day dedup so the same warning fires at most once per day.
 *   3. At 96% of quota → hard block: throws `GMAIL_QUOTA_EXCEEDED` so the
 *      caller's customer-email-trigger (PR #439 / P63) routes the message
 *      into `pending_email_retries` for next-day retry. Sends still go
 *      through tomorrow when the counter rolls over.
 *
 * Failure modes:
 *   - Firestore down → fail-OPEN (allow send, log warn). The 500-cap is
 *     an upper bound; degrading to "no guard" for a brief outage is safer
 *     than locking out all email during a Firebase incident.
 *   - GMAIL_DAILY_QUOTA env override lets operators with Workspace
 *     accounts raise the cap to 2000 without code change.
 */

import { initAdminDb } from './firebase-admin.js';
import { throttledTelegramAlert } from './telegram-throttle.js';

const COLLECTION = 'email_send_counter';
const DEFAULT_DAILY_QUOTA = 500; // free Gmail; override via GMAIL_DAILY_QUOTA env
const WARN_THRESHOLD_PCT = 80;
const HARD_BLOCK_THRESHOLD_PCT = 96;

export const GMAIL_QUOTA_EXCEEDED = 'GMAIL_QUOTA_EXCEEDED';

function todayKey() {
  // UTC date — Gmail's reset rolls daily but the exact reset hour is
  // account-region-specific. UTC is the safest single bucket.
  return new Date().toISOString().slice(0, 10);
}

function resolveQuota() {
  const env = Number(process.env.GMAIL_DAILY_QUOTA);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_DAILY_QUOTA;
}

/**
 * Check the current day's send count against quota.
 *
 * @returns {Promise<{ok: true, count: number, quota: number, warn?: boolean} | {ok: false, code: 'GMAIL_QUOTA_EXCEEDED', count: number, quota: number}>}
 */
export async function checkGmailQuota() {
  const db = initAdminDb('gmail-quota');
  if (!db) {
    // Fail-OPEN — Firestore outage shouldn't lock out all email sending.
    return { ok: true, count: 0, quota: resolveQuota(), degraded: true };
  }
  const quota = resolveQuota();
  const hardBlockAt = Math.floor(quota * HARD_BLOCK_THRESHOLD_PCT / 100);
  const warnAt = Math.floor(quota * WARN_THRESHOLD_PCT / 100);
  const key = todayKey();
  try {
    const snap = await db.collection(COLLECTION).doc(key).get();
    const count = snap.exists ? Number(snap.data()?.count || 0) : 0;
    if (count >= hardBlockAt) {
      return { ok: false, code: GMAIL_QUOTA_EXCEEDED, count, quota };
    }
    return { ok: true, count, quota, warn: count >= warnAt };
  } catch (e) {
    console.warn('[gmail-quota] read failed (fail-OPEN):', e.message);
    return { ok: true, count: 0, quota, degraded: true, error: e.message };
  }
}

/**
 * Atomic increment after a successful send. Best-effort: any Firestore
 * error is swallowed (counter accuracy < deliverability).
 *
 * Also fires the operator warn-alert when the post-increment count
 * crosses the 80% threshold. Dedup via throttledTelegramAlert keyed on
 * the day so the same warning fires at most once per day.
 */
export async function incrementGmailSentCount() {
  const db = initAdminDb('gmail-quota');
  if (!db) return;
  const key = todayKey();
  const quota = resolveQuota();
  const warnAt = Math.floor(quota * WARN_THRESHOLD_PCT / 100);
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    const ref = db.collection(COLLECTION).doc(key);
    await ref.set(
      {
        count: FieldValue.increment(1),
        lastSentAt: FieldValue.serverTimestamp(),
        quota,
      },
      { merge: true },
    );
    // Read-back to see if we just crossed the warn threshold. One extra
    // read per send is cheap given the deliverability stakes.
    const snap = await ref.get();
    const count = Number(snap.data()?.count || 0);
    if (count === warnAt || (count > warnAt && count < warnAt + 5)) {
      // Fire once at or near the threshold — throttle dedups by day.
      throttledTelegramAlert({
        key: `gmail-quota-warn-${key}`,
        channel: 'admin',
        severity: 'high',
        message: [
          '⚠️ <b>Gmail SMTP 일일 quota 80% 도달</b>',
          '',
          `<b>오늘 발송:</b> ${count} / ${quota}`,
          `<b>날짜 (UTC):</b> ${key}`,
          '',
          '→ 96% 도달 시 새로운 발송은 pending_email_retries 큐로 (다음날 자동 재시도).',
          '→ Workspace 계정이면 GMAIL_DAILY_QUOTA=2000 env 설정 권장.',
        ].join('\n'),
        context: { date: key, count, quota },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[gmail-quota] increment failed (best-effort):', e.message);
  }
}

/** Test helper — clear the cached env-resolved quota (env vars change in tests). */
export const __internals = { todayKey, resolveQuota, COLLECTION, DEFAULT_DAILY_QUOTA, WARN_THRESHOLD_PCT, HARD_BLOCK_THRESHOLD_PCT };
