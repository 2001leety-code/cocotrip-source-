/**
 * PayPal bookings — test / manual-payment signals (2026-10-23, admin PayPal refund).
 *
 * Two different questions, kept apart on purpose:
 *   - hasExplicitTestSignal: "is this a test booking?" — ONLY explicit signals (sandbox environment,
 *     admin-bypass payment, TEST-/ADMIN-BYPASS- prefixes). Used for the admin list's test badge/filter.
 *   - isAutoRefundBlocked: "may the admin API refund it through PayPal?" — the test signals OR a payment that
 *     was never verified by the capture endpoint (`paymentVerified !== true`). Normal bookings confirmed by the
 *     manual/webhook flow have no `paymentVerified` (booking-confirm.js), so this must NOT feed the test badge.
 * Pure functions, no I/O.
 */
const TEST_PREFIX = /^(ADMIN-BYPASS-|TEST-)/;

export function hasExplicitTestSignal(id, b) {
  const doc = b || {};
  return doc.paypalEnvironment === 'sandbox'
    || doc.paymentMethod === 'admin-bypass'
    || TEST_PREFIX.test(String(doc.captureID || ''))
    || TEST_PREFIX.test(String(id || ''));
}

export function isAutoRefundBlocked(id, b) {
  return hasExplicitTestSignal(id, b) || (b || {}).paymentVerified !== true;
}
