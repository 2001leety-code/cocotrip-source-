/** Server configuration only. Never infer this policy from a request or recipient. */
export function isPreviewEmailSuppressed(env = process.env) {
  return env.VERCEL_ENV === 'preview' && env.PREVIEW_EMAIL_SUPPRESS === 'true';
}

/** A non-delivery receipt, deliberately without provider acceptance/message IDs. */
export function suppressedEmailReceipt() {
  return { status: 'suppressed', reason: 'preview_policy', delivery: 'not_attempted', suppressed: true, sent: false, retryable: false };
}

export function isEmailSuppressed(receipt) {
  return Boolean(receipt && receipt.status === 'suppressed' && receipt.suppressed === true
    && receipt.delivery === 'not_attempted' && receipt.reason === 'preview_policy');
}
