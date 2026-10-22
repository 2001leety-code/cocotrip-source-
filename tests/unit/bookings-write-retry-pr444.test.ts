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
 * 2026-10-10 recovery rewrite: the inline for-loop in capturePaypalOrder.js is now
 * withBackoff() in api/_shared/payment-fulfillment-recovery.js (tested by behavior
 * below); the handler-side wiring is still asserted on source shape so the
 * silent-fail pattern can't regress.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withBackoff } from '../../api/_shared/payment-fulfillment-recovery.js';

const src = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
// The write-failure branch: from `if (!bookingWriteOk)` up to the slot-confirm stage marker that follows it.
const failIdx = src.indexOf('if (!bookingWriteOk)');
const failBlock = src.slice(failIdx, src.indexOf('markStage', failIdx));

// Run timers instantly but record the requested delays.
function instantTimers(sleeps: number[] = []) {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    sleeps.push(ms as number);
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
  return sleeps;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('PR #444 Y-H14 — bookings doc write retry loop', () => {
  it('payload is hoisted to a const (so retries reuse the same object)', () => {
    expect(src).toMatch(/const\s+bookingDocPayload\s*=\s*\{/);
  });

  // 2026-10-10 recovery rewrite: inline BOOKING_WRITE_BACKOFF_MS = [200,500,1000] → withBackoff() default delays
  it('backoff schedule [200, 500, 1000] ms (behavior: 3 attempts, sleeps 200 then 500 between them)', async () => {
    const sleeps = instantTimers();
    const task = vi.fn().mockRejectedValue(new Error('firestore brownout'));
    const r = await withBackoff(task);
    expect(task).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([200, 500]); // schedule [200,500,1000]; the last delay is never slept after the final attempt
    expect(r.ok).toBe(false);
  });

  // 2026-10-10 recovery rewrite: for(attempt < BOOKING_WRITE_BACKOFF_MS.length) loop → withBackoff() retries
  it('retries up to 3 attempts and stops as soon as one attempt passes', async () => {
    instantTimers();
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValueOnce('written');
    const r = await withBackoff(task);
    expect(task).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ ok: true, value: 'written' });
  });

  // 2026-10-10 recovery rewrite: `let bookingWriteOk/lastBookingErr` loop vars → `persisted = await withBackoff(...)` result
  it('tracks write ok + last error across attempts, and the handler wraps the bookings write in withBackoff', async () => {
    expect(src).toMatch(/const\s+persisted\s*=\s*await\s+withBackoff\(\s*\(\)\s*=>\s*persistBookingsAtomically\(/);
    expect(src).toMatch(/const\s+bookingWriteOk\s*=\s*persisted\.ok/);
    expect(src).toMatch(/const\s+lastBookingErr\s*=\s*persisted\.error/);
    instantTimers();
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('last'));
    const r = await withBackoff(task);
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe('last');
  });
});

describe('PR #444 Y-H14 — critical operator alert on total failure', () => {
  it('imports throttledTelegramAlert', () => {
    expect(src).toMatch(/import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('alert fires only when all retries failed (if (!bookingWriteOk))', () => {
    expect(src).toMatch(/if\s*\(\s*!\s*bookingWriteOk\s*\)/);
    expect(failIdx).toBeGreaterThan(-1);
    expect(failBlock).toMatch(/throttledTelegramAlert\(/);
  });

  // 2026-10-10 recovery rewrite: one global key 'bookings-doc-write-fail' → per-order key `bookings-doc-write-fail-${orderID}`
  it('alert uses stable dedup key + critical severity + admin channel', () => {
    expect(failBlock).toMatch(/key:\s*`bookings-doc-write-fail-\$\{orderID\}`/);
    expect(failBlock).toMatch(/severity:\s*['"]critical['"]/);
    expect(failBlock).toMatch(/channel:\s*['"]admin['"]/);
  });

  it('alert message includes orderID + captureID for manual recovery', () => {
    // The block matters more than the exact string — operator needs both IDs
    // to use admin-replay-booking-notifications.
    expect(failBlock).toMatch(/orderID/);
    expect(failBlock).toMatch(/captureID/);
    expect(failBlock).toMatch(/admin-replay-booking-notifications/);
  });

  // 2026-10-10 recovery rewrite: fire-and-forget `.catch` → `await ... .catch(() => {})` (awaited, but an alert failure can never throw)
  it('alert can never break the capture path (swallowing .catch on the alert)', () => {
    expect(failBlock).toMatch(/throttledTelegramAlert\(\s*\{[\s\S]*?\}\s*\)\.catch\(/);
  });

  // 2026-10-10 recovery rewrite: "carry on toward 200" → return 202 PAYMENT_RECOVERY_PENDING before slot commit
  it('on final failure answers 202 (not confirmed) before any slot commit / promo / processor step', () => {
    expect(failBlock).toMatch(/res\.writeHead\(\s*202\b/);
    expect(failBlock).toMatch(/pendingPaymentResponse\(/);
    expect(failBlock).toMatch(/return res\.end\(/);
    expect(failBlock).not.toMatch(/confirmSlotLock|triggerBookingProcessor|incrementGlobalPromoUsage/);
    expect(src.indexOf('confirmSlotLock(', failIdx)).toBeGreaterThan(failIdx + failBlock.length);
  });
});

describe('PR #444 Y-H14 — payment is NOT rolled back on bookings-write failure', () => {
  it('no refundPaypalCapture call in the bookingWriteOk branch (payment stays captured)', () => {
    // The PROMO_LIMIT_EXCEEDED branch (PR #434, Y-H11) does call refund — that's
    // separate. Make sure the bookings-write-fail branch doesn't accidentally do
    // the same: it would refund a user whose booking just needs operator recovery.
    const promoBranchIdx = src.indexOf('PROMO_LIMIT_EXCEEDED');
    expect(failIdx).toBeGreaterThan(-1);
    expect(promoBranchIdx).toBeGreaterThan(-1);
    // The 1500 chars after `if (!bookingWriteOk)` must NOT contain refundPaypalCapture
    // (only the promo branch should call it).
    expect(src.slice(failIdx, failIdx + 1500)).not.toMatch(/refundPaypalCapture\s*\(/);
    expect(failBlock).not.toMatch(/refundPaypalCapture\s*\(/);
  });
});

describe('PR #444 Y-H14 — regression guard: silent catch-only pattern is gone', () => {
  // 2026-10-10 recovery rewrite: log text 'bookings doc write failed' → 'mandatory booking persistence failed'
  it('the failure console.error and the operator alert live in the same block, log first', () => {
    expect(failBlock).toMatch(/console\.error\([^)]*mandatory booking persistence failed/);
    expect(failBlock).toMatch(/bookings-doc-write-fail/);
    expect(failBlock.indexOf('console.error')).toBeLessThan(failBlock.indexOf('throttledTelegramAlert('));
  });
});
