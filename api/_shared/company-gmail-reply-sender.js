import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { COMPANY_GMAIL_ACCOUNT, readCompanyGmailInboxConfig } from './company-gmail-inbox.js';
import { prepareApprovedExternalInboxReply } from './external-inbox-reply-policy.js';

const PREFIX = 'COMPANY_GMAIL_REPLY_';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const PROFILE_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ATTEMPT = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_JSON_BYTES = 32 * 1024;
const value = (env, suffix) => typeof env[PREFIX + suffix] === 'string' ? env[PREFIX + suffix].trim() : '';
const plain = input => Boolean(input && typeof input === 'object' && !Array.isArray(input)
  && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
const unknown = () => ({ status: 'outcome_unknown' });
const notAttempted = () => ({ status: 'failed_pre_send', preSendVerified: true });

/** Presence is not OAuth verification. No credential values leave this object. */
export function readCompanyGmailReplyConfig(env = {}, inboxConfig = null) {
  const enabled = env.VERCEL_ENV === 'production' && value(env, 'ENABLED') === 'true';
  const accountValid = value(env, 'EMAIL').toLowerCase() === COMPANY_GMAIL_ACCOUNT;
  const inboxReady = inboxConfig?.ready === true && inboxConfig.accountId === COMPANY_GMAIL_ACCOUNT;
  const replyEnabled = enabled && accountValid && inboxReady;
  const missing = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'].filter(name => !value(env, name))
    .map(name => PREFIX + name);
  const requestedSend = value(env, 'SEND_ENABLED') === 'true';
  const dispatchEnabled = replyEnabled && requestedSend && missing.length === 0;
  const reason = !enabled ? 'REPLY_DISABLED' : !accountValid ? 'COMPANY_ACCOUNT_REQUIRED'
    : !inboxReady ? 'INBOX_CONNECTION_REQUIRED' : !requestedSend ? 'DISPATCH_DISABLED'
      : missing.length ? 'SENDER_CONFIGURATION_REQUIRED' : null;
  return { enabled, replyEnabled, dispatchEnabled, accountId: COMPANY_GMAIL_ACCOUNT, reason, missing };
}

/** Called only for the fixed Gmail send endpoint; acceptance is NOT recipient delivery. */
export function normalizeGmailSendReceipt({ httpStatus, data, expectedThreadId } = {}) {
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300 || !plain(data)
    || typeof expectedThreadId !== 'string' || !ID.test(expectedThreadId)
    || typeof data.id !== 'string' || !ID.test(data.id)
    || typeof data.threadId !== 'string' || !ID.test(data.threadId) || data.threadId !== expectedThreadId) return unknown();
  return { status: 'provider_accepted', receiptVerified: true, providerMessageId: data.id };
}

function eligible(envelope, text, attemptId, nowMs) {
  if (!plain(envelope) || envelope.channel !== 'email' || envelope.accountId !== COMPANY_GMAIL_ACCOUNT
    || typeof attemptId !== 'string' || !ATTEMPT.test(attemptId)) return false;
  // This is an additional content check, NOT approval. Only the workflow may call this adapter.
  const check = prepareApprovedExternalInboxReply({ envelope, actorUid: 'company-gmail-adapter', nowMs,
    humanApproved: false, flags: { replyEnabled: true }, request: { messageId: envelope.messageId,
      channel: 'email', expectedSourceAtMs: envelope.sourceAtMs, text, key: attemptId } });
  return check.code === 'HUMAN_APPROVAL_REQUIRED';
}

