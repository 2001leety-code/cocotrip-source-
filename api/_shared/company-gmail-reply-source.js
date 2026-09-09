import { createHash } from 'node:crypto';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION } from './external-inbox-store.js';
import { INBOX_CASES_COLLECTION, inboxCaseAllowsRead, inboxCaseId, validInboxCase } from './external-inbox-retention.js';
import { EXTERNAL_INBOX_REPLY_POLICY_VERSION } from './external-inbox-reply-policy.js';

const HASH = /^[a-f0-9]{64}$/;
const TIME = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit
  && value === value.trim() && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const mailbox = value => text(value, 254) && !/[\s<>,;:"\\]/.test(value) && /^[^@.][^@\s]*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}$/i.test(value);
const messageId = value => text(value, 998) && /^<[^\s<>]+@[^\s<>]+>$/.test(value);
const headerText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit
  && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const HEADER_NAMES = ['from', 'reply-to', 'message-id', 'references', 'subject', 'auto-submitted',
  'list-id', 'list-post', 'list-unsubscribe', 'precedence', 'x-auto-response-suppress'];

function normalizedMailbox(value) {
  if (!headerText(value, 998)) return '';
  const bare = value.match(/^([^\s<>,;:"\\]+@[^\s<>,;:"\\]+)$/);
  const angle = value.match(/^[^<>,;:"\\]*<([^\s<>,;:"\\]+@[^\s<>,;:"\\]+)>$/);
  const quotedAngle = value.match(/^"(?:[^"\\\r\n]|\\["\\])*"[ \t]*<([^\s<>,;:"\\]+@[^\s<>,;:"\\]+)>$/);
  const address = bare?.[1] || angle?.[1] || quotedAngle?.[1] || '';
  if (!mailbox(address)) return '';
  const [local, domain] = address.split('@');
  return `${local}@${domain.toLowerCase()}`;
}

function one(values) { return values.length === 1 ? values[0] : ''; }

function references(value) {
  if (!value) return [];
  const values = value.trim().split(/\s+/);
  return values.length <= 50 && values.every(messageId) ? values : null;
}

/** Stores only reply-routing evidence, never a raw provider header map. */
export function normalizeCompanyGmailReplyHeaders(headers, threadId) {
  const indexed = Object.fromEntries(HEADER_NAMES.map(name => [name, []]));
  let headerControls = false;
  if (!Array.isArray(headers) || !text(threadId, 128) || !/^[A-Za-z0-9_-]+$/.test(threadId)) return {
    version: 1, recipient: '', contextVerified: false, singleMailbox: false, headerControls: true,
    autoSubmitted: true, listHeader: true, noReply: true, ambiguous: true, threadId: '', rfcMessageId: '', subject: '', references: [],
  };
  for (const header of headers) {
    if (!header || typeof header.name !== 'string' || typeof header.value !== 'string') { headerControls = true; continue; }
    const name = header.name.toLowerCase();
    if (HEADER_NAMES.includes(name)) indexed[name].push(header.value);
    if (Array.from(header.value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) headerControls = true;
  }
  const from = normalizedMailbox(one(indexed.from));
  const replyTo = indexed['reply-to'].length ? normalizedMailbox(one(indexed['reply-to'])) : '';
  const recipient = replyTo || from;
  const singleMailbox = indexed.from.length === 1 && indexed['reply-to'].length <= 1 && Boolean(from)
    && (!indexed['reply-to'].length || Boolean(replyTo));
  const rfcMessageId = one(indexed['message-id']);
  const subject = one(indexed.subject);
  const referenceList = indexed.references.length <= 1 ? references(one(indexed.references)) : null;
  const ambiguous = !singleMailbox || indexed['message-id'].length !== 1 || indexed.subject.length !== 1 || referenceList === null;
  const autoSubmitted = indexed['auto-submitted'].length > 0 || indexed['x-auto-response-suppress'].length > 0;
  const listHeader = ['list-id', 'list-post', 'list-unsubscribe', 'precedence'].some(name => indexed[name].length > 0);
  const noReply = !recipient || /^(?:do[-_]?not[-_]?reply|no[-_]?reply)$/i.test(recipient.split('@')[0]);
  const contextVerified = singleMailbox && !headerControls && !autoSubmitted && !listHeader && !noReply && !ambiguous
    && messageId(rfcMessageId) && headerText(subject, 998) && referenceList !== null;
  return { version: 1, recipient, contextVerified, singleMailbox, headerControls, autoSubmitted, listHeader, noReply, ambiguous,
    threadId, rfcMessageId: messageId(rfcMessageId) ? rfcMessageId : '', subject: headerText(subject, 998) ? subject : '',
    references: referenceList || [] };
}

function validReplyHeaders(value) {
  return object(value) && value.version === 1 && typeof value.recipient === 'string' && typeof value.contextVerified === 'boolean'
    && ['singleMailbox', 'headerControls', 'autoSubmitted', 'listHeader', 'noReply', 'ambiguous'].every(key => typeof value[key] === 'boolean')
    && typeof value.threadId === 'string' && typeof value.rfcMessageId === 'string' && typeof value.subject === 'string'
    && Array.isArray(value.references) && value.references.every(item => typeof item === 'string')
    && Object.keys(value).every(key => ['version', 'recipient', 'contextVerified', 'singleMailbox', 'headerControls', 'autoSubmitted',
      'listHeader', 'noReply', 'ambiguous', 'threadId', 'rfcMessageId', 'subject', 'references'].includes(key));
}

function ownedV2Email(data, id, config, nowMs) {
  if (!object(data) || !config || config.ready !== true || config.accountId !== data.accountId || data.channel !== 'email'
    || data.retentionPolicyVersion !== 2 || data.expiresAtMs !== 0 || data.expiresAt !== null || !HASH.test(data.caseId || '')
    || !TIME(data.sourceAtMs) || !TIME(data.receivedAtMs) || data.sourceAtMs > data.receivedAtMs || data.receivedAtMs > nowMs
    || data.sourceAtMs < config.captureStartAtMs || !text(data.providerMessageId, 512) || !text(data.providerThreadId, 128)
    || !validReplyHeaders(data.gmailReply)) return false;
  try {
    return id === createHash('sha256').update(JSON.stringify(['external-inbox.v1', data.channel, data.accountId, data.providerMessageId])).digest('hex')
      && data.caseId === inboxCaseId(data);
  } catch { return false; }
}

function policyEmail(headers) {
  return { contextVerified: headers.contextVerified, singleMailbox: headers.singleMailbox, headerControls: headers.headerControls,
    autoSubmitted: headers.autoSubmitted, listHeader: headers.listHeader, noReply: headers.noReply, ambiguous: headers.ambiguous,
    threadId: headers.threadId, rfcMessageId: headers.rfcMessageId, subject: headers.subject, references: [...headers.references] };
}

/**
 * Transaction-only resolver for the verified company Gmail receipt copy. It performs no provider call.
 * v2 open/protected sources deliberately retain deadline 0; closed sources bind their actual deletion deadline.
 */
export function createCompanyGmailReplyResolver({ db, inboxConfig, now = Date.now } = {}) {
  return async (tx, request) => {
    if (!db || !tx || typeof tx.get !== 'function' || !inboxConfig || inboxConfig.ready !== true || typeof now !== 'function'
      || !request || request.channel !== 'email' || !HASH.test(request.messageId || '')) return null;
    const sourceRef = db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(request.messageId);
    const source = await tx.get(sourceRef);
    const data = source.exists ? source.data() : null;
    const caseRef = data && typeof data.caseId === 'string' ? db.collection(INBOX_CASES_COLLECTION).doc(data.caseId) : null;
    const inboxCase = caseRef ? await tx.get(caseRef) : null;
    const nowMs = now();
    if (!TIME(nowMs) || !ownedV2Email(data, request.messageId, inboxConfig, nowMs) || !inboxCase?.exists) return null;
    const record = inboxCase.data();
    if (!validInboxCase(record, data.caseId) || !inboxCaseAllowsRead(record, data.caseId, nowMs, data)) return null;
    const expiresAtMs = record.status === 'closed' ? record.deleteAfterMs : 0;
    if ((record.status === 'closed' && (!TIME(expiresAtMs) || expiresAtMs <= nowMs))
      || (record.status !== 'closed' && expiresAtMs !== 0)) return null;
    const headers = data.gmailReply;
    return { messageId: request.messageId, channel: 'email', accountId: data.accountId, providerMessageId: data.providerMessageId,
      recipient: headers.recipient, sourceAtMs: data.sourceAtMs, receivedAtMs: data.receivedAtMs,
      captureStartAtMs: inboxConfig.captureStartAtMs, expiresAtMs, consentVersion: 'company-gmail-reply.v2',
      policy: { version: EXTERNAL_INBOX_REPLY_POLICY_VERSION, accountId: inboxConfig.accountId, accountVerified: true,
        recipientVerified: Boolean(headers.recipient), direction: 'inbound', live: true, isEcho: false,
        retention: { policyVersion: 2, caseId: data.caseId, revision: record.revision, status: record.status, deleteAfterMs: expiresAtMs },
        email: policyEmail(headers) } };
  };
}
