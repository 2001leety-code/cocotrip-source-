import { createHash } from 'node:crypto';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION } from './external-inbox-store.js';
import { INBOX_CASES_COLLECTION, inboxCaseAllowsRead, inboxCaseId, validInboxCase } from './external-inbox-retention.js';
import { EXTERNAL_INBOX_REPLY_POLICY_VERSION } from './external-inbox-reply-policy.js';
import { WHATSAPP_PRIVACY_MODE, WHATSAPP_SESSIONS_COLLECTION, sessionDocId, supportCommand,
  validateSupportSession, validSupportAccount, validSupportMessageId, validSupportSender } from './whatsapp-support-sessions.js';

const HASH = /^[a-f0-9]{64}$/;
const time = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const RECEIPT_KEYS = ['channel', 'accountId', 'providerMessageId', 'providerThreadId', 'sourceAtMs', 'receivedAtMs',
  'sender', 'subject', 'text', 'kind', 'truncated', 'retentionPolicyVersion', 'caseId', 'expiresAtMs', 'expiresAt',
  'whatsappPolicyVersion', 'whatsappSessionId'];
const KINDS = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts',
  'interactive', 'button', 'reaction', 'unknown', 'unsupported', 'order', 'system']);

function ownedLiveReceipt(data, id, config) {
  if (!object(data) || Object.keys(data).length !== RECEIPT_KEYS.length
    || !RECEIPT_KEYS.every(key => Object.hasOwn(data, key))
    || data.channel !== 'whatsapp' || data.accountId !== config.accountId
    || !validSupportSender(data.sender) || data.providerThreadId !== data.sender
    || !validSupportMessageId(data.providerMessageId) || !KINDS.has(data.kind)
    || data.subject !== '' || typeof data.text !== 'string' || Array.from(data.text).length > 4000
    || Array.from(data.text).some(character => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) || (data.kind !== 'text' && data.text !== '')
    || typeof data.truncated !== 'boolean' || supportCommand(data.kind, data.text) !== 'message'
    || data.retentionPolicyVersion !== 2 || data.expiresAtMs !== 0 || data.expiresAt !== null
    || typeof data.caseId !== 'string' || !HASH.test(data.caseId)
    || data.whatsappPolicyVersion !== 1 || typeof data.whatsappSessionId !== 'string'
    || !HASH.test(data.whatsappSessionId) || !time(data.sourceAtMs) || !time(data.receivedAtMs)
    || data.sourceAtMs < config.captureStartAtMs || data.sourceAtMs > data.receivedAtMs) return false;
  return id === createHash('sha256').update(JSON.stringify(['external-inbox.v1', data.channel,
    data.accountId, data.providerMessageId])).digest('hex')
    && data.caseId === inboxCaseId(data)
    && data.whatsappSessionId === sessionDocId(config.accountId, data.sender);
}

/**
 * Reads only the server's signed-live, explicit-session receipt collection, its case,
 * and current START/STOP record using the caller's transaction. No provider calls.
 * The selected verified source time is a conservative customer-window lower bound;
 * receipt/case activity times and client routing claims never extend that window.
 */
export function createWhatsAppReplyResolver({ db, inboxConfig, now = Date.now } = {}) {
  return async (tx, request) => {
    if (!db || typeof db.collection !== 'function' || !tx || typeof tx.get !== 'function'
      || !object(inboxConfig) || inboxConfig.ready !== true || inboxConfig.enabled !== true
      || inboxConfig.privacyMode !== WHATSAPP_PRIVACY_MODE || !validSupportAccount(inboxConfig.accountId)
      || !time(inboxConfig.captureStartAtMs) || typeof now !== 'function' || !object(request)
      || request.channel !== 'whatsapp' || typeof request.messageId !== 'string' || !HASH.test(request.messageId)) return null;

    const source = await tx.get(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(request.messageId));
    const data = source.exists ? source.data() : null;
    if (!ownedLiveReceipt(data, request.messageId, inboxConfig)) return null;
    const [caseSnapshot, sessionSnapshot] = await Promise.all([
      tx.get(db.collection(INBOX_CASES_COLLECTION).doc(data.caseId)),
      tx.get(db.collection(WHATSAPP_SESSIONS_COLLECTION).doc(data.whatsappSessionId)),
    ]);
    // Transaction reads/retries can take time; assess deadlines only after all reads.
    const nowMs = now();
    if (!time(nowMs) || data.receivedAtMs > nowMs || !caseSnapshot.exists || !sessionSnapshot.exists) return null;
    const record = caseSnapshot.data();
    const session = validateSupportSession(sessionSnapshot.data(), {
      accountId: inboxConfig.accountId, sender: data.sender, sessionId: data.whatsappSessionId,
    });
    if (!object(record) || !validInboxCase(record, data.caseId) || !inboxCaseAllowsRead(record, data.caseId, nowMs, data)
      || record.createdAtMs > data.receivedAtMs || record.lastActivityAtMs < data.receivedAtMs
      || !object(session) || session.status !== 'active' || session.updatedAtMs > data.receivedAtMs
      || session.startedAtMs < inboxConfig.captureStartAtMs || data.sourceAtMs <= session.startedAtMs
      || data.sourceAtMs >= session.expiresAtMs || data.receivedAtMs >= session.expiresAtMs || nowMs >= session.expiresAtMs
      || data.providerMessageId === session.lastStartMessageId) return null;

    const expiresAtMs = record.status === 'closed' ? record.deleteAfterMs : 0;
    return {
      messageId: request.messageId, channel: 'whatsapp', accountId: inboxConfig.accountId,
      providerMessageId: data.providerMessageId, recipient: data.sender,
      sourceAtMs: data.sourceAtMs, receivedAtMs: data.receivedAtMs,
      captureStartAtMs: inboxConfig.captureStartAtMs, expiresAtMs, consentVersion: 'whatsapp-explicit-reply.v2',
      policy: {
        version: EXTERNAL_INBOX_REPLY_POLICY_VERSION, accountId: inboxConfig.accountId, accountVerified: true,
        recipientVerified: true, direction: 'inbound', live: true, isEcho: false,
        retention: { policyVersion: 2, caseId: data.caseId, revision: record.revision, status: record.status, deleteAfterMs: expiresAtMs },
        whatsapp: { windowVerified: true, stopped: false, blocked: false, sessionId: data.whatsappSessionId,
          lastCustomerAtMs: data.sourceAtMs, session: { ...session } },
      },
    };
  };
}
