import { createHash } from 'node:crypto';
import { validateSupportSession } from './whatsapp-support-sessions.js';

export const EXTERNAL_INBOX_REPLY_POLICY_VERSION = 'external-inbox-reply.v1';
export const REPLY_APPROVAL_TTL_MS = 300_000;
export const REPLY_DELIVERY_STATUSES = Object.freeze([
  'not_sent', 'approved', 'sending', 'provider_accepted', 'delivered', 'read',
  'failed_pre_send', 'outcome_unknown', 'cancelled',
]);
const DAY_MS = 86_400_000;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REQUEST_KEYS = ['messageId', 'channel', 'text', 'expectedSourceAtMs', 'key'];
const APPROVAL_KEYS = ['policyVersion', 'key', 'bindingHash', 'actorHash', 'approvedAtMs', 'expiresAtMs', 'status'];
const headerControls = value => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const textControls = value => Array.from(value).some(char => {
  const code = char.charCodeAt(0);
  return (code < 32 && code !== 9 && code !== 10) || code === 127;
});
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const time = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const token = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max
  && value === value.trim() && !headerControls(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deny = (code, disposition = 'blocked') => ({ ok: false, code, disposition, sendAllowed: false });

// This is syntax validation, not a claim that the mailbox/domain belongs to a person.
function mailbox(value) {
  if (!token(value, 254) || /[\s<>,;:"\\]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(parts[0])
    || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return parts[1].includes('.') && parts[1] === parts[1].toLowerCase() && parts[1].split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function validateExternalInboxReplyRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS) || typeof request.messageId !== 'string' || typeof request.key !== 'string'
    || !HEX.test(request.messageId) || !UUID.test(request.key)
    || !['email', 'whatsapp'].includes(request.channel) || !time(request.expectedSourceAtMs)
    || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 4000
    || textControls(request.text)) return deny('REQUEST_INVALID');
  return { ok: true, code: 'REQUEST_VALID', sendAllowed: false };
}

function emailPolicy(envelope) {
  const email = envelope.policy.email;
  if (!plain(email) || email.contextVerified !== true) return deny('REPLY_CONTEXT_MISSING', 'draft_only');
  if (email.singleMailbox !== true || email.headerControls !== false || email.autoSubmitted !== false
    || email.listHeader !== false || email.noReply !== false || email.ambiguous !== false
    || !mailbox(envelope.recipient)) return deny('EMAIL_RECIPIENT_UNSAFE');
  if (!token(email.threadId, 128) || !/^[A-Za-z0-9_-]+$/.test(email.threadId)
    || !token(email.rfcMessageId, 998) || !/^<[^\s<>]+@[^\s<>]+>$/.test(email.rfcMessageId)
    || !token(email.subject, 998) || !Array.isArray(email.references) || email.references.length > 50
    || email.references.some(value => !token(value, 998) || !/^<[^\s<>]+@[^\s<>]+>$/.test(value))) {
    return deny('REPLY_CONTEXT_MISSING', 'draft_only');
  }
  return { ok: true, deadline: envelope.expiresAtMs,
    context: [email.threadId, email.rfcMessageId, email.subject, [...email.references]] };
}

function whatsappPolicy(envelope, nowMs) {
  const wa = envelope.policy.whatsapp;
  if (!plain(wa) || wa.windowVerified !== true) return deny('WHATSAPP_WINDOW_UNVERIFIED');
  if (wa.stopped !== false || wa.blocked !== false) return deny('WHATSAPP_CONSENT_REQUIRED');
  const session = validateSupportSession(wa.session, {
    accountId: envelope.accountId, sender: envelope.recipient, sessionId: wa.sessionId,
  });
  if (!session || session.status !== 'active' || session.updatedAtMs > nowMs
    || session.startedAtMs >= envelope.sourceAtMs || nowMs >= session.expiresAtMs
    || envelope.sourceAtMs >= session.expiresAtMs) return deny('WHATSAPP_CONSENT_REQUIRED');
  if (!time(wa.lastCustomerAtMs) || wa.lastCustomerAtMs > nowMs
    || wa.lastCustomerAtMs < envelope.sourceAtMs || wa.lastCustomerAtMs >= session.expiresAtMs
    || nowMs >= wa.lastCustomerAtMs + DAY_MS) return deny('WHATSAPP_WINDOW_EXPIRED');
  return { ok: true, deadline: Math.min(envelope.expiresAtMs, session.expiresAtMs, wa.lastCustomerAtMs + DAY_MS),
    context: [wa.sessionId, session.policyVersion, session.startedAtMs, session.expiresAtMs,
      session.updatedAtMs, session.closedAtMs, session.lastStartMessageId, wa.lastCustomerAtMs] };
}

function candidate({ request, envelope, actorUid, flags, nowMs } = {}) {
  if (!plain(flags) || flags.replyEnabled !== true) return deny('REPLY_DISABLED');
  if (!time(nowMs)) return deny('NOW_INVALID');
  const valid = validateExternalInboxReplyRequest(request);
  if (!valid.ok) return valid;
  if (!token(actorUid, 128)) return deny('ACTOR_INVALID');
  if (!plain(envelope) || !plain(envelope.policy)) return deny('REPLY_CONTEXT_MISSING', 'draft_only');
  const policy = envelope.policy;
  if (envelope.messageId !== request.messageId || envelope.channel !== request.channel
    || envelope.sourceAtMs !== request.expectedSourceAtMs) return deny('SOURCE_CHANGED');
  if (!token(envelope.accountId, 254) || !token(policy.accountId, 254)
    || policy.accountVerified !== true || envelope.accountId !== policy.accountId) return deny('ACCOUNT_UNVERIFIED');
  if (policy.recipientVerified !== true || !token(envelope.recipient, 254)) return deny('RECIPIENT_UNVERIFIED');
  if (policy.direction !== 'inbound' || policy.live !== true || policy.isEcho !== false) return deny('LIVE_INBOUND_REQUIRED');
  if (policy.version !== EXTERNAL_INBOX_REPLY_POLICY_VERSION || !token(envelope.consentVersion, 128)
    || !token(envelope.providerMessageId)) return deny('REPLY_CONTEXT_MISSING', 'draft_only');
  if (![envelope.captureStartAtMs, envelope.sourceAtMs, envelope.receivedAtMs, envelope.expiresAtMs].every(time)
    || envelope.captureStartAtMs > envelope.sourceAtMs || envelope.sourceAtMs > envelope.receivedAtMs
    || envelope.receivedAtMs > nowMs || envelope.expiresAtMs <= envelope.sourceAtMs
    || envelope.sourceAtMs > nowMs || envelope.captureStartAtMs > nowMs) return deny('SOURCE_TIME_INVALID');
  if (nowMs >= envelope.expiresAtMs) return deny('SOURCE_EXPIRED');
  const channel = envelope.channel === 'email' ? emailPolicy(envelope) : whatsappPolicy(envelope, nowMs);
  if (!channel.ok) return channel;
  // Explicit tuples avoid property-order ambiguity and never serialize arbitrary input objects.
  const actorHash = digest(['external-inbox-reply.actor.v1', actorUid]);
  const bindingHash = digest([EXTERNAL_INBOX_REPLY_POLICY_VERSION, request.key, actorHash, request.text,
    envelope.messageId, envelope.channel, envelope.accountId, envelope.providerMessageId, envelope.recipient,
    envelope.expiresAtMs, envelope.captureStartAtMs, envelope.sourceAtMs, envelope.receivedAtMs,
    envelope.consentVersion, policy.version, channel.context]);
  return { ok: true, actorHash, bindingHash, deadline: channel.deadline };
}

/**
 * SERVER-ONLY: humanApproved must come from an authenticated explicit approval action.
 * envelope/flags must be constructed by the server, never accepted from the client.
 * policy.accountId is the independently pinned company configuration, not a copy of
 * an incoming accountId; accountVerified/recipientVerified are server evidence.
 * The adapter supplies a currently valid consentVersion and existing retention deadline.
 * Gmail email context requires parsed headers and explicit negative auto-mail signals;
 * a snippet-only inbox row cannot be upgraded by inventing those fields.
 * This unkeyed hash binds content, NOT authority: persist this approval server-side.
 * No DB, credentials, network, authentication or actual approval consumption occurs here.
 */
export function prepareApprovedExternalInboxReply(input = {}) {
  if (!plain(input)) return deny('INPUT_INVALID');
  const prepared = candidate(input);
  if (!prepared.ok) return prepared;
  if (input.humanApproved !== true) return deny('HUMAN_APPROVAL_REQUIRED');
  return { ok: true, code: 'APPROVAL_PREPARED', sendAllowed: false, approval: {
    policyVersion: EXTERNAL_INBOX_REPLY_POLICY_VERSION, key: input.request.key,
    bindingHash: prepared.bindingHash, actorHash: prepared.actorHash, approvedAtMs: input.nowMs,
    expiresAtMs: Math.min(input.nowMs + REPLY_APPROVAL_TTL_MS, prepared.deadline), status: 'approved',
  } };
}

/**
 * Read approval from the server ledger and pass approvalConsumed from that same ledger.
 * The adapter MUST atomically recheck current source/session, consume the approval and
 * claim delivery before sending. A true result is policy eligibility, not a send receipt.
 * A STOP arriving after a provider has accepted a message cannot recall that message.
 */
export function validateExternalInboxReplyForSend(input = {}) {
  if (!plain(input)) return deny('INPUT_INVALID');
  const current = candidate(input);
  if (!current.ok) return current;
  const approval = input.approval;
  if (input.approvalConsumed !== false) return deny('APPROVAL_UNAVAILABLE');
  if (!exactKeys(approval, APPROVAL_KEYS) || approval.policyVersion !== EXTERNAL_INBOX_REPLY_POLICY_VERSION
    || approval.status !== 'approved' || typeof approval.bindingHash !== 'string' || typeof approval.actorHash !== 'string'
    || !HEX.test(approval.bindingHash) || !HEX.test(approval.actorHash)
    || !time(approval.approvedAtMs) || !time(approval.expiresAtMs) || approval.approvedAtMs > input.nowMs
    || approval.expiresAtMs <= approval.approvedAtMs
    || approval.expiresAtMs > approval.approvedAtMs + REPLY_APPROVAL_TTL_MS) return deny('APPROVAL_INVALID');
  if (input.nowMs >= approval.expiresAtMs || approval.expiresAtMs > current.deadline) return deny('REAPPROVAL_REQUIRED');
  if (approval.key !== input.request.key || approval.actorHash !== current.actorHash
    || approval.bindingHash !== current.bindingHash) return deny('REAPPROVAL_REQUIRED');
  return { ok: true, code: 'APPROVED_POLICY_VALID', sendAllowed: true, deliveryVerified: false };
}

/** Normalized server evidence only. Provider acceptance is not recipient delivery. */
export function classifyExternalInboxReplyDelivery(evidence = {}) {
  const status = plain(evidence) ? evidence.status : null;
  const receipt = evidence && evidence.receiptVerified === true && token(evidence.providerMessageId);
  if (!REPLY_DELIVERY_STATUSES.includes(status) || status === 'outcome_unknown'
    || (receipt && !['provider_accepted', 'delivered', 'read'].includes(status))
    || (['provider_accepted', 'delivered', 'read'].includes(status) && !receipt)
    || (['delivered', 'read'].includes(status) && evidence.deliveryVerified !== true)
    || (status === 'read' && evidence.readVerified !== true)
    || (status === 'failed_pre_send' && evidence.preSendVerified !== true)) {
    return { status: 'outcome_unknown', providerAccepted: Boolean(receipt), deliveryVerified: false, automaticRetryAllowed: false };
  }
  return { status, providerAccepted: ['provider_accepted', 'delivered', 'read'].includes(status),
    deliveryVerified: ['delivered', 'read'].includes(status), automaticRetryAllowed: status === 'failed_pre_send' };
}

// No channel-neutral acknowledgement copy or autonomous-send policy has been approved.
export function automaticExternalInboxAckPolicy() {
  return deny('AUTOMATIC_ACK_NOT_APPROVED');
}