export async function buildCompanyGmailReplyRaw({ envelope, text, attemptId, nowMs }) {
  if (!eligible(envelope, text, attemptId, nowMs)) throw new Error('REPLY_CONTENT_INVALID');
  const email = envelope.policy.email;
  const references = [...email.references];
  if (references[references.length - 1] !== email.rfcMessageId) references.push(email.rfcMessageId);
  // No HTML, attachment, file path, URL loader, arbitrary From/To or CC/BCC from the browser.
  const message = new MailComposer({
    from: COMPANY_GMAIL_ACCOUNT, to: envelope.recipient, subject: email.subject, text,
    inReplyTo: email.rfcMessageId, references, date: new Date(nowMs),
    messageId: `<cocotrip-${attemptId}@cocotripkr.com>`,
    disableFileAccess: true, disableUrlAccess: true, newline: 'windows',
  }).compile();
  const raw = await new Promise((resolve, reject) => message.build((error, result) => error ? reject(error) : resolve(result)));
  if (!Buffer.isBuffer(raw) || raw.length > 64 * 1024) throw new Error('REPLY_CONTENT_INVALID');
  return raw.toString('base64url');
}

async function limitedJson(response) {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES)) throw new Error('RESPONSE_INVALID');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('RESPONSE_INVALID');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('RESPONSE_INVALID'); }
      chunks.push(Buffer.from(result.value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function exactScopes(scope) {
  if (typeof scope !== 'string') return false;
  const scopes = scope.trim().split(/\s+/);
  return scopes.length === 2 && new Set(scopes).size === 2 && scopes.includes(SEND_SCOPE) && scopes.includes(PROFILE_SCOPE);
}

/** Separate sender OAuth client; never expands/reuses the readonly receiver credential. */
export function createCompanyGmailSender({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return async ({ envelope, text, attemptId, authorizationExpiresAtMs, signal } = {}) => {
    let attempted = false;
    try {
      const startedAtMs = now();
      const config = readCompanyGmailReplyConfig(env, readCompanyGmailInboxConfig(env, startedAtMs));
      if (!config.dispatchEnabled || !signal || signal.aborted || typeof fetchImpl !== 'function'
        || !Number.isSafeInteger(authorizationExpiresAtMs) || authorizationExpiresAtMs <= startedAtMs
        || authorizationExpiresAtMs > startedAtMs + 300_000 || !eligible(envelope, text, attemptId, startedAtMs)) return notAttempted();
      const raw = await buildCompanyGmailReplyRaw({ envelope, text, attemptId, nowMs: startedAtMs });
      const request = (url, options) => fetchImpl(url, { ...options, signal, redirect: 'error',
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      const tokenResponse = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: value(env, 'CLIENT_ID'), client_secret: value(env, 'CLIENT_SECRET'),
          refresh_token: value(env, 'REFRESH_TOKEN'), grant_type: 'refresh_token' }).toString() });
      if (!tokenResponse.ok) return notAttempted();
      const token = await limitedJson(tokenResponse);
      if (!plain(token) || typeof token.access_token !== 'string' || token.access_token.length > 4096
        || !/^[A-Za-z0-9._~+/-]+$/.test(token.access_token) || String(token.token_type).toLowerCase() !== 'bearer'
        || !Number.isFinite(token.expires_in) || token.expires_in < 30 || !exactScopes(token.scope)) return notAttempted();
      const authorization = `Bearer ${token.access_token}`;
      const profileResponse = await request(PROFILE_URL, { method: 'GET', headers: { Authorization: authorization } });
      if (!profileResponse.ok) return notAttempted();
      const profile = await limitedJson(profileResponse);
      if (!plain(profile) || typeof profile.emailAddress !== 'string'
        || profile.emailAddress.toLowerCase() !== COMPANY_GMAIL_ACCOUNT) return notAttempted();
      const sendAtMs = now();
      if (!Number.isSafeInteger(sendAtMs) || sendAtMs < startedAtMs || sendAtMs >= authorizationExpiresAtMs
        || signal.aborted || !eligible(envelope, text, attemptId, sendAtMs)) return notAttempted();
      // Once invoked, even HTTP/network failure can be ambiguous. No automatic POST retry.
      attempted = true;
      const response = await request(SEND_URL, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw, threadId: envelope.policy.email.threadId }) });
      if (!response.ok) return unknown();
      return normalizeGmailSendReceipt({ httpStatus: response.status, data: await limitedJson(response),
        expectedThreadId: envelope.policy.email.threadId });
    } catch { return attempted ? unknown() : notAttempted(); }
  };
}
