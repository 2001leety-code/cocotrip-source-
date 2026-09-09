import { createHash, randomUUID } from 'node:crypto';
import { classifyExternalInboxReplyDelivery, EXTERNAL_INBOX_REPLY_POLICY_VERSION,
  prepareApprovedExternalInboxReply, validateExternalInboxReplyForSend,
  validateExternalInboxReplyRequest } from './external-inbox-reply-policy.js';

export const EXTERNAL_INBOX_REPLY_WORKFLOWS = 'external_inbox_reply_workflows';
export const REPLY_SEND_TIMEOUT_MS = 8000;
export const REPLY_MAX_SEND_ATTEMPTS = 2;
export const EXTERNAL_INBOX_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION = 1;
const STATES = ['draft', 'draft_only', 'approved', 'sending', 'provider_accepted', 'outcome_unknown', 'failed_pre_send', 'cancelled'];
const HASH = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const time = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const bounded = (value, limit = 512) => typeof value === 'string' && value.length > 0 && value.length <= limit
  && value === value.trim() && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => ({ ok: false, code, sendAllowed: false, deliveryVerified: false });
const actorHash = uid => hash(['external-inbox-reply.actor.v1', uid]);
const sourceHash = request => hash(['external-inbox-reply.source.v1', request.channel, request.messageId]);
const draftHash = (request, actor) => hash(['external-inbox-reply.draft.v1', actor, request.messageId,
  request.channel, request.expectedSourceAtMs, request.text]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const envelopeHash = envelope => hash(canonical(envelope));
const draftExpiresAt = (createdAtMs, sourceExpiresAtMs) => sourceExpiresAtMs > 0
  ? Math.min(createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS, sourceExpiresAtMs) : createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS;

function take(value, keys) {
  const output = {};
  if (!object(value)) return output;
  for (const key of keys) if (Object.hasOwn(value, key) && value[key] !== undefined) output[key] = value[key];
  return output;
}

// Never persist an arbitrary resolver object: original mail/text, profile, credentials,
// provider errors and unrelated customer fields have no place in this reply ledger.
function snapshotEnvelope(value) {
  const result = take(value, ['messageId', 'channel', 'accountId', 'providerMessageId', 'recipient',
    'expiresAtMs', 'captureStartAtMs', 'sourceAtMs', 'receivedAtMs', 'consentVersion']);
  result.policy = take(value.policy, ['version', 'accountId', 'accountVerified', 'recipientVerified', 'direction', 'live', 'isEcho']);
  if (object(value.policy.retention)) {
    result.policy.retention = take(value.policy.retention, ['policyVersion', 'caseId', 'revision', 'status', 'deleteAfterMs']);
  }
  if (value.channel === 'email' && object(value.policy.email)) {
    const email = value.policy.email;
    result.policy.email = {};
    for (const key of ['contextVerified', 'singleMailbox', 'headerControls', 'autoSubmitted', 'listHeader', 'noReply', 'ambiguous']) {
      if (typeof email[key] === 'boolean') result.policy.email[key] = email[key];
    }
    for (const key of ['threadId', 'rfcMessageId', 'subject']) {
      if (bounded(email[key], key === 'threadId' ? 128 : 998)) result.policy.email[key] = email[key];
    }
    if (Array.isArray(email.references) && email.references.length <= 50 && email.references.every(item => bounded(item, 998))) {
      result.policy.email.references = [...email.references];
    }
  }
  if (value.channel === 'whatsapp' && object(value.policy.whatsapp)) {
    result.policy.whatsapp = take(value.policy.whatsapp, ['windowVerified', 'stopped', 'blocked', 'sessionId', 'lastCustomerAtMs']);
    result.policy.whatsapp.session = take(value.policy.whatsapp.session, ['policyVersion', 'accountId', 'sender',
      'status', 'startedAtMs', 'expiresAtMs', 'updatedAtMs', 'closedAtMs', 'lastStartMessageId']);
  }
  return JSON.parse(JSON.stringify(result));
}

function contextValid(value, request, nowMs) {
  if (!object(value) || !object(value.policy) || value.messageId !== request.messageId
    || value.channel !== request.channel || value.sourceAtMs !== request.expectedSourceAtMs
    || !bounded(value.accountId, 254) || value.accountId !== value.policy.accountId
    || value.policy.accountVerified !== true || value.policy.recipientVerified !== true
    || value.policy.direction !== 'inbound' || value.policy.live !== true || value.policy.isEcho !== false
    || value.policy.version !== EXTERNAL_INBOX_REPLY_POLICY_VERSION || !bounded(value.consentVersion, 128)
    || !bounded(value.providerMessageId) || !bounded(value.recipient, 254)
    || ![value.captureStartAtMs, value.sourceAtMs, value.receivedAtMs].every(time)
    || value.captureStartAtMs > value.sourceAtMs || value.sourceAtMs > value.receivedAtMs
    || value.receivedAtMs > nowMs) return false;
  const retention = value.policy.retention;
  if (retention !== undefined) return object(retention) && retention.policyVersion === 2 && /^[a-f0-9]{64}$/.test(retention.caseId || '')
    && Number.isSafeInteger(retention.revision) && retention.revision > 0 && ['open', 'closed', 'protected'].includes(retention.status)
    && Number.isSafeInteger(retention.deleteAfterMs) && retention.deleteAfterMs >= 0
    && Object.keys(retention).every(key => ['policyVersion', 'caseId', 'revision', 'status', 'deleteAfterMs'].includes(key))
    && (retention.status === 'closed' ? time(retention.deleteAfterMs) && retention.deleteAfterMs > nowMs && value.expiresAtMs === retention.deleteAfterMs
      : retention.deleteAfterMs === 0 && value.expiresAtMs === 0);
  return time(value.expiresAtMs) && value.expiresAtMs > nowMs;
}

function setup(input, dispatch = false) {
  if (!object(input) || !object(input.flags) || input.flags.replyEnabled !== true) return fail('REPLY_DISABLED');
  if (dispatch && input.flags.dispatchEnabled !== true) return fail('DISPATCH_DISABLED');
  if (!validateExternalInboxReplyRequest(input.request).ok) return fail('REQUEST_INVALID');
  if (!bounded(input.actorUid, 128)) return fail('ACTOR_INVALID');
  if (!input.db || typeof input.db.runTransaction !== 'function' || typeof input.db.collection !== 'function'
    || typeof input.now !== 'function' || typeof input.resolveEnvelope !== 'function') return fail('SERVER_DEPENDENCY_MISSING');
  if (dispatch && typeof input.send !== 'function') return fail('DISPATCHER_MISSING');
  const request = { ...input.request };
  const actor = actorHash(input.actorUid);
  const source = sourceHash(request);
  return { ...input, request, flags: { replyEnabled: true, dispatchEnabled: input.flags.dispatchEnabled === true },
    actor, source, contentHash: draftHash(request, actor),
    ref: input.db.collection(EXTERNAL_INBOX_REPLY_WORKFLOWS).doc(`reply-${source}`),
    keyRef: input.db.collection(EXTERNAL_INBOX_REPLY_WORKFLOWS).doc(`key-${hash([actor, request.key])}`) };
}

function safeSetup(input, dispatch = false) {
  try { return setup(input, dispatch); } catch { return fail('SERVER_DEPENDENCY_UNAVAILABLE'); }
}

function consistentState(record) {
  const retryOfAttemptId = record.retryOfAttemptId || '';
  const initialAttempt = record.attempts === 0 && record.attemptId === '' && retryOfAttemptId === '';
  const firstAttempt = record.attempts === 1 && ATTEMPT_ID.test(record.attemptId) && retryOfAttemptId === '';
  const retryAttempt = record.attempts === 2 && ATTEMPT_ID.test(record.attemptId) && ATTEMPT_ID.test(retryOfAttemptId)
    && record.attemptId !== retryOfAttemptId;
  if (['draft', 'draft_only'].includes(record.status)) return record.approval === null && record.approvalConsumed === false
    && initialAttempt && !record.retryAllowed && record.providerReceiptHash === '';
  if (!object(record.approval) || record.approval.status !== 'approved') return false;
  if (record.status === 'approved') return record.approvalConsumed === false && !record.retryAllowed && record.providerReceiptHash === ''
    && (initialAttempt || (record.attempts === 1 && ATTEMPT_ID.test(record.attemptId) && retryOfAttemptId === record.attemptId));
  if (!record.approvalConsumed || !(firstAttempt || retryAttempt)) return false;
  if (record.status === 'failed_pre_send') return record.retryAllowed === (record.attempts < REPLY_MAX_SEND_ATTEMPTS)
    && record.providerReceiptHash === '';
  if (record.status === 'provider_accepted') return !record.retryAllowed && HASH.test(record.providerReceiptHash);
  return !record.retryAllowed;
}

export function validExternalInboxReplyWorkflowRecord(record, options = {}) {
  return object(record) && record.schemaVersion === VERSION && record.kind === 'reply'
    && record.sourceHash === options.source && record.actorHash === options.actor
    && record.sourceHash === sourceHash(record.request || {}) && validateExternalInboxReplyRequest(record.request).ok
    && record.draftHash === draftHash(record.request, record.actorHash)
    && Number.isSafeInteger(record.revision) && record.revision > 0 && STATES.includes(record.status)
    && object(record.envelope) && record.envelopeHash === envelopeHash(record.envelope)
    && time(record.createdAtMs) && time(record.updatedAtMs) && record.updatedAtMs >= record.createdAtMs
    && (record.expiresAtMs === 0 || time(record.expiresAtMs)) && record.expiresAtMs === record.envelope.expiresAtMs
    && (record.draftExpiresAtMs === undefined || (time(record.draftExpiresAtMs)
      && record.draftExpiresAtMs === draftExpiresAt(record.createdAtMs, record.expiresAtMs)))
    && Number.isInteger(record.attempts) && record.attempts >= 0 && record.attempts <= REPLY_MAX_SEND_ATTEMPTS
    && typeof record.approvalConsumed === 'boolean' && typeof record.retryAllowed === 'boolean'
    && typeof record.attemptId === 'string' && typeof record.providerReceiptHash === 'string'
    && (record.retryOfAttemptId === undefined || typeof record.retryOfAttemptId === 'string')
    && (record.providerReceiptHash === '' || HASH.test(record.providerReceiptHash)) && consistentState(record);
}

function keyValid(key, options) {
  return object(key) && key.schemaVersion === VERSION && key.kind === 'key' && key.sourceHash === options.source
    && key.actorHash === options.actor && key.draftHash === options.contentHash && time(key.expiresAtMs);
}

function summary(record, code) {
  return { ok: true, code, sendAllowed: false, status: record.status, revision: record.revision,
    draftHash: record.draftHash, approvalExpiresAtMs: record.approval ? record.approval.expiresAtMs : 0,
    expiresAtMs: record.expiresAtMs, draftExpiresAtMs: record.draftExpiresAtMs || draftExpiresAt(record.createdAtMs, record.expiresAtMs),
    providerAccepted: Boolean(record.providerReceiptHash), deliveryVerified: false };
}

async function read(tx, options) {
  const recordDoc = await tx.get(options.ref);
  const keyDoc = await tx.get(options.keyRef);
  // Resolver must use THIS transaction for every original/session/STOP read.
  // All reads, including these caller-owned reads, finish before any write.
  const envelope = await options.resolveEnvelope(tx, { messageId: options.request.messageId, channel: options.request.channel });
  const nowMs = options.now();
  if (!time(nowMs)) return fail('NOW_INVALID');
  const record = recordDoc.exists ? recordDoc.data() : null;
  const key = keyDoc.exists ? keyDoc.data() : null;
  if (record && !validExternalInboxReplyWorkflowRecord(record, options)) return fail('LEDGER_CONFLICT');
  if (key && !keyValid(key, options)) return fail('REQUEST_KEY_CONFLICT');
  if (record && (record.createdAtMs > nowMs || record.updatedAtMs > nowMs)) return fail('LEDGER_TIME_INVALID');
  if (record && record.expiresAtMs > 0 && nowMs >= record.expiresAtMs) return fail('SOURCE_EXPIRED');
  if (record && ['draft', 'draft_only', 'approved', 'failed_pre_send'].includes(record.status)
    && nowMs >= (record.draftExpiresAtMs || draftExpiresAt(record.createdAtMs, record.expiresAtMs))) return fail('DRAFT_EXPIRED');
  if (!contextValid(envelope, options.request, nowMs)) return fail('SOURCE_CONTEXT_INVALID');
  const eligibility = prepareApprovedExternalInboxReply({ ...options, envelope, nowMs, humanApproved: false });
  if (eligibility.code !== 'HUMAN_APPROVAL_REQUIRED'
    && !(options.request.channel === 'email' && eligibility.code === 'REPLY_CONTEXT_MISSING')) return fail(eligibility.code);
  return { record, key, envelope: snapshotEnvelope(envelope), nowMs, draftOnly: eligibility.code === 'REPLY_CONTEXT_MISSING' };
}

/**
 * SERVER-ONLY, no authentication implementation here. The caller must verify the root
 * operator and derive resolver/config itself. A body hash is not proof of permission.
 * v1 permits ONE final reply per inbound message, not arbitrary follow-up replies.
 * All operations are OFF without strict replyEnabled=true, including draft storage.
 * Unsent drafts expire at creation +7 days or earlier source expiry; edits never extend this.
 * Sent/uncertain receipts retain their separate state; approval lasts <=5 minutes.
 * Expiry fields do not themselves enable Firestore TTL or physically erase documents.
 */
export async function prepareExternalInboxReplyDraft(input = {}) {
  const options = safeSetup(input);
  if (options.ok === false) return options;
  try {
    return await options.db.runTransaction(async tx => {
      const state = await read(tx, options);
      if (state.ok === false) return state;
      const { record, key, envelope, nowMs, draftOnly } = state;
      const currentHash = envelopeHash(envelope);
      let next = record;
      if (record) {
        const changed = record.draftHash !== options.contentHash || record.envelopeHash !== currentHash;
        if (changed && (!['draft', 'draft_only'].includes(record.status)
          || input.expectedRevision !== record.revision || input.expectedDraftHash !== record.draftHash)) return fail('DRAFT_CONFLICT');
        if (changed) next = { ...record, request: options.request, draftHash: options.contentHash,
          envelope, envelopeHash: currentHash, revision: record.revision + 1, updatedAtMs: nowMs,
          expiresAtMs: envelope.expiresAtMs,
          draftExpiresAtMs: draftExpiresAt(record.createdAtMs, envelope.expiresAtMs),
           status: draftOnly ? 'draft_only' : 'draft' };
        if (next.expiresAtMs !== envelope.expiresAtMs) return fail('RETENTION_CHANGED');
      } else {
        if (key) return fail('LEDGER_MISSING');
        next = { schemaVersion: VERSION, kind: 'reply', sourceHash: options.source, actorHash: options.actor,
          request: options.request, draftHash: options.contentHash, envelope, envelopeHash: currentHash, revision: 1,
          status: draftOnly ? 'draft_only' : 'draft', createdAtMs: nowMs, updatedAtMs: nowMs, expiresAtMs: envelope.expiresAtMs,
          draftExpiresAtMs: draftExpiresAt(nowMs, envelope.expiresAtMs),
          approval: null, approvalConsumed: false, attempts: 0, attemptId: '', retryOfAttemptId: '', retryAllowed: false, providerReceiptHash: '' };
      }
      if (next !== record) tx.set(options.ref, next);
      if (!key) tx.set(options.keyRef, { schemaVersion: VERSION, kind: 'key', sourceHash: options.source,
        actorHash: options.actor, draftHash: options.contentHash, expiresAtMs: draftExpiresAt(next.createdAtMs, next.expiresAtMs) });
      return summary(next, next.status === 'draft_only' ? 'DRAFT_ONLY' : next === record ? 'DRAFT_ALREADY_EXISTS' : 'DRAFT_PREPARED');
    });
  } catch { return fail('DRAFT_STORE_UNAVAILABLE'); }
}

export async function approveExternalInboxReplyDraft(input = {}) {
  const options = safeSetup(input);
  if (options.ok === false) return options;
  if (input.humanApproved !== true) return fail('HUMAN_APPROVAL_REQUIRED');
  try {
    return await options.db.runTransaction(async tx => {
      const state = await read(tx, options);
      if (state.ok === false) return state;
      const { record, key, envelope, nowMs, draftOnly } = state;
      if (!record || !key) return fail('DRAFT_REQUIRED');
      if (draftOnly) return fail('REPLY_CONTEXT_MISSING');
      if (record.draftHash !== options.contentHash || input.expectedRevision !== record.revision
        || input.expectedDraftHash !== record.draftHash || record.envelopeHash !== envelopeHash(envelope)) return fail('DRAFT_CONFLICT');
      if (record.status === 'approved') {
        const existing = validateExternalInboxReplyForSend({ ...options, request: record.request, envelope,
          nowMs, approval: record.approval, approvalConsumed: record.approvalConsumed });
        if (existing.ok) return summary(record, 'ALREADY_APPROVED');
        if (existing.code !== 'REAPPROVAL_REQUIRED' || record.approvalConsumed || ![0, 1].includes(record.attempts)
          || input.renewApproval !== true || input.expectedApprovalExpiresAtMs !== record.approval.expiresAtMs
          || nowMs < record.approval.expiresAtMs) return fail(existing.code);
      }
      const retry = record.status === 'failed_pre_send' && record.retryAllowed === true && record.approvalConsumed === true
        && record.attempts === 1 && ATTEMPT_ID.test(record.attemptId) && (record.retryOfAttemptId || '') === '';
      const approvable = ['draft', 'draft_only', 'approved'].includes(record.status) && !record.approvalConsumed
        && !record.retryAllowed && ((record.attempts === 0 && record.attemptId === '' && (record.retryOfAttemptId || '') === '')
          || (record.status === 'approved' && record.attempts === 1 && ATTEMPT_ID.test(record.attemptId)
            && record.retryOfAttemptId === record.attemptId));
      if ((!approvable && !retry) || (retry && (input.retryPreSend !== true || input.expectedFailedAttemptId !== record.attemptId))) {
        return fail(retry ? 'RETRY_CONFIRMATION_REQUIRED' : 'APPROVAL_LOCKED');
      }
      const prepared = prepareApprovedExternalInboxReply({ ...options, request: record.request, envelope, nowMs, humanApproved: true });
      if (!prepared.ok) return fail(prepared.code);
      const next = { ...record, status: 'approved', approval: prepared.approval, approvalConsumed: false, retryAllowed: false,
        retryOfAttemptId: retry ? record.attemptId : record.retryOfAttemptId || '', updatedAtMs: nowMs };
      tx.set(options.ref, next);
      return summary(next, 'APPROVED');
    });
  } catch { return fail('APPROVAL_STORE_UNAVAILABLE'); }
}

async function markUncertain(options, attemptId) {
  try {
    await options.db.runTransaction(async tx => {
      const doc = await tx.get(options.ref);
      const record = doc.exists ? doc.data() : null;
      if (!record || !validExternalInboxReplyWorkflowRecord(record, options) || record.status !== 'sending' || record.attemptId !== attemptId) return;
      const nowMs = options.now();
      if (!time(nowMs) || nowMs < record.updatedAtMs) return;
      tx.set(options.ref, { ...record, status: 'outcome_unknown', updatedAtMs: nowMs, retryAllowed: false });
    });
  } catch { /* A durable sending claim is already a no-retry quarantine. Never reset it. */ }
}

async function invokeSender(send, payload) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => send({ ...payload, signal: controller.signal })),
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: 'outcome_unknown' }); }, REPLY_SEND_TIMEOUT_MS); }),
    ]);
  } catch { return { status: 'outcome_unknown' }; }
  finally { clearTimeout(timer); }
}

