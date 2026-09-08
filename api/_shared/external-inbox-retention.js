import { createHash } from 'node:crypto';

export const INBOX_CASES_COLLECTION = 'external_inbox_cases';
export const RETENTION_POLICY_VERSION = 2;
export const INBOX_CLOSED_RETENTION_DAYS = 30;
export const INBOX_DRAFT_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;
const MONTH_MS = INBOX_CLOSED_RETENTION_DAYS * DAY_MS;
const MAX_TIME = 8_640_000_000_000_000;
const HASH = /^[a-f0-9]{64}$/;
const time = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_TIME - MONTH_MS;
const zeroTime = value => value === 0 || time(value);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value === value.trim() && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Hash is an opaque routing identifier, not a claim that data is anonymous. */
export function inboxCaseId(data) {
  if (!object(data) || !['email', 'whatsapp'].includes(data.channel)
    || ![data.accountId, data.providerThreadId].every(identifier)) fail('INBOX_CASE_ID_INVALID');
  return createHash('sha256').update(JSON.stringify(['external-inbox.case.v2', data.channel,
    data.accountId, data.providerThreadId])).digest('hex');
}

export function validInboxCase(record, id) {
  if (!object(record) || !HASH.test(id || '') || record.caseId !== id || record.policyVersion !== RETENTION_POLICY_VERSION
    || !['open', 'closed', 'protected'].includes(record.status) || !Number.isSafeInteger(record.revision) || record.revision < 1
    || ![record.createdAtMs, record.lastActivityAtMs, record.updatedAtMs, record.reviewAfterMs].every(time)
    || record.createdAtMs > record.lastActivityAtMs || record.lastActivityAtMs > record.updatedAtMs
    || record.reviewAfterMs !== record.updatedAtMs + MONTH_MS
    || ![record.closedAtMs, record.deleteAfterMs, record.expiredThroughMs, record.cleanupDueAtMs].every(zeroTime)
    || record.expiredThroughMs > record.updatedAtMs
    || !(record.cleanupCursor === '' || HASH.test(record.cleanupCursor || ''))) return false;
  if (record.status === 'closed') return record.closedAtMs >= record.lastActivityAtMs && record.closedAtMs <= record.updatedAtMs
    && record.deleteAfterMs === record.closedAtMs + MONTH_MS && record.closureBasis === 'ordinary_no_evidence'
    && (record.cleanupDueAtMs === 0 || record.cleanupDueAtMs <= record.deleteAfterMs);
  return record.closedAtMs === 0 && record.deleteAfterMs === 0 && record.closureBasis === ''
    && (record.status !== 'protected' || record.cleanupDueAtMs === 0);
}

/** Called ONLY for a fresh, consent-checked message, in the message writer's transaction. */
export function nextInboxCaseOnMessage(previous, data, nowMs) {
  const caseId = inboxCaseId(data);
  if (!time(nowMs) || !time(data.sourceAtMs) || data.sourceAtMs > nowMs) fail('INBOX_CASE_TIME_INVALID');
  if (previous && (!validInboxCase(previous, caseId) || previous.updatedAtMs > nowMs)) fail('INBOX_CASE_INVALID');
  const expiredThroughMs = Math.max(previous ? previous.expiredThroughMs : 0,
    previous && previous.status === 'closed' && previous.deleteAfterMs <= nowMs ? previous.closedAtMs : 0);
  const status = previous && previous.status === 'protected' ? 'protected' : 'open';
  return { policyVersion: RETENTION_POLICY_VERSION, caseId, status,
    revision: previous ? previous.revision + 1 : 1,
    createdAtMs: previous ? previous.createdAtMs : nowMs, lastActivityAtMs: nowMs, updatedAtMs: nowMs,
    reviewAfterMs: nowMs + MONTH_MS, closedAtMs: 0, deleteAfterMs: 0, closureBasis: '',
    expiredThroughMs, cleanupDueAtMs: status === 'open' && expiredThroughMs > 0 ? nowMs : 0, cleanupCursor: '' };
}

export function inboxCaseAllowsRead(record, id, nowMs, message) {
  if (!validInboxCase(record, id) || !time(nowMs) || record.updatedAtMs > nowMs) return false;
  if (record.status === 'closed' && record.deleteAfterMs <= nowMs) return false;
  // A late new message must not resurrect already-expired earlier text.
  if (message && (!time(message.receivedAtMs) || message.receivedAtMs <= record.expiredThroughMs)) return false;
  return true;
}

export function publicInboxCase(record, nowMs) {
  if (!validInboxCase(record, record && record.caseId) || !time(nowMs) || record.updatedAtMs > nowMs) return null;
  return { caseId: record.caseId, status: record.status, revision: record.revision,
    closedAtMs: record.closedAtMs, deleteAfterMs: record.deleteAfterMs,
    reviewRequired: record.status !== 'closed' && record.reviewAfterMs <= nowMs };
}

export function transitionInboxCase(record, { action, expectedRevision, confirmation, nowMs }) {
  if (!validInboxCase(record, record && record.caseId) || !time(nowMs) || record.updatedAtMs > nowMs) fail('INBOX_CASE_INVALID');
  if (record.revision !== expectedRevision) fail('INBOX_CASE_CONFLICT');
  if (!['close', 'reopen', 'protect'].includes(action)) fail('INBOX_CASE_ACTION_INVALID');
  if (record.status === 'closed' && record.deleteAfterMs <= nowMs) fail('INBOX_CASE_EXPIRED');
  // Releasing a legal/evidence hold is a separate verified archive workflow, not a toggle.
  if (record.status === 'protected' && action !== 'protect') fail('INBOX_EVIDENCE_REVIEW_REQUIRED');
  if (action === 'close' && (record.status !== 'open' || confirmation !== 'ordinary_no_evidence')) fail('INBOX_CLOSURE_CONFIRMATION_REQUIRED');
  if (action !== 'close' && confirmation !== undefined) fail('INBOX_CASE_ACTION_INVALID');
  if ((action === 'protect' && record.status === 'protected') || (action === 'reopen' && record.status === 'open')) return record;
  const status = action === 'close' ? 'closed' : action === 'protect' ? 'protected' : 'open';
  return { ...record, status, revision: record.revision + 1, updatedAtMs: nowMs, reviewAfterMs: nowMs + MONTH_MS,
    closedAtMs: status === 'closed' ? nowMs : 0, deleteAfterMs: status === 'closed' ? nowMs + MONTH_MS : 0,
    closureBasis: status === 'closed' ? 'ordinary_no_evidence' : '', cleanupCursor: '',
    cleanupDueAtMs: status === 'protected' ? 0 : record.expiredThroughMs > 0 ? nowMs : status === 'closed' ? nowMs + MONTH_MS : 0 };
}

export function validInboxRetentionRequest(input) {
  if (!object(input) || !HASH.test(input.messageId || '') || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 1 || !['close', 'reopen', 'protect'].includes(input.action)) return false;
  const keys = ['messageId', 'expectedRevision', 'action'];
  if (input.action === 'close') keys.push('confirmation');
  return Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key))
    && (input.action !== 'close' || input.confirmation === 'ordinary_no_evidence');
}
