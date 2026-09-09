import { createHash } from 'node:crypto';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION } from './external-inbox-store.js';
import { INBOX_CASES_COLLECTION, inboxCaseId, validInboxCase } from './external-inbox-retention.js';
import { sessionDocId, validSupportSender } from './whatsapp-support-sessions.js';
import { EXTERNAL_INBOX_REPLY_WORKFLOWS, validExternalInboxReplyWorkflowRecord } from './external-inbox-reply-workflow.js';
import { companyGmailInboxConfigForAccount } from './company-gmail-inbox-registry.js';

const HASH = /^[a-f0-9]{64}$/;
const validTime = value => Number.isSafeInteger(value) && value > 0;
const cutoff = (record, nowMs) => Math.max(record.expiredThroughMs,
  record.status === 'closed' && record.deleteAfterMs <= nowMs ? record.closedAtMs : 0);
const due = (record, id, nowMs) => validInboxCase(record, id) && record.status !== 'protected'
  && record.updatedAtMs <= nowMs && record.cleanupDueAtMs > 0 && record.cleanupDueAtMs <= nowMs && cutoff(record, nowMs) > 0;

function removableReply(row, sourceHash, messageId, message, closedAtMs) {
  const record = row.data();
  if (!record || record.schemaVersion !== 1 || record.sourceHash !== sourceHash || !HASH.test(record.actorHash || '')) return false;
  if (record.kind === 'key') return /^key-[a-f0-9]{64}$/.test(row.id) && HASH.test(record.draftHash || '')
    && validTime(record.expiresAtMs) && Object.keys(record).every(key => ['schemaVersion', 'kind', 'sourceHash', 'actorHash', 'draftHash', 'expiresAtMs'].includes(key));
  if (row.id !== `reply-${sourceHash}`) return false;
  if (record.kind === 'reply_purged') return record.status === 'purged' && validTime(record.createdAtMs)
    && record.createdAtMs <= closedAtMs && validTime(record.purgedAtMs) && record.retentionVersion === 1
    && Object.keys(record).every(key => ['schemaVersion', 'kind', 'status', 'sourceHash', 'actorHash', 'createdAtMs', 'draftExpiresAtMs', 'purgedAtMs', 'retentionVersion'].includes(key));
  return validExternalInboxReplyWorkflowRecord(record, { source: sourceHash, actor: record.actorHash })
    && record.updatedAtMs <= closedAtMs && record.request.messageId === messageId && record.request.channel === message.channel
    && record.request.expectedSourceAtMs === message.sourceAtMs && record.envelope.accountId === message.accountId
    && record.envelope.providerMessageId === message.providerMessageId
    && (record.status === 'provider_accepted'
      || (['draft', 'draft_only', 'approved'].includes(record.status) && record.attempts === 0));
}

function ownedMessage(id, data, caseId, configs, nowMs) {
  const config = data?.channel === 'email'
    ? companyGmailInboxConfigForAccount(configs, data.accountId) : data && configs[data.channel];
  if (!data || data.retentionPolicyVersion !== 2 || data.caseId !== caseId || !config || !config.ready
    || data.accountId !== config.accountId || data.expiresAtMs !== 0 || data.expiresAt !== null
    || !validTime(data.sourceAtMs) || data.sourceAtMs < config.captureStartAtMs
    || !validTime(data.receivedAtMs) || data.sourceAtMs > data.receivedAtMs || data.receivedAtMs > nowMs
    || typeof data.providerMessageId !== 'string' || data.providerMessageId.length < 1 || data.providerMessageId.length > 512) return false;
  if (data.channel === 'whatsapp' && (data.whatsappPolicyVersion !== 1 || !validSupportSender(data.sender)
    || data.whatsappSessionId !== sessionDocId(data.accountId, data.sender))) return false;
  try {
    return inboxCaseId(data) === caseId && id === createHash('sha256').update(JSON.stringify([
      'external-inbox.v1', data.channel, data.accountId, data.providerMessageId,
    ])).digest('hex');
  } catch { return false; }
}

/**
 * Deletes only scoped v2 copies after an explicit ordinary-case closure + 30 days.
 * Protected, legacy, foreign and malformed records are never treated as ordinary.
 * Fresh messages and every purge share a case transaction, so reopen/hold wins retries.
 * Cursor uses document ID (not customer data); every run is bounded and restartable.
 */
