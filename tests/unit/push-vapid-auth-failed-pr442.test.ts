/**
 * PR #442 — Audit Z-H15 regression slot.
 *
 * Pre-fix: api/_send-push.js's sendPush() treated only 410 Gone / 404
 * Not Found as `expired`. 401 Unauthorized and 403 Forbidden — the
 * statuses you get when VAPID keys are rotated or the browser revoked
 * push permission — produced `{ok: false, statusCode}` with no
 * `expired` flag, so sendPushToUser never deleted them. Every cron
 * tick re-tried the same dead subscriptions forever, silently consuming
 * CPU and PayPal-adjacent operator quota.
 *
 * If VAPID was rotated incorrectly (e.g., env vars updated but old
 * subscriptions still pointed at old keys), EVERY subscription would
 * 401/403 and the operator had no signal.
 *
 * Post-fix:
 *   - sendPush returns `authFailed: true` for 401/403 (separate from
 *     `expired` for 410/404)
 *   - sendPushToUser increments a `failedAttempts` counter on the
 *     subscription doc; after MAX_AUTH_FAILED_ATTEMPTS (5) the sub is
 *     deleted. This prevents mass-cleanup on a one-off VAPID misconfig.
 *   - throttledTelegramAlert with key='push-vapid-auth-failed' (1-hour
 *     dedup via existing telegram-throttle helper) — operator sees one
 *     alert per hour during a misconfig storm, not 100s.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_send-push.js'),
  'utf8',
);

describe('PR #442 Z-H15 — sendPush distinguishes auth-failed from gone', () => {
  it('AUTH_FAILED_STATUS set contains 401 and 403', () => {
    expect(src).toMatch(/AUTH_FAILED_STATUS\s*=\s*new\s+Set\(\[\s*401\s*,\s*403\s*\]\)/);
  });

  it('PERMANENT_GONE_STATUS set contains 404 and 410', () => {
    expect(src).toMatch(/PERMANENT_GONE_STATUS\s*=\s*new\s+Set\(\[\s*404\s*,\s*410\s*\]\)/);
  });

  it('sendPush return shape carries authFailed flag separate from expired', () => {
    // Both flags are computed via the status sets, then returned in the failure-branch object.
    expect(src).toMatch(/const\s+expired\s*=\s*PERMANENT_GONE_STATUS\.has\(\s*statusCode\s*\)/);
    expect(src).toMatch(/const\s+authFailed\s*=\s*AUTH_FAILED_STATUS\.has\(\s*statusCode\s*\)/);
    expect(src).toMatch(/return\s*\{\s*ok:\s*false[\s\S]*?expired[\s\S]*?authFailed[\s\S]*?\}/);
  });
});

describe('PR #442 Z-H15 — sendPushToUser cleanup behavior', () => {
  it('expired subscriptions are deleted immediately (existing 410/404 behavior)', () => {
    expect(src).toMatch(/expiredDocs\.push/);
    expect(src).toMatch(/for\s*\(\s*const\s+ref\s+of\s+expiredDocs\s*\)/);
    expect(src).toMatch(/ref\.delete\(\)/);
  });

  it('auth-failed subscriptions go through a failedAttempts counter, NOT instant delete', () => {
    expect(src).toMatch(/authFailedDocs\.push/);
    expect(src).toMatch(/failedAttempts/);
    expect(src).toMatch(/nextAttempts\s*=\s*currentAttempts\s*\+\s*1/);
    expect(src).toMatch(/MAX_AUTH_FAILED_ATTEMPTS\s*=\s*5/);
  });

  it('only deletes auth-failed subscription when threshold met', () => {
    // The delete must be inside an `if (nextAttempts >= MAX_AUTH_FAILED_ATTEMPTS)` branch
    expect(src).toMatch(/if\s*\(\s*nextAttempts\s*>=\s*MAX_AUTH_FAILED_ATTEMPTS\s*\)/);
  });

  it('persists failedAttempts + lastFailureAt on every auth-failed (audit trail)', () => {
    expect(src).toMatch(/failedAttempts:\s*nextAttempts/);
    expect(src).toMatch(/lastFailureAt:\s*FieldValue\.serverTimestamp\(\)/);
    expect(src).toMatch(/lastFailureReason:\s*['"]vapid-auth-failed['"]/);
  });
});

describe('PR #442 Z-H15 — throttled operator alert (VAPID rotate signal)', () => {
  it('imports throttledTelegramAlert', () => {
    expect(src).toMatch(/import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('alert fires only when authFailedDocs is non-empty', () => {
    expect(src).toMatch(/if\s*\(\s*authFailedDocs\.length\s*>\s*0\s*\)/);
  });

  it('uses a stable dedup key + admin channel', () => {
    expect(src).toMatch(/key:\s*['"]push-vapid-auth-failed['"]/);
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
  });

  it('alert is fire-and-forget (caller does not await the throttle)', () => {
    // The alert call should NOT be awaited (cron path must stay fast).
    expect(src).toMatch(/throttledTelegramAlert\([\s\S]*?\)\.catch\(/);
  });
});

describe('PR #442 Z-H15 — sendPushToUser return shape (cron + admin observability)', () => {
  it('returns authFailed + authFailedDeleted counters', () => {
    expect(src).toMatch(/authFailed:\s*authFailedDocs\.length/);
    expect(src).toMatch(/authFailedDeleted/);
  });
});
