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

const src = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);

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
  it('capture catch block releases the coupon (isUsed=false)', () => {
    // Find the capture-error catch block and verify it touches couponLockRef.
    const captureIdx = src.indexOf('catch (captureErr)');
    expect(captureIdx).toBeGreaterThan(-1);
    const section = src.slice(captureIdx, captureIdx + 1500);
    expect(section).toMatch(/couponLockRef[\s\S]*?isUsed:\s*false/);
  });
});

describe('PR #427 CY4 — coupon-fail releases the order lock so the user can retry', () => {
  it('coupon catch block deletes the used_paypal_orders lock', () => {
    const couponCatchIdx = src.indexOf('catch (couponErr)');
    expect(couponCatchIdx).toBeGreaterThan(-1);
    const section = src.slice(couponCatchIdx, couponCatchIdx + 1500);
    expect(section).toMatch(/lockRef\.delete\(\)/);
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
