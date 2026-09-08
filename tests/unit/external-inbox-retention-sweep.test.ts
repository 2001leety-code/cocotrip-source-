import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { purgeExpiredExternalInboxCopies } from '../../api/_shared/external-inbox-retention-sweep.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import {
  INBOX_CASES_COLLECTION, nextInboxCaseOnMessage, transitionInboxCase,
} from '../../api/_shared/external-inbox-retention.js';
import { EXTERNAL_INBOX_REPLY_POLICY_VERSION } from '../../api/_shared/external-inbox-reply-policy.js';
import {
  approveExternalInboxReplyDraft, dispatchExternalInboxReply, EXTERNAL_INBOX_REPLY_WORKFLOWS, prepareExternalInboxReplyDraft,
} from '../../api/_shared/external-inbox-reply-workflow.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-09T00:00:00.000Z');
const ACCOUNT = 'cocotripkr@gmail.com';
const CONFIGS = { email: { ready: true, accountId: ACCOUNT, captureStartAtMs: NOW - 90 * DAY } };
const MESSAGE_COLLECTION = 'external_inbox_messages';

type Data = Record<string, unknown>;
type Ref = { id: string; path: string };
type DocSnapshot = { id: string; ref: Ref; exists: boolean; data: () => Data | undefined };
type QuerySnapshot = { docs: DocSnapshot[] };
type Hook = (input: { call: number; db: ReturnType<typeof memoryDb> }) => void | Promise<void>;

function clone<T>(value: T): T { return structuredClone(value); }

/** Narrow Firestore double for the sweep's ordered due queue and message pages. */
function memoryDb(seed: Record<string, Data> = {}, hook: Hook | null = null) {
  const rows = new Map<string, Data>(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  let transactions = 0;
  const ref = (path: string): Ref => ({ path, id: path.split('/').at(-1) || '' });
  const snapshot = (path: string): DocSnapshot => ({ id: ref(path).id, ref: ref(path), exists: rows.has(path), data: () => clone(rows.get(path)) });
  const collection = (name: string, filters: { field: string; operator: string; value: unknown }[] = [], order = '', after = '', limit = 0) => {
    const query = {
      doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, operator: string, value: unknown) => collection(name, [...filters, { field, operator, value }], order, after, limit),
      orderBy: (field: string) => collection(name, filters, field, after, limit),
      startAfter: (id: string) => collection(name, filters, order, id, limit),
      limit: (amount: number) => collection(name, filters, order, after, amount),
      get: async () => {
        let entries = [...rows.entries()].filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/'));
        entries = entries.filter(([, data]) => filters.every(({ field, operator, value }) => {
          const actual = data[field];
          return operator === '==' ? actual === value : operator === '>' ? Number(actual) > Number(value) : operator === '<=' ? Number(actual) <= Number(value) : false;
        }));
        entries.sort(([leftPath, left], [rightPath, right]) => {
          if (order === '__name__') return leftPath.localeCompare(rightPath);
          if (order) return Number(left[order]) - Number(right[order]) || leftPath.localeCompare(rightPath);
          return leftPath.localeCompare(rightPath);
        });
        if (after) entries = entries.filter(([path]) => ref(path).id > after);
        if (limit) entries = entries.slice(0, limit);
        return { docs: entries.map(([path]) => snapshot(path)) };
      },
    };
    return query;
  };
  const db = {
    collection: (name: string) => collection(name),
    runTransaction: async <T,>(work: (tx: { get: (item: Ref | { get: () => Promise<QuerySnapshot> }) => Promise<DocSnapshot | QuerySnapshot>; delete: (item: Ref) => void; set: (item: Ref, data: Data) => void }) => Promise<T>) => {
      transactions += 1;
      if (hook) await hook({ call: transactions, db });
      const writes: { kind: 'delete' | 'set'; path: string; data?: Data }[] = [];
      const result = await work({
        get: async item => 'path' in item ? snapshot(item.path) : item.get(),
        delete: item => { writes.push({ kind: 'delete', path: item.path }); },
        set: (item, data) => { writes.push({ kind: 'set', path: item.path, data: clone(data) }); },
      });
      for (const write of writes) {
        if (write.kind === 'delete') rows.delete(write.path);
        else rows.set(write.path, clone(write.data || {}));
      }
      return result;
    },
    __get: (path: string) => clone(rows.get(path)),
    __patch: (path: string, data: Data) => rows.set(path, clone(data)),
    __paths: () => [...rows.keys()].sort(),
  };
  return db;
}