/**
 * Only the injected adapter may send; this module imports no DB/client/token runtime.
 * Its normalized evidence must be independently verified, never a raw provider body.
 * Claim commit must resolve before the callback is invoked, once per invocation.
 * A transaction response loss never authorizes a speculative send or lease reclaim.
 * STOP racing with claim is caught by transaction retries. STOP after claim cannot
 * atomically undo an external send; there is no cross-provider/Firestore transaction.
 */
export async function dispatchExternalInboxReply(input = {}) {
  const options = safeSetup(input, true);
  if (options.ok === false) return options;
  const attemptId = randomUUID();
  let claim;
  try {
    claim = await options.db.runTransaction(async tx => {
      const state = await read(tx, options);
      if (state.ok === false) return state;
      const { record, key, envelope, nowMs, draftOnly } = state;
      if (!record || !key) return fail('DRAFT_REQUIRED');
      if (record.draftHash !== options.contentHash || input.expectedRevision !== record.revision
        || input.expectedDraftHash !== record.draftHash || record.envelopeHash !== envelopeHash(envelope)) return fail('DRAFT_CONFLICT');
      if (record.status === 'provider_accepted') return summary(record, 'ALREADY_DISPATCHED');
      if (['sending', 'outcome_unknown'].includes(record.status)) return fail('DELIVERY_UNCERTAIN');
      const approved = record.status === 'approved' && record.approvalConsumed === false && record.retryAllowed === false
        && ((record.attempts === 0 && record.attemptId === '' && (record.retryOfAttemptId || '') === '')
          || (record.attempts === 1 && ATTEMPT_ID.test(record.attemptId) && record.retryOfAttemptId === record.attemptId));
      if (draftOnly || !approved) return fail('APPROVAL_REQUIRED');
      const checked = validateExternalInboxReplyForSend({ ...options, request: record.request, envelope,
        nowMs, approval: record.approval, approvalConsumed: false });
      if (!checked.ok) return fail(checked.code);
      tx.set(options.ref, { ...record, status: 'sending', approvalConsumed: true,
        attempts: record.attempts + 1, attemptId, retryAllowed: false, updatedAtMs: nowMs });
      return { claimed: true, envelope, text: record.request.text, claimedAtMs: nowMs, approvalExpiresAtMs: record.approval.expiresAtMs };
    });
  } catch {
    await markUncertain(options, attemptId);
    return fail('DELIVERY_UNCERTAIN');
  }
  if (!claim.claimed) return claim;
  // A delayed transaction response may cross the approval deadline. Do not send then.
  let sendAtMs;
  try { sendAtMs = options.now(); } catch { await markUncertain(options, attemptId); return fail('DELIVERY_UNCERTAIN'); }
  if (!time(sendAtMs) || sendAtMs < claim.claimedAtMs || sendAtMs >= claim.approvalExpiresAtMs) {
    await markUncertain(options, attemptId);
    return fail('DELIVERY_UNCERTAIN');
  }
  const raw = await invokeSender(options.send, { envelope: claim.envelope, text: claim.text, attemptId,
    authorizationExpiresAtMs: claim.approvalExpiresAtMs });
  let evidence;
  try { evidence = classifyExternalInboxReplyDelivery(raw); }
  catch { await markUncertain(options, attemptId); return fail('DELIVERY_UNCERTAIN'); }
  // A send callback cannot prove delivery: only a separately authenticated status event can.
  const status = evidence.providerAccepted && evidence.status !== 'outcome_unknown' ? 'provider_accepted'
    : evidence.automaticRetryAllowed ? 'failed_pre_send' : 'outcome_unknown';
  try {
    const finalized = await options.db.runTransaction(async tx => {
      const doc = await tx.get(options.ref);
      const record = doc.exists ? doc.data() : null;
      const nowMs = options.now();
      if (!record || !validExternalInboxReplyWorkflowRecord(record, options) || record.status !== 'sending' || record.attemptId !== attemptId
        || !time(nowMs) || nowMs < record.updatedAtMs) return false;
      tx.set(options.ref, { ...record, status, updatedAtMs: nowMs,
        retryAllowed: status === 'failed_pre_send' && record.attempts < REPLY_MAX_SEND_ATTEMPTS,
        providerReceiptHash: evidence.providerAccepted && bounded(raw.providerMessageId) ? hash(raw.providerMessageId) : '' });
      return true;
    });
    if (!finalized) { await markUncertain(options, attemptId); return fail('DELIVERY_UNCERTAIN'); }
  } catch { await markUncertain(options, attemptId); return fail('DELIVERY_UNCERTAIN'); }
  return { ok: status === 'provider_accepted', code: status === 'provider_accepted' ? 'PROVIDER_ACCEPTED'
    : status === 'failed_pre_send' ? 'PRE_SEND_FAILURE' : 'DELIVERY_UNCERTAIN', status,
  sendAllowed: false, providerAccepted: evidence.providerAccepted, deliveryVerified: false };
}
