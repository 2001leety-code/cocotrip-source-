/**
 * PR #444 — Audit Y-H14 regression slot.
 *
 * Pre-fix: api/capturePaypalOrder.js wrote bookings/{orderID} as a best-
 * effort try/catch. The catch just console.error'd:
 *
 *   try {
 *     await db.collection('bookings').doc(orderID).set({...}, {merge: true});
 *   } catch (bookingErr) {
 *     // 예약 레코드 저장 실패해도 결제는 통과 (booking-processor가 sheets에 기록)
 *     console.error('[capturePaypalOrder] bookings doc write failed:', bookingErr.message);
 *   }
 *
 * Failure mode: PayPal capture HAD succeeded (money taken). If the
 * bookings doc write failed (Firestore brownout, quota, network blip),
 * the user's my-bookings page showed nothing, cancel/modify/voucher all
 * 404'd. Operator only learned of it from a CS ticket hours later, by
 * which point the user was angry and demanding refund.
 *
 * Post-fix:
 *   - retry 3 times with exponential backoff (200/500/1000 ms)
 *   - on total failure: throttledTelegramAlert (severity='critical',
 *     key='bookings-doc-write-fail') so operator sees it immediately
 *   - alert payload includes orderID + captureID so operator can
 *     manually recover via /api/admin-replay-booking-notifications
 *   - payment is NOT rolled back — money was captured, the right move
 *     is to recover the booking, not refund
 *
 * This file asserts the source-code shape so the silent-fail pattern
 * can't regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);

describe('PR #444 Y-H14 — bookings doc write retry loop', () => {
  it('payload is hoisted to a const (so retries reuse the same object)', () => {
    expect(src).toMatch(/const\s+bookingDocPayload\s*=\s*\{/);
  });

  it('backoff schedule [200, 500, 1000] ms', () => {
    expect(src).toMatch(/BOOKING_WRITE_BACKOFF_MS\s*=\s*\[\s*200\s*,\s*500\s*,\s*1000\s*\]/);
  });

  it('retries up to BOOKING_WRITE_BACKOFF_MS.length attempts', () => {
    expect(src).toMatch(/for\s*\(\s*let\s+attempt\s*=\s*0\s*;\s*attempt\s*<\s*BOOKING_WRITE_BACKOFF_MS\.length/);
    expect(src).toMatch(/setTimeout\([^)]*BOOKING_WRITE_BACKOFF_MS\s*\[\s*attempt\s*\]/);
  });

  it('tracks bookingWriteOk + lastBookingErr across attempts', () => {
    expect(src).toMatch(/let\s+bookingWriteOk\s*=\s*false/);
    expect(src).toMatch(/let\s+lastBookingErr\s*=\s*null/);
    expect(src).toMatch(/bookingWriteOk\s*=\s*true/);
  });
});

describe('PR #444 Y-H14 — critical operator alert on total failure', () => {
  it('imports throttledTelegramAlert', () => {
    expect(src).toMatch(/import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('alert fires only when all retries failed (if (!bookingWriteOk))', () => {
    expect(src).toMatch(/if\s*\(\s*!\s*bookingWriteOk\s*\)/);
  });

  it('alert uses stable dedup key + critical severity + admin channel', () => {
    expect(src).toMatch(/key:\s*['"]bookings-doc-write-fail['"]/);
    expect(src).toMatch(/severity:\s*['"]critical['"]/);
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
  });

  it('alert message includes orderID + captureID for manual recovery', () => {
    // The block matters more than the exact string — operator needs both IDs
    // to use admin-replay-booking-notifications.
    const alertIdx = src.indexOf("'bookings-doc-write-fail'");
    expect(alertIdx).toBeGreaterThan(-1);
    const block = src.slice(alertIdx, alertIdx + 2500);
    expect(block).toMatch(/orderID/);
    expect(block).toMatch(/captureID/);
    expect(block).toMatch(/admin-replay-booking-notifications/);
  });

  it('alert is fire-and-forget (no await — capture path stays fast)', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\s*\{[\s\S]*?\}\s*\)\.catch\(/);
  });
});

describe('PR #444 Y-H14 — payment is NOT rolled back on bookings-write failure', () => {
  it('no refundPaypalCapture call in the bookingWriteOk branch (payment stays captured)', () => {
    // The PROMO_LIMIT_EXCEEDED branch (PR #434, Y-H11) does call refund — that's
    // separate. Make sure the bookings-write-fail branch doesn't accidentally do
    // the same: it would refund a user whose booking just needs operator recovery.
    const writeFailIdx = src.indexOf('if (!bookingWriteOk)');
    const promoBranchIdx = src.indexOf('PROMO_LIMIT_EXCEEDED');
    expect(writeFailIdx).toBeGreaterThan(-1);
    expect(promoBranchIdx).toBeGreaterThan(-1);
    // The 1500 chars after `if (!bookingWriteOk)` must NOT contain refundPaypalCapture
    // (only the promo branch should call it).
    const writeFailBlock = src.slice(writeFailIdx, writeFailIdx + 1500);
    expect(writeFailBlock).not.toMatch(/refundPaypalCapture\s*\(/);
  });
});

describe('PR #444 Y-H14 — regression guard: silent catch-only pattern is gone', () => {
  it('no remaining "bookings doc write failed" log without an alert in the same block', () => {
    // The original silent pattern was a single console.error in the catch.
    // We allow the per-attempt console.error inside the retry loop, but
    // the OUTER level must surface to operator via throttledTelegramAlert
    // — guard by checking that the bookings.set neighborhood references
    // both 'bookings-doc-write-fail' and console.error.
    expect(src).toMatch(/bookings doc write failed/);
    expect(src).toMatch(/bookings-doc-write-fail/);
  });
});