export async function purgeExpiredExternalInboxCopies({ db, configs, now = Date.now, caseLimit = 5, messageLimit = 40 } = {}) {
  const counts = { ok: true, code: 'RETENTION_COMPLETED', cases: 0, examined: 0, purged: 0, kept: 0, blocked: 0 };
  if (!db || typeof db.runTransaction !== 'function' || typeof now !== 'function' || !configs
    || !Number.isInteger(caseLimit) || caseLimit < 1 || caseLimit > 10
    || !Number.isInteger(messageLimit) || messageLimit < 1 || messageLimit > 50) {
    return { ...counts, ok: false, code: 'RETENTION_DEPENDENCY_INVALID' };
  }
  const startedAtMs = now();
  if (!validTime(startedAtMs)) return { ...counts, ok: false, code: 'RETENTION_CLOCK_INVALID' };
  try {
    // One ordered field: no compound index is required for the case due queue.
    const cases = await db.collection(INBOX_CASES_COLLECTION).where('cleanupDueAtMs', '>', 0)
      .where('cleanupDueAtMs', '<=', startedAtMs).orderBy('cleanupDueAtMs', 'asc').limit(caseLimit).get();
    for (const candidate of cases.docs) {
      const expected = candidate.data();
      counts.cases++;
      if (!due(expected, candidate.id, startedAtMs)) { counts.blocked++; continue; }
      let query = db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).where('caseId', '==', candidate.id)
        .orderBy('__name__', 'asc');
      if (expected.cleanupCursor) query = query.startAfter(expected.cleanupCursor);
      const page = await query.limit(messageLimit).get();
      let interrupted = false;
      for (const row of page.docs) {
        counts.examined++;
        let outcome;
        try {
          outcome = await db.runTransaction(async tx => {
            const currentCase = await tx.get(candidate.ref);
            const currentMessage = await tx.get(row.ref);
            const checkedAtMs = now();
            const record = currentCase.exists ? currentCase.data() : null;
            if (!validTime(checkedAtMs) || checkedAtMs < startedAtMs || !record
              || record.revision !== expected.revision || !due(record, candidate.id, checkedAtMs)) return 'blocked';
            if (!currentMessage.exists) return 'kept';
            const data = currentMessage.data();
            if (!ownedMessage(row.id, data, candidate.id, configs, checkedAtMs)) return 'blocked';
            if (data.receivedAtMs > cutoff(record, checkedAtMs)) return 'kept';
            const sourceHash = createHash('sha256').update(JSON.stringify(['external-inbox-reply.source.v1', data.channel, row.id])).digest('hex');
            const replies = await tx.get(db.collection(EXTERNAL_INBOX_REPLY_WORKFLOWS).where('sourceHash', '==', sourceHash).limit(51));
            if (replies.docs.length > 50 || replies.docs.some(reply => !removableReply(reply, sourceHash, row.id, data, cutoff(record, checkedAtMs)))) return 'blocked';
            const committedAtMs = now();
            if (!validTime(committedAtMs) || committedAtMs < checkedAtMs) return 'blocked';
            // No provider calls and no reservation/payment/complaint collection is touched.
            // Confirmed ordinary reply copies/keys expire with their case, never by a global receipt sweep.
            for (const reply of replies.docs) tx.delete(reply.ref);
            tx.delete(row.ref);
            return 'purged';
          });
        } catch { outcome = 'blocked'; }
        counts[outcome]++;
        if (outcome === 'blocked') { interrupted = true; break; }
      }
      if (interrupted) continue;
      await db.runTransaction(async tx => {
        const snap = await tx.get(candidate.ref);
        const record = snap.exists ? snap.data() : null;
        const checkedAtMs = now();
        if (!validTime(checkedAtMs) || checkedAtMs < startedAtMs || !record
          || record.revision !== expected.revision || !due(record, candidate.id, checkedAtMs)) { counts.blocked++; return; }
        const finished = page.docs.length < messageLimit;
        const cursor = finished ? '' : page.docs[page.docs.length - 1].id;
        if (cursor && !HASH.test(cursor)) { counts.blocked++; return; }
        // New ingestion rejects source messages older than 30 days independently of this document.
        // A fully expired/cleared case therefore needs no indefinite identifying tombstone.
        if (finished && record.status === 'closed' && record.deleteAfterMs <= checkedAtMs) { tx.delete(candidate.ref); return; }
        tx.set(candidate.ref, { ...record, cleanupCursor: cursor,
          cleanupDueAtMs: finished ? record.status === 'closed' ? record.deleteAfterMs : 0 : record.cleanupDueAtMs,
          expiredThroughMs: Math.max(record.expiredThroughMs, cutoff(record, checkedAtMs)) });
      });
    }
  } catch { return { ...counts, ok: false, code: 'RETENTION_SWEEP_UNAVAILABLE' }; }
  return counts.blocked ? { ...counts, ok: false, code: 'RETENTION_REVIEW_REQUIRED' } : counts;
}