function source(providerMessageId: string, thread = 'thread-1', preparedAtMs = NOW - 30 * DAY - 1) {
  return prepareExternalInboxMessage({ channel: 'email', accountId: ACCOUNT, providerMessageId, providerThreadId: thread,
    sourceAtMs: preparedAtMs - 1, sender: 'synthetic@example.invalid', subject: 'Synthetic', text: 'Synthetic body', kind: 'email', truncated: true },
  { nowMs: preparedAtMs, retentionDays: 90 });
}

function closedCase(first: ReturnType<typeof source>, closedAtMs = NOW - 30 * DAY) {
  const opened = nextInboxCaseOnMessage(null, first.data, closedAtMs - 1);
  return transitionInboxCase(opened, { action: 'close', expectedRevision: opened.revision, confirmation: 'ordinary_no_evidence', nowMs: closedAtMs });
}

function seedCase(caseData: Data, messages: ReturnType<typeof source>[]) {
  return Object.fromEntries([
    [`${INBOX_CASES_COLLECTION}/${caseData.caseId}`, caseData],
    ...messages.map(message => [`${MESSAGE_COLLECTION}/${message.docId}`, message.data]),
  ]);
}

const replySourceHash = (messageId: string) => createHash('sha256')
  .update(JSON.stringify(['external-inbox-reply.source.v1', 'email', messageId])).digest('hex');

async function addReplyLedger(db: ReturnType<typeof memoryDb>, message: ReturnType<typeof source>, nowMs: number, status: 'draft' | 'approved' | 'provider_accepted' = 'draft') {
  const key = `${message.docId.slice(0, 8)}-0000-4000-8000-000000000000`;
  const request = { messageId: message.docId, channel: 'email', text: 'Synthetic approved reply', expectedSourceAtMs: message.data.sourceAtMs, key };
  const envelope = { messageId: message.docId, channel: 'email', accountId: message.data.accountId,
    providerMessageId: message.data.providerMessageId, recipient: 'guest@example.invalid', sourceAtMs: message.data.sourceAtMs,
    receivedAtMs: message.data.receivedAtMs, captureStartAtMs: CONFIGS.email.captureStartAtMs, expiresAtMs: nowMs + DAY,
    consentVersion: 'support-reply.v1', policy: { version: EXTERNAL_INBOX_REPLY_POLICY_VERSION, accountId: message.data.accountId,
      accountVerified: true, recipientVerified: true, direction: 'inbound', live: true, isEcho: false,
      email: { contextVerified: true, singleMailbox: true, headerControls: false, autoSubmitted: false, listHeader: false,
        noReply: false, ambiguous: false, threadId: 'syntheticthread', rfcMessageId: '<synthetic@example.invalid>', subject: 'Synthetic', references: [] } } };
  const input = { db, request, actorUid: 'synthetic-owner', flags: { replyEnabled: true, dispatchEnabled: true }, now: () => nowMs,
    resolveEnvelope: async () => envelope, send: async () => ({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'synthetic-receipt' }) };
  const drafted = await prepareExternalInboxReplyDraft(input);
  expect(drafted).toMatchObject({ ok: true, revision: 1 });
  if (status === 'draft') return;
  const approved = await approveExternalInboxReplyDraft({ ...input, humanApproved: true, expectedRevision: drafted.revision, expectedDraftHash: drafted.draftHash });
  expect(approved).toMatchObject({ ok: true, revision: 1 });
  if (status === 'approved') return;
  expect(await dispatchExternalInboxReply({ ...input, humanApproved: true, expectedRevision: approved.revision, expectedDraftHash: drafted.draftHash }))
    .toMatchObject({ ok: true, status: 'provider_accepted' });
}

