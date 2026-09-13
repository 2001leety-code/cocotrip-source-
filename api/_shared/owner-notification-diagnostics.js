const CODES = new Set([
  'DISABLED', 'PRODUCTION_REQUIRED', 'CONFIGURATION_REQUIRED', 'OWNER_DEVICE_REQUIRED',
  'INITIALIZED', 'BUSY', 'CONFIGURATION_CHANGED', 'CONTROL_INVALID', 'CURSOR_INVALID',
  'CHECKED', 'PARTIAL_SOURCE_FAILURE', 'OWNER_SWEEP_FAILED',
  'RECONNECT_NOT_AUTHORIZED', 'RECONNECT_KEYS_INVALID', 'RECONNECT_CONTROL_MISMATCH',
  'RECONNECT_HISTORY_REQUIRES_REVIEW', 'RECONNECT_UNAVAILABLE', 'DEVICE_RECONNECTED',
]);
const PHASES = new Set([
  'CONFIGURATION', 'SERVICES', 'INBOX_CONFIGURATION', 'DEVICE', 'CONTROL', 'SOURCES', 'DELIVERY', 'CLEANUP',
  'DEVICE_RECONNECT',
]);
const ISSUES = new Set([
  'OWNER_UID_INVALID', 'OWNER_SUBSCRIPTION_INVALID', 'ADMIN_EMAIL_MISSING', 'LANGUAGE_INVALID',
  'RETENTION_INVALID', 'CURSOR_SECRET_INVALID', 'VAPID_PUBLIC_KEY_INVALID', 'VAPID_PRIVATE_KEY_INVALID',
  'VAPID_PUBLIC_KEY_MISMATCH', 'VAPID_SUBJECT_INVALID',
]);

/** Log projection, not a spread of task/config/SDK objects. All output is fixed vocabulary. */
export function ownerSweepDiagnostic(result = {}) {
  return {
    code: CODES.has(result?.code) ? result.code : 'UNKNOWN',
    phase: PHASES.has(result?.phase) ? result.phase : 'UNKNOWN',
    issues: Array.isArray(result?.issues) ? [...new Set(result.issues.filter((code) => ISSUES.has(code)))] : [],
  };
}
