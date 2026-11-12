/** Preview outbound delivery is always disabled. Flags cannot opt out. Production/development behavior is unchanged. Suppression is neither delivery success nor retryable failure. */

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
  return e.VERCEL_ENV === 'preview';
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
