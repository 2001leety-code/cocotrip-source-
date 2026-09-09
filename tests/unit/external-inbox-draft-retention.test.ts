import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { EXTERNAL_INBOX_REPLY_POLICY_VERSION } from '../../api/_shared/external-inbox-reply-policy.js';
import { EXTERNAL_INBOX_DRAFT_RETENTION_MS, EXTERNAL_INBOX_REPLY_WORKFLOWS,
  prepareExternalInboxReplyDraft } from '../../api/_shared/external-inbox-reply-workflow.js';
import { purgeExpiredExternalInboxDrafts } from '../../api/_shared/external-inbox-draft-retention.js';
import { prepareExternalInboxMessage, EXTERNAL_INBOX_MESSAGES_COLLECTION } from '../../api/_shared/external-inbox-store.js';
import { INBOX_CASES_COLLECTION, nextInboxCaseOnMessage, transitionInboxCase } from '../../api/_shared/external-inbox-retention.js';

const NOW = Date.parse('2026-09-09T08:00:00Z');
const key = '12345678-1234-4234-8234-123456789abc';
const COMPANY = 'cocotripkr@gmail.com';
const configs = { email: { ready: true, accountId: COMPANY, captureStartAtMs: NOW - 86_400_000 } };

function source() {
  return prepareExternalInboxMessage({ channel: 'email', accountId: COMPANY, providerMessageId: 'mail123', providerThreadId: 'thread123',
    sourceAtMs: NOW - 1000, sender: 'guest@example.invalid', subject: 'Travel inquiry', text: 'Synthetic source body', kind: 'email', truncated: true },
  { nowMs: NOW, retentionDays: 30 });
}

function replyInput(db: ReturnType<typeof createFakeFirestore>, prepared = source()) {
  const request = { messageId: prepared.docId, channel: 'email', text: 'SYNTHETIC_DRAFT_BODY', expectedSourceAtMs: prepared.data.sourceAtMs, key };
  const envelope = { messageId: request.messageId, channel: 'email', accountId: COMPANY, providerMessageId: prepared.data.providerMessageId,
    recipient: 'guest@example.invalid', sourceAtMs: prepared.data.sourceAtMs, receivedAtMs: prepared.data.receivedAtMs, captureStartAtMs: configs.email.captureStartAtMs,
    expiresAtMs: NOW + EXTERNAL_INBOX_DRAFT_RETENTION_MS + 86_400_000, consentVersion: 'support-reply.v1',
    policy: { version: EXTERNAL_INBOX_REPLY_POLICY_VERSION, accountId: COMPANY, accountVerified: true,
    recipientVerified: true, direction: 'inbound', live: true, isEcho: false,
    email: { contextVerified: true, singleMailbox: true, headerControls: false, autoSubmitted: false,
      listHeader: false, noReply: false, ambiguous: false, threadId: 'thread123', rfcMessageId: '<mail123@example.invalid>',
      subject: 'Travel inquiry', references: [] as string[] } } };
  return { request, envelope, prepared };
}

