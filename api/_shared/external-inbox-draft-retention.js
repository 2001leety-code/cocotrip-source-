import { createHash } from 'node:crypto';
import { sessionDocId, validSupportSender } from './whatsapp-support-sessions.js';
import { EXTERNAL_INBOX_DRAFT_RETENTION_MS, EXTERNAL_INBOX_REPLY_WORKFLOWS,
  validExternalInboxReplyWorkflowRecord } from './external-inbox-reply-workflow.js';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION } from './external-inbox-store.js';
import { INBOX_CASES_COLLECTION, inboxCaseId, validInboxCase } from './external-inbox-retention.js';

const VERSION = 1;
const HASH = /^[a-f0-9]{64}$/;
const PURGEABLE = new Set(['draft', 'draft_only', 'approved']);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const time = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const draftExpiresAt = (createdAtMs, sourceExpiresAtMs) => sourceExpiresAtMs > 0
  ? Math.min(createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS, sourceExpiresAtMs) : createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS;
const countResult = (ok, code, selected = 0, purged = 0, skipped = 0) => ({ ok, code, selected, purged, skipped });

function eligibleDraft(record, docId, nowMs) {
  if (!object(record) || docId !== `reply-${record.sourceHash}`
    || !validExternalInboxReplyWorkflowRecord(record, { source: record.sourceHash, actor: record.actorHash })
    || record.schemaVersion !== VERSION || record.kind !== 'reply'
    || !PURGEABLE.has(record.status) || record.attempts !== 0 || !time(record.createdAtMs)
    || !time(record.updatedAtMs) || record.updatedAtMs < record.createdAtMs || !(record.expiresAtMs === 0 || time(record.expiresAtMs))
    || !HASH.test(record.sourceHash) || !HASH.test(record.actorHash)
    || !object(record.request) || !object(record.envelope) || typeof record.draftHash !== 'string'
    || !HASH.test(record.draftHash) || !HASH.test(record.envelopeHash) || !Number.isSafeInteger(record.revision)
    || record.revision < 1 || record.request.messageId !== record.envelope.messageId
    || record.request.channel !== record.envelope.channel || record.envelope.expiresAtMs !== record.expiresAtMs
    || record.providerReceiptHash !== '' || record.approvalConsumed !== false
    || record.retryAllowed !== false || record.attemptId !== '' || record.updatedAtMs > nowMs) return null;
  if (['draft', 'draft_only'].includes(record.status) && record.approval !== null) return null;
  if (record.status === 'approved' && (!object(record.approval) || record.approval.status !== 'approved')) return null;
  const expiry = record.draftExpiresAtMs === undefined
    ? draftExpiresAt(record.createdAtMs, record.expiresAtMs) : record.draftExpiresAtMs;
  if (!time(expiry) || expiry !== draftExpiresAt(record.createdAtMs, record.expiresAtMs)) return null;
  return expiry;
}

function tombstone(record, nowMs, expiresAtMs) {
  return { schemaVersion: VERSION, kind: 'reply_purged', status: 'purged', sourceHash: record.sourceHash,
    actorHash: record.actorHash, createdAtMs: record.createdAtMs, draftExpiresAtMs: expiresAtMs,
    purgedAtMs: nowMs, retentionVersion: 1 };
}

function ownedSource(record, source, inboxCase, configs, nowMs) {
  const data = source && source.exists ? source.data() : null;
  const config = data && configs[data.channel];
  if (!data || !config || config.ready !== true || !['email', 'whatsapp'].includes(data.channel)
    || data.channel !== record.request.channel || data.accountId !== config.accountId
    || data.retentionPolicyVersion !== 2 || data.expiresAtMs !== 0 || data.expiresAt !== null
    || !inboxCase || data.caseId !== inboxCase.id || source.id !== record.request.messageId
    || !time(data.sourceAtMs) || !time(data.receivedAtMs) || data.sourceAtMs > data.receivedAtMs
    || data.sourceAtMs < config.captureStartAtMs || data.receivedAtMs > nowMs
    || record.request.expectedSourceAtMs !== data.sourceAtMs || record.envelope.accountId !== data.accountId
    || record.envelope.providerMessageId !== data.providerMessageId) return 'blocked';
  try {
    const originalId = createHash('sha256').update(JSON.stringify(['external-inbox.v1', data.channel,
      data.accountId, data.providerMessageId])).digest('hex');
    if (originalId !== source.id || inboxCaseId(data) !== data.caseId || !inboxCase.exists
      || !validInboxCase(inboxCase.data(), data.caseId) || inboxCase.data().updatedAtMs > nowMs) return 'blocked';
    if (data.channel === 'whatsapp' && (data.whatsappPolicyVersion !== 1 || !validSupportSender(data.sender)
      || data.whatsappSessionId !== sessionDocId(data.accountId, data.sender))) return 'blocked';
  } catch { return 'blocked'; }
  return inboxCase.data().status === 'protected' ? 'protected' : 'owned';
}

/**
 * Replaces only provably unused, expired reply drafts with a source-locking tombstone.
 * It never sends, reads a credential, or deletes request keys
 * and delivery receipts. The caller supplies a bounded server time and schedules it.
 */
export async function purgeExpiredExternalInboxDrafts({ db, configs, now, limit = 50 } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function' || !object(configs) || !time(now)) {
    return countResult(false, 'RETENTION_DEPENDENCY_INVALID');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return countResult(false, 'RETENTION_LIMIT_INVALID');
  const perStatusLimit = Math.ceil(limit / PURGEABLE.size);
  let candidates;
  try {
    candidates = (await Promise.all([...PURGEABLE].map(async status => {
      const snapshot = await db.collection(EXTERNAL_INBOX_REPLY_WORKFLOWS).where('status', '==', status)
        .orderBy('createdAtMs', 'asc').limit(perStatusLimit).get();
      return snapshot.docs || [];
    }))).flat().sort((left, right) => {
      const leftTime = left.data()?.createdAtMs || 0;
      const rightTime = right.data()?.createdAtMs || 0;
      return leftTime - rightTime || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    }).slice(0, limit);
  } catch {
    return countResult(false, 'RETENTION_QUERY_UNAVAILABLE');
  }

  let selected = 0;
  let purged = 0;
  let skipped = 0;
  let blocked = false;
  for (const candidate of candidates) {
    let result;
    try {
      result = await db.runTransaction(async tx => {
        const current = await tx.get(candidate.ref);
        if (!current.exists) return 'skipped';
        const record = current.data();
        if (!PURGEABLE.has(record && record.status)) return 'skipped';
        const expiry = eligibleDraft(record, candidate.ref.id, now);
        if (!expiry) return 'blocked';
        if (now < expiry) return 'skipped';
        const source = await tx.get(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(record.request.messageId));
        const sourceData = source.exists ? source.data() : null;
        const inboxCase = sourceData && typeof sourceData.caseId === 'string'
          ? await tx.get(db.collection(INBOX_CASES_COLLECTION).doc(sourceData.caseId)) : null;
        const ownership = ownedSource(record, source, inboxCase, configs, now);
        if (ownership === 'protected') return 'skipped';
        if (ownership !== 'owned') return 'blocked';
        tx.set(candidate.ref, tombstone(record, now, expiry));
        return 'purged';
      });
    } catch {
      result = 'blocked';
    }
    selected += 1;
    if (result === 'purged') purged += 1;
    else { skipped += 1; if (result === 'blocked') blocked = true; }
  }
  return countResult(!blocked, blocked ? 'RETENTION_REVIEW_REQUIRED' : 'RETENTION_COMPLETED', selected, purged, skipped);
}