describe('external inbox retention sweep', () => {
  it('deletes scoped copies and the final ordinary closed-case metadata exactly at the 30-day boundary', async () => {
    const message = source('exact'); const inboxCase = closedCase(message);
    const db = memoryDb(seedCase(inboxCase, [message]));
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => inboxCase.deleteAfterMs }))
      .toMatchObject({ ok: true, code: 'RETENTION_COMPLETED', cases: 1, purged: 1, kept: 0 });
    expect(db.__paths()).toEqual([]);
    expect(() => prepareExternalInboxMessage({ channel: 'email', accountId: ACCOUNT, providerMessageId: 'exact', providerThreadId: 'thread-1',
      sourceAtMs: NOW - 30 * DAY - 2, sender: 'synthetic@example.invalid', subject: '', text: '', kind: 'email' },
    { nowMs: inboxCase.deleteAfterMs, retentionDays: 90 })).toThrow('INBOX_MESSAGE_EXPIRED');
  });

  it('does not scan or delete an ordinary case before its exact deadline', async () => {
    const message = source('before'); const inboxCase = closedCase(message);
    const db = memoryDb(seedCase(inboxCase, [message]));
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => inboxCase.deleteAfterMs - 1 }))
      .toMatchObject({ ok: true, cases: 0, purged: 0 });
    expect(db.__paths()).toHaveLength(2);
  });

  it('leaves legacy, foreign, protected and malformed records untouched', async () => {
    const legacy = source('legacy', 'thread-legacy'); const legacyCase = closedCase(legacy);
    const foreign = source('foreign', 'thread-foreign'); const foreignCase = closedCase(foreign);
    const protectedMessage = source('protected', 'thread-protected'); const protectedOpen = nextInboxCaseOnMessage(null, protectedMessage.data, NOW - DAY);
    const protectedCase = transitionInboxCase(protectedOpen, { action: 'protect', expectedRevision: protectedOpen.revision, nowMs: NOW - DAY + 1 });
    const legacyData = { ...legacy.data, retentionPolicyVersion: undefined };
    const foreignData = { ...foreign.data, accountId: 'other@example.invalid' };
    const seed = {
      ...seedCase(legacyCase, [{ ...legacy, data: legacyData }]),
      ...seedCase(foreignCase, [{ ...foreign, data: foreignData }]),
      ...seedCase(protectedCase, [protectedMessage]),
      [`${INBOX_CASES_COLLECTION}/${'c'.repeat(64)}`]: { cleanupDueAtMs: NOW },
    };
    const db = memoryDb(seed);
    const result = await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED' });
    expect(db.__paths()).toContain(`${MESSAGE_COLLECTION}/${legacy.docId}`);
    expect(db.__paths()).toContain(`${MESSAGE_COLLECTION}/${foreign.docId}`);
    expect(db.__paths()).toContain(`${INBOX_CASES_COLLECTION}/${protectedCase.caseId}`);
    expect(db.__paths()).toContain(`${INBOX_CASES_COLLECTION}/${'c'.repeat(64)}`);
  });

  it.each(['reopen', 'protect'] as const)('stops when a scan candidate is changed to %s before its message transaction', async action => {
    const message = source(`race-${action}`, `thread-race-${action}`, NOW - DAY);
    const closed = { ...closedCase(message, NOW - 10), expiredThroughMs: NOW - 10, cleanupDueAtMs: NOW };
    let changed = false;
    const db = memoryDb(seedCase(closed, [message]), ({ call, db: store }) => {
      if (call !== 1 || changed) return;
      changed = true;
      const current = store.__get(`${INBOX_CASES_COLLECTION}/${closed.caseId}`) as Data;
      store.__patch(`${INBOX_CASES_COLLECTION}/${closed.caseId}`, transitionInboxCase(current, {
        action, expectedRevision: Number(current.revision), nowMs: NOW,
      }));
    });
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => NOW }))
      .toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', purged: 0, blocked: 1 });
    expect(db.__paths()).toContain(`${MESSAGE_COLLECTION}/${message.docId}`);
    expect(db.__get(`${INBOX_CASES_COLLECTION}/${closed.caseId}`)?.status).toBe(action === 'reopen' ? 'open' : 'protected');
  });

  it('after a late new inquiry deletes only copies at expiredThrough and keeps the reopened case', async () => {
    const old = source('old', 'thread-reopened', NOW - 31 * DAY);
    const closed = closedCase(old, NOW - 30 * DAY);
    const fresh = source('fresh', 'thread-reopened', NOW);
    const reopened = nextInboxCaseOnMessage(closed, fresh.data, NOW);
    const db = memoryDb(seedCase(reopened, [old, fresh]));
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => NOW }))
      .toMatchObject({ ok: true, purged: 1, kept: 1 });
    expect(db.__paths()).not.toContain(`${MESSAGE_COLLECTION}/${old.docId}`);
    expect(db.__paths()).toContain(`${MESSAGE_COLLECTION}/${fresh.docId}`);
    expect(db.__get(`${INBOX_CASES_COLLECTION}/${reopened.caseId}`)).toMatchObject({ status: 'open', cleanupDueAtMs: 0, expiredThroughMs: closed.closedAtMs });
  });

  it('keeps a newly closed case and moves its old-cutoff cleanup to the new delete deadline', async () => {
    const message = source('new-close', 'thread-new-close', NOW - DAY);
    const original = closedCase(message, NOW - 10);
    const inboxCase = { ...original, expiredThroughMs: original.closedAtMs, cleanupDueAtMs: NOW };
    const db = memoryDb(seedCase(inboxCase, [message]));
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => NOW }))
      .toMatchObject({ ok: true, purged: 1, kept: 0 });
    expect(db.__get(`${INBOX_CASES_COLLECTION}/${inboxCase.caseId}`))
      .toMatchObject({ status: 'closed', cleanupDueAtMs: original.deleteAfterMs, expiredThroughMs: original.closedAtMs });
  });

  it('deletes only source-bound eligible draft, approved, provider-accepted and reply-purged copies with their closed case', async () => {
    const messages = ['draft', 'approved', 'accepted', 'purged'].map(id => source(id, 'thread-replies'));
    const inboxCase = closedCase(messages[0]);
    const db = memoryDb(seedCase(inboxCase, messages));
    await addReplyLedger(db, messages[0], inboxCase.closedAtMs, 'draft');
    await addReplyLedger(db, messages[1], inboxCase.closedAtMs, 'approved');
    await addReplyLedger(db, messages[2], inboxCase.closedAtMs, 'provider_accepted');
    const purgedHash = replySourceHash(messages[3].docId);
    db.__patch(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-${purgedHash}`, { schemaVersion: 1, kind: 'reply_purged', status: 'purged',
      sourceHash: purgedHash, actorHash: 'a'.repeat(64), createdAtMs: inboxCase.closedAtMs, draftExpiresAtMs: inboxCase.closedAtMs,
      purgedAtMs: inboxCase.closedAtMs, retentionVersion: 1 });
    const globalPath = `${EXTERNAL_INBOX_REPLY_WORKFLOWS}/key-${'f'.repeat(64)}`;
    db.__patch(globalPath, { schemaVersion: 1, kind: 'key', sourceHash: 'e'.repeat(64), actorHash: 'a'.repeat(64), draftHash: 'b'.repeat(64), expiresAtMs: NOW });
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => inboxCase.deleteAfterMs, messageLimit: 10 }))
      .toMatchObject({ ok: true, purged: 4, blocked: 0 });
    expect(db.__paths()).toEqual([globalPath]);
  });

  it('blocks oversized, uncertain, newer-than-closure and malformed reply ledgers without deleting their sources', async () => {
    const many = source('many', 'thread-many'); const unknown = source('unknown', 'thread-unknown');
    const sending = source('sending', 'thread-sending'); const newer = source('newer', 'thread-newer'); const malformed = source('malformed', 'thread-malformed');
    const cases = [many, unknown, sending, newer, malformed].map(message => closedCase(message));
    const db = memoryDb({
      ...seedCase(cases[0], [many]), ...seedCase(cases[1], [unknown]), ...seedCase(cases[2], [sending]), ...seedCase(cases[3], [newer]), ...seedCase(cases[4], [malformed]),
    });
    const manyHash = replySourceHash(many.docId);
    for (let index = 0; index < 51; index += 1) {
      const id = createHash('sha256').update(`many-${index}`).digest('hex');
      db.__patch(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/key-${id}`, { schemaVersion: 1, kind: 'key', sourceHash: manyHash,
        actorHash: 'a'.repeat(64), draftHash: 'b'.repeat(64), expiresAtMs: NOW });
    }
    await addReplyLedger(db, unknown, cases[1].closedAtMs, 'provider_accepted');
    const unknownPath = `${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-${replySourceHash(unknown.docId)}`;
    db.__patch(unknownPath, { ...db.__get(unknownPath), status: 'outcome_unknown' });
    await addReplyLedger(db, sending, cases[2].closedAtMs, 'provider_accepted');
    const sendingPath = `${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-${replySourceHash(sending.docId)}`;
    db.__patch(sendingPath, { ...db.__get(sendingPath), status: 'sending' });
    await addReplyLedger(db, newer, cases[3].closedAtMs, 'draft');
    const newerPath = `${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-${replySourceHash(newer.docId)}`;
    db.__patch(newerPath, { ...db.__get(newerPath), updatedAtMs: cases[3].closedAtMs + 1 });
    db.__patch(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-${replySourceHash(malformed.docId)}`, { kind: 'reply', sourceHash: replySourceHash(malformed.docId) });
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => NOW, caseLimit: 10 }))
      .toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', purged: 0, blocked: 5 });
    for (const message of [many, unknown, sending, newer, malformed]) expect(db.__paths()).toContain(`${MESSAGE_COLLECTION}/${message.docId}`);
  });

  it('uses a bounded document-id cursor across pages and never advances it after a mid-page failure', async () => {
    const messages = ['a', 'b', 'c'].map(id => source(id, 'thread-pages'));
    const inboxCase = closedCase(messages[0]);
    const db = memoryDb(seedCase(inboxCase, messages));
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => inboxCase.deleteAfterMs, messageLimit: 2 }))
      .toMatchObject({ ok: true, purged: 2 });
    const partial = db.__get(`${INBOX_CASES_COLLECTION}/${inboxCase.caseId}`);
    expect(partial.cleanupCursor).toMatch(/^[a-f0-9]{64}$/);
    expect(await purgeExpiredExternalInboxCopies({ db, configs: CONFIGS, now: () => inboxCase.deleteAfterMs, messageLimit: 2 }))
      .toMatchObject({ ok: true, purged: 1 });
    expect(db.__paths()).toEqual([]);

    const failedCase = closedCase(messages[0]);
    const failureDb = memoryDb(seedCase(failedCase, messages), ({ call }) => { if (call === 2) throw new Error('synthetic mid-page failure'); });
    expect(await purgeExpiredExternalInboxCopies({ db: failureDb, configs: CONFIGS, now: () => failedCase.deleteAfterMs, messageLimit: 2 }))
      .toMatchObject({ ok: false, code: 'RETENTION_REVIEW_REQUIRED', purged: 1, blocked: 1 });
    expect(failureDb.__get(`${INBOX_CASES_COLLECTION}/${failedCase.caseId}`)?.cleanupCursor).toBe('');
  });
});
