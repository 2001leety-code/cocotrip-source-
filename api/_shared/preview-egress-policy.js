/** Server configuration only; branch-scoped Preview flags never affect production. */
export function isPreviewSheetsSuppressed(env = process.env) {
  return env.VERCEL_ENV === 'preview' && env.PREVIEW_SHEETS_SUPPRESS === 'true';
}

export function isPreviewPushSuppressed(env = process.env) {
  return env.VERCEL_ENV === 'preview' && env.PREVIEW_PUSH_SUPPRESS === 'true';
}

export function suppressedSheetsReceipt() {
  return { status: 'suppressed', reason: 'preview_policy', suppressed: true, write: 'not_attempted', appended: false, updated: false, retryable: false };
}

export function suppressedPushReceipt() {
  return { status: 'suppressed', reason: 'preview_policy', suppressed: true, delivery: 'not_attempted', sent: 0, total: 0, retryable: false };
}