function fixture() {
  const prepared = source(); const inboxCase = nextInboxCaseOnMessage(null, prepared.data, NOW);
  const db = createFakeFirestore({ [`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${prepared.docId}`]: structuredClone(prepared.data),
    [`${INBOX_CASES_COLLECTION}/${prepared.data.caseId}`]: inboxCase });
  const input = replyInput(db, prepared);
  return { db, request: structuredClone(input.request), actorUid: 'synthetic-owner', flags: { replyEnabled: true }, now: () => NOW,
    prepared, inboxCase, resolveEnvelope: async () => structuredClone(input.envelope) };
}
const records = (db: ReturnType<typeof createFakeFirestore>) => Object.entries(db.__dump())
  .filter(([path]) => path.startsWith(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-`));
const record = (db: ReturnType<typeof createFakeFirestore>) => records(db)[0][1] as Record<string, unknown>;
const recordPath = (db: ReturnType<typeof createFakeFirestore>) => records(db)[0][0];
async function draft(input = fixture()) {
  expect((await prepareExternalInboxReplyDraft(input)).code).toBe('DRAFT_PREPARED');
  return input;
}
const purge = (input: ReturnType<typeof fixture>, now = NOW + EXTERNAL_INBOX_DRAFT_RETENTION_MS) => purgeExpiredExternalInboxDrafts({ db: input.db, configs, now });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('external inbox unsent-draft retention', () => {
  it('purges only the expired unattempted draft into a PII-free source-locking tombstone', async () => {
    const input = await draft(); const result = await purge(input);
    expect(result).toEqual({ ok: true, code: 'RETENTION_COMPLETED', selected: 1, purged: 1, skipped: 0 });
    const tombstone = record(input.db);
    expect(tombstone.kind).toBe('reply_purged'); expect(tombstone.status).toBe('purged');
    for (const keyName of ['request', 'envelope', 'approval', 'providerReceiptHash', 'attemptId', 'draftHash']) expect(tombstone).not.toHaveProperty(keyName);
    const serialized = JSON.stringify(tombstone);
    const envelope = await input.resolveEnvelope();
    for (const secret of [input.request.text, envelope.accountId, envelope.recipient, envelope.providerMessageId, envelope.policy.email.subject]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(input.db.__dump()).some(path => path.includes('/key-'))).toBe(true);
    expect((await prepareExternalInboxReplyDraft(input)).code).toBe('LEDGER_CONFLICT');
  });

  it('uses createdAt plus seven days for legacy drafts and skips unknown structures', async () => {
    const input = await draft();
    input.db.__patch(recordPath(input.db), { draftExpiresAtMs: undefined });
    input.db.__set(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-unknown`, { status: 'draft', createdAtMs: NOW - EXTERNAL_INBOX_DRAFT_RETENTION_MS });
    const result = await purge(input);
    expect(result).toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', purged: 1 });
    expect(input.db.__get(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-unknown`)).toEqual({ status: 'draft', createdAtMs: NOW - EXTERNAL_INBOX_DRAFT_RETENTION_MS });
  });

  it('uses creation plus seven days for an open v2 case whose source deadline is deliberately zero', async () => {
    const input = fixture();
    const legacyEnvelope = replyInput(input.db, input.prepared).envelope;
    input.resolveEnvelope = async () => ({ ...legacyEnvelope, expiresAtMs: 0,
      consentVersion: 'company-gmail-reply.v2', policy: { ...legacyEnvelope.policy,
        retention: { policyVersion: 2, caseId: input.prepared.data.caseId, revision: input.inboxCase.revision, status: 'open', deleteAfterMs: 0 } } });
    await draft(input);
    expect(record(input.db)).toMatchObject({ expiresAtMs: 0, draftExpiresAtMs: NOW + EXTERNAL_INBOX_DRAFT_RETENTION_MS });
    expect(await purge(input)).toEqual({ ok: true, code: 'RETENTION_COMPLETED', selected: 1, purged: 1, skipped: 0 });
  });

  it('rechecks inside the transaction and protects sending or otherwise changed records', async () => {
    const input = await draft(); let changed = false;
    input.db.__beforeCommit = async () => {
      if (changed) return;
      changed = true;
      input.db.__patch(recordPath(input.db), { status: 'sending', attempts: 1, approvalConsumed: true,
        attemptId: '12345678-1234-4234-8234-123456789abc', retryAllowed: false });
    };
    const result = await purge(input);
    expect(result).toEqual({ ok: true, code: 'RETENTION_COMPLETED', selected: 1, purged: 0, skipped: 1 });
    expect(record(input.db).status).toBe('sending');
  });

  it('keeps an expired draft when its owned case is protected, without treating protection as a purge error', async () => {
    const input = await draft();
    const protectedCase = transitionInboxCase(input.inboxCase, { action: 'protect', expectedRevision: input.inboxCase.revision, nowMs: NOW + 1 });
    input.db.__patch(`${INBOX_CASES_COLLECTION}/${input.prepared.data.caseId}`, protectedCase);
    expect(await purge(input)).toEqual({ ok: true, code: 'RETENTION_COMPLETED', selected: 1, purged: 0, skipped: 1 });
    expect(record(input.db).kind).toBe('reply');
  });

  it.each(['missing_source', 'foreign_source', 'legacy_source', 'missing_case', 'malformed_case', 'future_case'])('does not erase an expired draft when its %s cannot prove company v2 ownership', async mode => {
    const input = await draft();
    const sourcePath = `${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${input.prepared.docId}`;
    const casePath = `${INBOX_CASES_COLLECTION}/${input.prepared.data.caseId}`;
    if (mode === 'missing_source') input.db.__delete(sourcePath);
    if (mode === 'foreign_source') input.db.__patch(sourcePath, { ...input.prepared.data, accountId: 'other@example.invalid' });
    if (mode === 'legacy_source') input.db.__patch(sourcePath, { ...input.prepared.data, retentionPolicyVersion: undefined });
    if (mode === 'missing_case') input.db.__delete(casePath);
    if (mode === 'malformed_case') input.db.__patch(casePath, { status: 'not_a_case_status' });
    if (mode === 'future_case') input.db.__patch(casePath, nextInboxCaseOnMessage(input.inboxCase, input.prepared.data,
      NOW + EXTERNAL_INBOX_DRAFT_RETENTION_MS + 1));
    expect(await purge(input)).toEqual({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', selected: 1, purged: 0, skipped: 1 });
    expect(record(input.db).kind).toBe('reply');
  });

  it('skips a stale, source-hash, request, envelope, or document-ID mismatch without deleting evidence', async () => {
    const input = await draft(); const original = structuredClone(record(input.db));
    input.db.__patch(recordPath(input.db), { sourceHash: 'b'.repeat(64) });
    const result = await purge(input);
    expect(result).toEqual({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', selected: 1, purged: 0, skipped: 1 });
    expect(record(input.db)).toMatchObject({ kind: 'reply', sourceHash: 'b'.repeat(64), request: original.request, envelope: original.envelope });
  });

  it('keeps bounded queries and returns only count fields for invalid dependencies', async () => {
    const input = await draft();
    expect(await purgeExpiredExternalInboxDrafts({ db: input.db, configs, now: NOW + EXTERNAL_INBOX_DRAFT_RETENTION_MS, limit: 51 }))
      .toEqual({ ok: false, code: 'RETENTION_LIMIT_INVALID', selected: 0, purged: 0, skipped: 0 });
    expect(await purgeExpiredExternalInboxDrafts({ db: null, configs, now: NOW })).toEqual({ ok: false, code: 'RETENTION_DEPENDENCY_INVALID', selected: 0, purged: 0, skipped: 0 });
    expect(await purgeExpiredExternalInboxDrafts({ db: input.db, now: NOW })).toEqual({ ok: false, code: 'RETENTION_DEPENDENCY_INVALID', selected: 0, purged: 0, skipped: 0 });
  });

  it('does not report transaction failure as successful deletion', async () => {
    const input = await draft();
    input.db.runTransaction = async () => { throw new Error('PRIVATE_DATABASE_ERROR'); };
    const result = await purge(input);
    expect(result).toEqual({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', selected: 1, purged: 0, skipped: 1 });
    expect(record(input.db).kind).toBe('reply');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DATABASE_ERROR');
  });
});
