import { readWhatsAppInboxConfig } from './whatsapp-inbox.js';
import { prepareApprovedExternalInboxReply } from './external-inbox-reply-policy.js';
import { buildWhatsAppReplyPayload, normalizeWhatsAppSendReceipt } from './whatsapp-reply-payload.js';

const PREFIX = 'WHATSAPP_REPLY_';
const GRAPH_VERSION = 'v26.0';
const MAX_JSON_BYTES = 32 * 1024;
const ATTEMPT = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const value = (env, suffix) => typeof env[PREFIX + suffix] === 'string' ? env[PREFIX + suffix] : '';
const tokenValid = input => typeof input === 'string' && /^[A-Za-z0-9._~-]{16,4096}$/.test(input);
const time = input => Number.isSafeInteger(input) && input > 0 && input <= 8_640_000_000_000_000;
const unknown = () => ({ status: 'outcome_unknown' });
const notAttempted = () => ({ status: 'failed_pre_send', preSendVerified: true });

/** Configuration presence only, not a claim of Meta onboarding or token validity. */
export function readWhatsAppReplyConfig(env = {}, inboxConfig = null) {
  const enabled = env.VERCEL_ENV === 'production' && value(env, 'ENABLED') === 'true';
  const inboxReady = inboxConfig?.ready === true && inboxConfig.enabled === true
    && inboxConfig.privacyMode === 'explicit_sessions_v1'
    && typeof inboxConfig.accountId === 'string' && /^\d{1,64}$/.test(inboxConfig.accountId);
  const replyEnabled = enabled && inboxReady;
  const requestedSend = value(env, 'SEND_ENABLED') === 'true';
  const missing = tokenValid(value(env, 'ACCESS_TOKEN')) ? [] : [PREFIX + 'ACCESS_TOKEN'];
  const dispatchEnabled = replyEnabled && requestedSend && missing.length === 0;
  const reason = !enabled ? 'REPLY_DISABLED' : !inboxReady ? 'INBOX_CONNECTION_REQUIRED'
    : !requestedSend ? 'DISPATCH_DISABLED' : missing.length ? 'SENDER_CONFIGURATION_REQUIRED' : null;
  return { enabled, replyEnabled, dispatchEnabled, accountId: inboxReady ? inboxConfig.accountId : '', reason, missing };
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
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('RESPONSE_INVALID'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Only the durable, authenticated human-approval workflow may invoke this adapter. */
export function createWhatsAppReplySender({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return async ({ envelope, text, attemptId, authorizationExpiresAtMs, signal } = {}) => {
    let attempted = false;
    let timer;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    try {
      const startedAtMs = now();
      const config = readWhatsAppReplyConfig(env, readWhatsAppInboxConfig(env, startedAtMs));
      if (!time(startedAtMs) || !config.dispatchEnabled || !signal || signal.aborted
        || typeof fetchImpl !== 'function' || typeof signal.addEventListener !== 'function'
        || !time(authorizationExpiresAtMs) || authorizationExpiresAtMs <= startedAtMs
        || authorizationExpiresAtMs > startedAtMs + 300_000
        || typeof attemptId !== 'string' || !ATTEMPT.test(attemptId)
        || envelope?.channel !== 'whatsapp' || envelope.accountId !== config.accountId) return notAttempted();
      // Content/session check is not approval; authority comes from the consumed server ledger.
      const eligible = prepareApprovedExternalInboxReply({ envelope, actorUid: 'whatsapp-reply-adapter',
        flags: { replyEnabled: true }, humanApproved: false, nowMs: startedAtMs,
        request: { messageId: envelope.messageId, channel: 'whatsapp', expectedSourceAtMs: envelope.sourceAtMs, key: attemptId, text } });
      if (eligible.code !== 'HUMAN_APPROVAL_REQUIRED') return notAttempted();
      const body = JSON.stringify(buildWhatsAppReplyPayload({ recipient: envelope.recipient,
        providerMessageId: envelope.providerMessageId, text }));
      signal.addEventListener('abort', onAbort, { once: true });
      const at = now();
      if (!time(at) || at < startedAtMs || at >= authorizationExpiresAtMs || signal.aborted) return notAttempted();
      timer = setTimeout(onAbort, Math.min(8000, authorizationExpiresAtMs - at));
      // No configurable hostname, redirect, template, attachment, automatic retry or client-supplied recipient.
      attempted = true;
      const response = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${config.accountId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${value(env, 'ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
        body, signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) return unknown();
      return normalizeWhatsAppSendReceipt({ httpStatus: response.status, data: await limitedJson(response),
        expectedRecipient: envelope.recipient });
    } catch { return attempted ? unknown() : notAttempted(); }
    finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
  };
}
