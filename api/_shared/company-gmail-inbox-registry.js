export const COMPANY_GMAIL_ACCOUNT = 'cocotripkr@gmail.com';
export const COMPANY_GMAIL_STATE_ID = 'company_gmail';
export const SECONDARY_GMAIL_ACCOUNT = '2001leety@gmail.com';
export const SECONDARY_GMAIL_STATE_ID = 'secondary_gmail';
export const SECONDARY_GMAIL_LABEL_NAME = 'CocoTrip/업무문의';

function value(env, prefix, key) { return typeof env[prefix + key] === 'string' ? env[prefix + key].trim() : ''; }
function safeTime(input) { return Number.isSafeInteger(input) && input > 0; }

function fixedInboxConfig({ env, nowMs, prefix, accountId, stateId, labelId = 'INBOX', replySupported }) {
  const productionOnly = env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== 'production';
  const enabled = value(env, prefix, 'ENABLED') === 'true' && !productionOnly;
  const required = ['EMAIL', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'CAPTURE_START_AT', 'RETENTION_DAYS'];
  if (prefix === 'SECONDARY_GMAIL_INBOX_') required.push('LABEL_ID');
  const missing = required.filter(key => !value(env, prefix, key)).map(key => prefix + key);
  const start = value(env, prefix, 'CAPTURE_START_AT');
  const parsedStart = Date.parse(start);
  const validStart = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(start)
    && safeTime(parsedStart) && parsedStart <= nowMs
    && new Date(parsedStart).toISOString() === start.replace(/(?<!\.\d{3})Z$/, '.000Z');
  const retention = value(env, prefix, 'RETENTION_DAYS');
  const retentionDays = /^[1-9][0-9]?$/.test(retention) && Number(retention) <= 90 ? Number(retention) : null;
  const configuredLabelId = prefix === 'SECONDARY_GMAIL_INBOX_' ? value(env, prefix, 'LABEL_ID') : labelId;
  // Gmail system labels (INBOX, SENT, ALL_MAIL) must never authorize a personal mailbox scan.
  const validLabelId = prefix !== 'SECONDARY_GMAIL_INBOX_' || (typeof configuredLabelId === 'string'
    && /^Label_[A-Za-z0-9_-]{1,122}$/.test(configuredLabelId));
  let reason = null;
  if (productionOnly) reason = 'PRODUCTION_ONLY';
  else if (!enabled) reason = 'DISABLED';
  else if (missing.length) reason = 'CONFIGURATION_REQUIRED';
  else if (value(env, prefix, 'EMAIL').toLowerCase() !== accountId) reason = 'COMPANY_ACCOUNT_REQUIRED';
  else if (!validStart) reason = 'CAPTURE_START_INVALID';
  else if (!retentionDays) reason = 'RETENTION_INVALID';
  else if (!validLabelId) reason = 'WORK_LABEL_REQUIRED';
  return { enabled, ready: enabled && !reason, status: !enabled ? 'disabled' : reason ? 'not_configured' : 'ready',
    reason, channel: 'email', accountId, stateId, envPrefix: prefix, labelId: validLabelId ? configuredLabelId : null, replySupported,
    captureStartAtMs: validStart ? parsedStart : null, retentionDays, missing };
}

/** Safe, credential-free declarations for the two fixed company inboxes. */
export function readCompanyGmailInboxConfig(env = process.env, nowMs = Date.now()) {
  return fixedInboxConfig({ env, nowMs, prefix: 'COMPANY_GMAIL_INBOX_', accountId: COMPANY_GMAIL_ACCOUNT,
    stateId: COMPANY_GMAIL_STATE_ID, replySupported: true });
}

/** The secondary account has no reply path and always requires the dedicated Gmail label. */
export function readSecondaryGmailInboxConfig(env = process.env, nowMs = Date.now()) {
  return fixedInboxConfig({ env, nowMs, prefix: 'SECONDARY_GMAIL_INBOX_', accountId: SECONDARY_GMAIL_ACCOUNT,
    stateId: SECONDARY_GMAIL_STATE_ID, replySupported: false });
}

export function readCompanyGmailInboxConfigs(env = process.env, nowMs = Date.now()) {
  return { email: readCompanyGmailInboxConfig(env, nowMs), secondaryEmail: readSecondaryGmailInboxConfig(env, nowMs) };
}

/** Never infer a Gmail mailbox from a message-provided address. */
export function companyGmailInboxConfigForAccount(configs, accountId) {
  const candidates = [configs?.email, configs?.secondaryEmail];
  return candidates.find(config => config?.accountId === accountId) || null;
}
