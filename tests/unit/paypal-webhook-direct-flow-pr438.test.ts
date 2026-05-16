/**
 * PR #438 — Audit Y-H7 regression slot.
 *
 * Pre-fix: api/paypal-webhook.js only matched `PAYMENT.CAPTURE.COMPLETED`
 * events by parsing memo fields (custom_id / invoice_id / note_to_payee
 * / description) for our `CT-YYYYMMDD-XXX` bookingRef. The createPaypal-
 * Order endpoint does NOT set any of those, so every PayPal-direct
 * capture-completed webhook fired an "unmatched" operator alert. Real
 * bookings were fine (capturePaypalOrder already wrote `bookings/{orderID}`
 * synchronously) but operators got noise on every payment.
 *
 * The refund webhook was worse: it queried `bookings/{captureId}` (legacy
 * doc-id shape) and `pending_bookings.paypalTransactionId == captureId`
 * (admin-matched manual QR). It did NOT query `bookings.captureID == captureId`,
 * which is the field set by capturePaypalOrder. → PayPal-direct refunds
 * silent-unmatched. Worse: the update path then wrote
 * `bookings/{captureId}.set(..., merge: true)` which CREATED a new orphan
 * doc instead of updating the real one.
 *
 * Post-fix:
 *   - Capture handler: when memo extraction fails, fall back to
 *     `event.resource.supplementary_data.related_ids.order_id` and look
 *     up `bookings/{paypalOrderId}` directly. If found (already confirmed
 *     by capturePaypalOrder), log as 'processed' / 'already_confirmed_via
 *     _capture_endpoint' and ack — no alert.
 *   - Refund handler: in addition to existing lookups, try
 *     `bookings.where('captureID', '==', captureId)` for PayPal-direct.
 *     Track the actual matched doc ID and write the REFUNDED update there
 *     (not to bookings/{captureId} blindly).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/paypal-webhook.js'),
  'utf8',
);

describe('PR #438 Y-H7 — capture handler PayPal-direct fallback', () => {
  it('extractPaypalOrderId reads supplementary_data.related_ids.order_id', () => {
    expect(src).toMatch(/function\s+extractPaypalOrderId/);
    expect(src).toMatch(/supplementary_data[\s?.]*related_ids[\s?.]*order_id/);
  });

  it('CAPTURE.COMPLETED handler queries bookings/{paypalOrderId} on memo-miss path', () => {
    // The fallback must run BEFORE alertAdmin in the unmatched branch.
    const capturePos = src.indexOf("PAYMENT.CAPTURE.COMPLETED'");
    expect(capturePos).toBeGreaterThan(-1);
    const handlerBlock = src.slice(capturePos, capturePos + 6000);
    // The block must reference extractPaypalOrderId in the no-bookingRef branch
    expect(handlerBlock).toMatch(/extractPaypalOrderId\s*\(/);
    // And must call bookings.doc(...).get on the result
    expect(handlerBlock).toMatch(/collection\(['"]bookings['"]\)\.doc\(\s*paypalOrderId/);
  });

  it('successful PayPal-direct match logs as processed (not unmatched) and returns already_confirmed', () => {
    const capturePos = src.indexOf("PAYMENT.CAPTURE.COMPLETED'");
    const handlerBlock = src.slice(capturePos, capturePos + 6000);
    expect(handlerBlock).toMatch(/already_confirmed_via_capture_endpoint/);
    expect(handlerBlock).toMatch(/status:\s*['"]processed['"]/);
    expect(handlerBlock).toMatch(/status:\s*['"]already_confirmed['"]/);
  });
});

describe('PR #438 Y-H7 — refund handler captureID field lookup + safe update', () => {
  it('REFUNDED handler queries where("captureID", "==", captureId) — the missing PR #425 shape', () => {
    const refundPos = src.indexOf("PAYMENT.CAPTURE.REFUNDED'");
    expect(refundPos).toBeGreaterThan(-1);
    const handlerBlock = src.slice(refundPos, refundPos + 8000);
    expect(handlerBlock).toMatch(/where\(['"]captureID['"]\s*,\s*['"]==['"]\s*,\s*captureId\)/);
  });

  it('refund update writes to the matched doc id (bookingsDocId), not bookings/{captureId} blindly', () => {
    const refundPos = src.indexOf("PAYMENT.CAPTURE.REFUNDED'");
    const handlerBlock = src.slice(refundPos, refundPos + 8000);
    expect(handlerBlock).toMatch(/bookingsDocId/);
    expect(handlerBlock).toMatch(/if\s*\(\s*bookingsDocId\s*\)/);
    expect(handlerBlock).toMatch(/collection\(['"]bookings['"]\)\.doc\(\s*bookingsDocId\s*\)/);
  });

  it('regression guard: blind write to bookings/{captureId} is gone', () => {
    // The exact buggy line was:
    //   await adminDb.collection('bookings').doc(captureId).set(updates, { merge: true });
    // Replaced with bookingsDocId-aware variant.
    const refundPos = src.indexOf("PAYMENT.CAPTURE.REFUNDED'");
    const handlerBlock = src.slice(refundPos, refundPos + 8000);
    // The lookup at the top still uses bookings.doc(captureId).get() — that's fine.
    // The forbidden pattern is the BLIND .set on captureId (without prior existence check).
    expect(handlerBlock).not.toMatch(/collection\(['"]bookings['"]\)\.doc\(\s*captureId\s*\)\.set\(\s*updates/);
  });

  it('still alerts operator when truly no booking matches (defense in depth)', () => {
    const refundPos = src.indexOf("PAYMENT.CAPTURE.REFUNDED'");
    const handlerBlock = src.slice(refundPos, refundPos + 8000);
    expect(handlerBlock).toMatch(/capture_not_in_bookings/);
    expect(handlerBlock).toMatch(/alertAdmin\(/);
  });
});

describe('PR #438 Y-H7 — webhook acknowledges all matched events to PayPal', () => {
  it('every branch ends with res.end(...) to keep PayPal from retrying', () => {
    // Counting res.end calls in the handler is brittle but the structure
    // matters: each top-level branch should ack rather than leaving the
    // response open. Grep for "res.end" calls in the file body.
    const ends = (src.match(/res\.end\(/g) || []).length;
    expect(ends).toBeGreaterThan(5); // capture-success, capture-unmatched, capture-direct-match, refund-success, refund-unmatched, etc.
  });
});
