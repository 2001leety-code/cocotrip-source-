/**
 * PR #427 — Audit CY4 regression slot.
 *
 * Pre-fix: api/capturePaypalOrder.js marked the coupon as used AFTER the
 * PayPal capture call. Two concurrent flows with the same coupon could
 * both capture (charging the user's card twice with discount expectation),
 * then race on the mark-used step. The loser saw COUPON_ALREADY_USED and
 * an operator had to manually refund the lost discount. The
 * `bookings/{orderID}.couponWarning` Firestore field was the only signal.
 *
 * Post-fix: coupon is locked atomically BEFORE the capture call. If the
 * coupon is already used by another orderID, we bail with 409 and release
 * the used_paypal_orders lock so the user can retry without the coupon.
 * If the capture itself fails, we release the coupon so the discount
 * isn't burned. After capture success, the pendingCapture flag is cleared.
 *
 * These are static-shape assertions over the source — a full integration
 * test would need a Firestore emulator + a fake PayPal sandbox. The
 * shape checks catch the original bug pattern AND any future refactor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyCaptureResponse, discardAttempt } from '../../api/_shared/payment-fulfillment-recovery.js';

const src = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
// 2026-10-10 recovery rewrite: handler branches the capture result by reconciled.state — slice each branch.
const notCapturedIdx = src.indexOf("reconciled.state === 'not_captured'");
const unknownIdx = src.indexOf("reconciled.state !== 'captured'", notCapturedIdx);
const notCapturedBranch = src.slice(notCapturedIdx, unknownIdx);
const unknownBranch = src.slice(unknownIdx, src.indexOf('pendingCapture: false', unknownIdx));

// Fake Firestore: one attempt doc, runTransaction runs the callback against it.
function fakeAttempt(lock: Record<string, unknown>) {
  const state = { deleted: false };
  const ref = {};
  const tx = {
    get: async () => ({ exists: true, data: () => lock }),
    delete: () => { state.deleted = true; },
  };
  const db = { runTransaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) };
  return { attempt: { db, ref, claimToken: 't1' }, state };
}

describe('PR #427 CY4 — coupon is pre-locked before capture', () => {
  it('coupon transaction runs BEFORE the PayPal capture fetch', () => {
    const couponIdx = src.indexOf('couponLockRef');
    const captureIdx = src.indexOf('/v2/checkout/orders/');
    expect(couponIdx, 'couponLockRef must be declared').toBeGreaterThan(-1);
    expect(captureIdx, 'capture fetch must exist').toBeGreaterThan(-1);
    expect(couponIdx).toBeLessThan(captureIdx);
  });

  it('coupon lock uses runTransaction (race-safe)', () => {
    // Find the section between couponLockRef and the capture fetch and
    // confirm a runTransaction call lives there.
    const couponIdx = src.indexOf('couponLockRef');
    const captureIdx = src.indexOf('/v2/checkout/orders/');
    const section = src.slice(couponIdx, captureIdx);
    expect(section).toMatch(/runTransaction\s*\(/);
  });

  it('coupon lock checks isUsed === true and rejects with COUPON_ALREADY_USED', () => {
    expect(src).toMatch(/data\.isUsed\s*===\s*true/);
    expect(src).toMatch(/COUPON_ALREADY_USED/);
  });

  it('coupon lock sets pendingCapture: true for in-flight state', () => {
    expect(src).toMatch(/pendingCapture\s*:\s*true/);
  });

  it('post-capture clears the pendingCapture flag', () => {
    // After capture success, pendingCapture should flip to false.
    expect(src).toMatch(/pendingCapture\s*:\s*false/);
  });
});

describe('PR #427 CY4 — capture failure rolls back the coupon', () => {
  // 2026-10-10 recovery rewrite: `catch (captureErr)` always releases coupon → release ONLY on provider-proven
  //   nonpayment (reconciled.state === 'not_captured'); UNKNOWN (timeout/5xx/unparsable) KEEPS the coupon.
  it('provider-proven nonpayment releases the coupon (isUsed=false) and the order lock, then answers 409', () => {
    expect(notCapturedIdx).toBeGreaterThan(-1);
    expect(unknownIdx).toBeGreaterThan(notCapturedIdx);
    expect(notCapturedBranch).toMatch(/couponLockRef\.update\(\s*\{[^}]*isUsed:\s*false/);
    expect(notCapturedBranch).toMatch(/discardAttempt\(attempt\)/);
    expect(notCapturedBranch).toMatch(/res\.writeHead\(\s*409/);
  });

  it('UNKNOWN capture result KEEPS the coupon and the order lock and answers 202 (no double charge / coupon reuse)', () => {
    expect(unknownBranch).not.toMatch(/isUsed:\s*false/);
    expect(unknownBranch).not.toMatch(/discardAttempt\(/);
    expect(unknownBranch).toMatch(/res\.writeHead\(\s*202/);
  });

  it('what counts as nonpayment vs unknown (behavior of the classifier that drives the release)', () => {
    // definitive PayPal 422 decline → nonpayment (release)
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } }, 'O1').state).toBe('not_captured');
    // timeout/5xx/unparsable/generic 4xx → unknown (keep)
    expect(classifyCaptureResponse({ status: 503, body: { name: 'SERVICE_UNAVAILABLE' } }, 'O1').state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 200, body: null, parseError: 'bad json' }, 'O1').state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 429, body: { name: 'RATE_LIMIT' } }, 'O1').state).toBe('unknown');
  });
});

describe('PR #427 CY4 — coupon-fail releases the order lock so the user can retry', () => {
  it('coupon catch block deletes the used_paypal_orders lock', () => {
    const couponCatchIdx = src.indexOf('catch (couponErr)');
    expect(couponCatchIdx).toBeGreaterThan(-1);
    const section = src.slice(couponCatchIdx, couponCatchIdx + 1500);
    // 2026-10-10 recovery rewrite: `lockRef.delete()` → discardAttempt(attempt) (transactional delete of used_paypal_orders/{orderID})
    expect(section).toMatch(/discardAttempt\(attempt\)/);
  });

  it('discardAttempt deletes the order lock on a fresh claim, but never one whose capture is verified/durable', async () => {
    const fresh = fakeAttempt({ claimToken: 't1' });
    await discardAttempt(fresh.attempt);
    expect(fresh.state.deleted).toBe(true);
    const paid = fakeAttempt({ claimToken: 't1', captureVerified: { amountValue: '10.00' } });
    await expect(discardAttempt(paid.attempt)).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(paid.state.deleted).toBe(false);
    const durable = fakeAttempt({ claimToken: 't1', bookingDurable: true });
    await expect(discardAttempt(durable.attempt)).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(durable.state.deleted).toBe(false);
  });

  it('coupon catch block returns 409 (not 500) so the client knows to retry', () => {
    const couponCatchIdx = src.indexOf('catch (couponErr)');
    const section = src.slice(couponCatchIdx, couponCatchIdx + 1500);
    expect(section).toMatch(/res\.writeHead\(\s*409/);
  });
});

describe('PR #427 CY4 — post-capture cleanup is removed (no operator-manual-refund warning)', () => {
  it('does NOT write couponWarning to bookings doc (legacy post-capture path)', () => {
    // The old code persisted `couponWarning` when the post-capture mark
    // failed; that path is dead because we now pre-lock. Re-introducing it
    // implies we've regressed back to post-capture marking.
    expect(src).not.toMatch(/couponWarning\s*:\s*code/);
  });

  it('does NOT call notifyOperator with "coupon-warning" channel (legacy alert)', () => {
    expect(src).not.toMatch(/notifyOperator\(\s*['"]coupon-warning['"]/);
  });

  it('still alerts the operator about coupon races via "coupon-race" channel', () => {
    // The new pre-lock path uses a different (lighter) alert because the
    // capture never happened — no manual refund required.
    expect(src).toMatch(/notifyOperator\(\s*['"]coupon-race['"]/);
  });
});
