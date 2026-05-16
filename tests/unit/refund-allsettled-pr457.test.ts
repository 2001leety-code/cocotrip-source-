/**
 * PR #457 — Audit Y-H13 regression slot.
 *
 * Pre-fix: api/cancelBooking.js's sendRefundTelegram did
 *   await Promise.allSettled([notify('booking'), notify('dispatch'), notifyOperator('refund')]);
 *
 * Promise.allSettled returns the per-promise result array, but the
 * code discarded it. So:
 *   - notify() resolving with {ok:false, error:...} (semantic failure,
 *     e.g. Telegram bot misconfig) was silent.
 *   - notify() throwing (status='rejected') was silent.
 * If Telegram booking channel was down during a refund storm, the
 * operator never saw refund alerts even though the PayPal refund itself
 * succeeded.
 *
 * Post-fix: per-result inspection. Any failure → fallback
 * throttledTelegramAlert via the admin channel (separate Telegram bot
 * token so booking-channel outages don't take it down). throttle keyed
 * on 'refund-telegram-partial-fail' so a storm doesn't flood.
 *
 * This file asserts the source-code shape (regex against
 * api/cancelBooking.js). Real notify() behavior is exercised by
 * notify-telegram-4096-pr451.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/cancelBooking.js'),
  'utf8',
);

describe('PR #457 Y-H13 — refund Telegram per-channel result inspection', () => {
  it('imports throttledTelegramAlert (for the fallback alert)', () => {
    expect(src).toMatch(/import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('destructures the Promise.allSettled result array (no more discard)', () => {
    expect(src).toMatch(/const\s*\[\s*bookingResult\s*,\s*dispatchResult\s*,\s*operatorResult\s*\]\s*=\s*await\s+Promise\.allSettled/);
  });

  it('inspect helper differentiates rejected vs ok:false', () => {
    // The helper handles both: status==='rejected' AND value.ok===false
    expect(src).toMatch(/result\.status\s*===\s*['"]rejected['"]/);
    expect(src).toMatch(/value\.ok\s*===\s*false/);
  });

  it('checks all 3 channels (booking + dispatch + operator)', () => {
    expect(src).toMatch(/inspect\(\s*['"]booking['"]\s*,\s*bookingResult\s*\)/);
    expect(src).toMatch(/inspect\(\s*['"]dispatch['"]\s*,\s*dispatchResult\s*\)/);
    expect(src).toMatch(/inspect\(\s*['"]operator['"]\s*,\s*operatorResult\s*\)/);
  });

  it('filters Boolean to drop null results (no false-positive alerts)', () => {
    expect(src).toMatch(/\.filter\(\s*Boolean\s*\)/);
  });
});

describe('PR #457 Y-H13 — fallback admin-channel alert on partial fail', () => {
  it('fires throttledTelegramAlert only when failures.length > 0', () => {
    expect(src).toMatch(/if\s*\(\s*failures\.length\s*>\s*0\s*\)/);
  });

  it('uses stable dedup key + admin channel + critical severity', () => {
    expect(src).toMatch(/key:\s*['"]refund-telegram-partial-fail['"]/);
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
    expect(src).toMatch(/severity:\s*['"]critical['"]/);
  });

  it('alert payload includes bookingRef + refundUSD + the failing channel list (recoverable diagnostics)', () => {
    const alertIdx = src.indexOf("'refund-telegram-partial-fail'");
    expect(alertIdx).toBeGreaterThan(-1);
    const block = src.slice(alertIdx, alertIdx + 2500);
    expect(block).toMatch(/bookingRef/);
    expect(block).toMatch(/refundUSD/);
    expect(block).toMatch(/failures\.map/);
  });

  it('alert is fire-and-forget (no await on throttledTelegramAlert)', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\s*\{[\s\S]*?\}\s*\)\.catch\(/);
  });
});

describe('PR #457 Y-H13 — original notify trio still wired correctly', () => {
  it('still calls all 3 channels with the right payloads', () => {
    expect(src).toMatch(/notify\(\s*['"]booking['"]\s*,\s*refundMsg/);
    expect(src).toMatch(/notify\(\s*['"]dispatch['"]\s*,\s*dispatchMsg/);
    expect(src).toMatch(/notifyOperator\(\s*['"]refund['"]\s*,\s*operatorMsg/);
  });

  it('notifyOperator catch returns {ok:false} so allSettled inspection sees it', () => {
    // Previously the .catch logged + returned undefined → inspect() saw
    // {ok:undefined} and passed silently. Now it returns a result shape
    // that inspect() can recognize as a failure.
    expect(src).toMatch(/notifyOperator\(\s*['"]refund['"]\s*,[\s\S]*?\.catch\(\s*\(err\)\s*=>\s*\{[\s\S]*?return\s*\{\s*ok:\s*false/);
  });
});
