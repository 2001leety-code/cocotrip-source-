/**
 * Opt-in Preview suppression for outbound EMAIL, GOOGLE SHEETS writes and PUSH delivery.
 *
 * Suppression applies ONLY when BOTH conditions hold:
 *   env.VERCEL_ENV === 'preview' AND the channel flag === 'true'.
 * Channel flags: PREVIEW_EMAIL_SUPPRESS, PREVIEW_SHEETS_SUPPRESS, PREVIEW_PUSH_SUPPRESS,
 *   PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS (shared by the telegram and discord operator transports).
 * Production and development are never suppressed, even when a flag is 'true'.
 *
 * This is NOT fail-closed and NOT full app isolation. A missing flag means normal delivery.
 * A safe Preview test deployment must verify all required suppression flags itself and refuse to run tests if any is absent.
 * This flag check does not replace the separate database, runtime environment, OAuth, and caller checks; each must still be enforced independently.
 *
 * Every suppressed receipt carries status:'suppressed', suppressed:true, reason:'preview_policy', retryable:false.
 * Suppression is NOT success: callers must not treat it as delivered/written. Callers must also not treat it as an error or retry it.
 * Use isNotificationSuppressed(receipt) to detect it.
 *
 * pushBulkSuppressedReceipt keeps the existing aggregate shape (sent:0, total:0). Here total:0 means the subscription
 * lookup was skipped. It is not a real recipient count. null is intentionally not used because it would change the aggregate shape.
 */

const CHANNEL_FLAGS = {
  email: 'PREVIEW_EMAIL_SUPPRESS',
  sheets: 'PREVIEW_SHEETS_SUPPRESS',
  push: 'PREVIEW_PUSH_SUPPRESS',
  telegram: 'PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS',
  discord: 'PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS',
};

export const PREVIEW_SUPPRESSION_FLAGS = Object.freeze([...new Set(Object.values(CHANNEL_FLAGS))]);

export function isPreviewSuppressed(channel, env) {
  const e = env || process.env;
  const flag = CHANNEL_FLAGS[channel];
  if (!flag || !e) return false;
  return e.VERCEL_ENV === 'preview' && e[flag] === 'true';
}

export function isNotificationSuppressed(receipt) {
  return !!receipt && typeof receipt === 'object'
    && receipt.status === 'suppressed'
    && receipt.suppressed === true
    && receipt.reason === 'preview_policy'
    && receipt.retryable === false;
}

export function emailSuppressedReceipt() {
  return { status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', channel: 'email', delivery: 'not_attempted', sent: false };
}

export function sheetsSuppressedReceipt(operation) {
  return { status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', channel: 'sheets', operation, write: 'not_attempted' };
}

export function pushSuppressedReceipt() {
  return { ok: false, status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', channel: 'push', delivery: 'not_attempted', sent: false };
}

// Operator transports (telegram/discord). channel = logical notify channel when known, else the transport.
export function operatorSuppressedReceipt(transport, channel) {
  return { ok: false, status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', transport, channel: channel || transport, delivery: 'not_attempted', sent: false };
}

// total:0 = subscription lookup skipped (not a recipient count); shape unchanged from the existing aggregate.
export function pushBulkSuppressedReceipt() {
  return { status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', channel: 'push', delivery: 'not_attempted', sent: 0, total: 0, expired: 0, authFailed: 0, authFailedDeleted: 0 };
}
