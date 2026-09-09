import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import { inboxCaseId, nextInboxCaseOnMessage, transitionInboxCase } from '../../api/_shared/external-inbox-retention.js';
import { normalizeCompanyGmailReplyHeaders, createCompanyGmailReplyResolver } from '../../api/_shared/company-gmail-reply-source.js';
import { approveExternalInboxReplyDraft, dispatchExternalInboxReply, prepareExternalInboxReplyDraft } from '../../api/_shared/external-inbox-reply-workflow.js';

const NOW = Date.parse('2026-09-09T01:00:00.000Z');
const ACCOUNT = 'cocotripkr@gmail.com';
const CONFIG = { ready: true, accountId: ACCOUNT, captureStartAtMs: NOW - 86_400_000 };
const KEY = '12345678-1234-4234-8234-123456789abc';
type Row = Record<string, unknown>;

function headers(extra: Row[] = []) {
  return [{ name: 'From', value: 'Guest <guest@example.invalid>' }, { name: 'Reply-To', value: 'reply@example.invalid' },
    { name: 'Message-ID', value: '<source@example.invalid>' }, { name: 'References', value: '<prior@example.invalid>' },
    { name: 'Subject', value: 'Support question' }, ...extra];
}

function source(extra: Row = {}) {
  const prepared = prepareExternalInboxMessage({ channel: 'email', accountId: ACCOUNT, providerMessageId: 'gmail-source', providerThreadId: 'thread_source',
    sourceAtMs: NOW - 10_000, sender: 'Guest <guest@example.invalid>', subject: 'Support question', text: 'SYNTHETIC_BODY', kind: 'email' },
  { nowMs: NOW, retentionDays: 30 });
  return { id: prepared.docId, data: { ...prepared.data, gmailReply: normalizeCompanyGmailReplyHeaders(headers(), 'thread_source'), ...extra } };
}

function fixture(extra: Row = {}) {
  const row = source(extra);
  const inboxCase = nextInboxCaseOnMessage(null, row.data, NOW);
  const db = createFakeFirestore({ [`external_inbox_messages/${row.id}`]: row.data, [`external_inbox_cases/${row.data.caseId}`]: inboxCase });
  let current = NOW;
  return { db, row, inboxCase, resolver: createCompanyGmailReplyResolver({ db, inboxConfig: CONFIG, now: () => current }),
    now: () => current, setNow: (value: number) => { current = value; } };
}

async function resolve(value: ReturnType<typeof fixture>) {
  return value.db.runTransaction(tx => value.resolver(tx, { messageId: value.row.id, channel: 'email' }));
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('company Gmail reply source resolver', () => {
  it('stores only normalized reply evidence and resolves an open v2 source with no invented deadline', async () => {
    const value = fixture();
    expect(value.row.data.gmailReply).toEqual({ version: 1, recipient: 'reply@example.invalid', contextVerified: true,
      singleMailbox: true, headerControls: false, autoSubmitted: false, listHeader: false, noReply: false, ambiguous: false,
      threadId: 'thread_source', rfcMessageId: '<source@example.invalid>', subject: 'Support question', references: ['<prior@example.invalid>'] });
    await expect(resolve(value)).resolves.toMatchObject({ messageId: value.row.id, channel: 'email', recipient: 'reply@example.invalid',
      expiresAtMs: 0, policy: { retention: { policyVersion: 2, caseId: value.row.data.caseId, revision: 1, status: 'open', deleteAfterMs: 0 } } });
  });

  it('accepts one safe quoted display name with escaped quote/backslash, but never a second address or folded header', () => {
    const valid = normalizeCompanyGmailReplyHeaders([{ name: 'From', value: '"Jane \\"J\\" \\\\ Doe" <jane@example.invalid>' },
      { name: 'Message-ID', value: '<source@example.invalid>' }, { name: 'References', value: '' }, { name: 'Subject', value: 'Support question' }], 'thread_source');
    expect(valid).toMatchObject({ recipient: 'jane@example.invalid', singleMailbox: true, contextVerified: true });
    for (const from of ['"Jane" <jane@example.invalid>, <other@example.invalid>', 'Jane <jane@example.invalid>\r\nBcc: other@example.invalid']) {
      expect(normalizeCompanyGmailReplyHeaders([{ name: 'From', value: from }, { name: 'Message-ID', value: '<source@example.invalid>' },
        { name: 'References', value: '' }, { name: 'Subject', value: 'Support question' }], 'thread_source')).toMatchObject({ recipient: '', contextVerified: false });
    }
  });

  it.each([
    ['duplicate headers', { gmailReply: normalizeCompanyGmailReplyHeaders(headers([{ name: 'Subject', value: 'second' }]), 'thread_source') }],
    ['duplicate Reply-To', { gmailReply: normalizeCompanyGmailReplyHeaders(headers([{ name: 'Reply-To', value: 'other@example.invalid' }]), 'thread_source') }],
    ['automatic response', { gmailReply: normalizeCompanyGmailReplyHeaders(headers([{ name: 'Auto-Submitted', value: 'auto-replied' }]), 'thread_source') }],
    ['mailing list', { gmailReply: normalizeCompanyGmailReplyHeaders(headers([{ name: 'List-Id', value: 'list.example.invalid' }]), 'thread_source') }],
    ['no-reply recipient', { gmailReply: normalizeCompanyGmailReplyHeaders([{ name: 'From', value: 'no-reply@example.invalid' },
      { name: 'Message-ID', value: '<source@example.invalid>' }, { name: 'References', value: '<prior@example.invalid>' }, { name: 'Subject', value: 'Support question' }], 'thread_source') }],
  ])('preserves negative header evidence for %s without inventing send context', async (_label, extra) => {
    const value = fixture(extra);
    const envelope = await resolve(value);
    expect(envelope?.policy.email.contextVerified).toBe(false);
    expect(envelope?.policy.email.ambiguous || envelope?.policy.email.autoSubmitted || envelope?.policy.email.listHeader || envelope?.policy.email.noReply).toBe(true);
  });

  it('rejects foreign, legacy, malformed, expired-through and expired closed sources', async () => {
    const foreign = fixture({ accountId: 'other@example.invalid' });
    await expect(resolve(foreign)).resolves.toBeNull();
    const legacy = fixture({ retentionPolicyVersion: 1, expiresAtMs: NOW + 1, expiresAt: new Date(NOW + 1) });
    await expect(resolve(legacy)).resolves.toBeNull();
    const malformed = fixture({ caseId: 'b'.repeat(64) });
    await expect(resolve(malformed)).resolves.toBeNull();

    const expiredThrough = fixture();
    expiredThrough.db.__patch(`external_inbox_cases/${expiredThrough.row.data.caseId}`, { expiredThroughMs: NOW });
    await expect(resolve(expiredThrough)).resolves.toBeNull();

    const closed = fixture();
    const past = transitionInboxCase(closed.inboxCase, { action: 'close', expectedRevision: 1, confirmation: 'ordinary_no_evidence', nowMs: NOW });
    closed.db.__set(`external_inbox_cases/${closed.row.data.caseId}`, past);
    closed.setNow(past.deleteAfterMs);
    await expect(resolve(closed)).resolves.toBeNull();
  });

  it('allows protected evidence cases and binds their status/revision without a made-up expiry', async () => {
    const value = fixture();
    const protectedCase = transitionInboxCase(value.inboxCase, { action: 'protect', expectedRevision: 1, nowMs: NOW });
    value.db.__set(`external_inbox_cases/${value.row.data.caseId}`, protectedCase);
    await expect(resolve(value)).resolves.toMatchObject({ expiresAtMs: 0,
      policy: { retention: { caseId: value.row.data.caseId, revision: 2, status: 'protected', deleteAfterMs: 0 } } });
  });

  it('uses the actual closed-case deletion deadline, never receipt plus a guessed duration', async () => {
    const value = fixture();
    const closed = transitionInboxCase(value.inboxCase, { action: 'close', expectedRevision: 1, confirmation: 'ordinary_no_evidence', nowMs: NOW });
    value.db.__set(`external_inbox_cases/${value.row.data.caseId}`, closed);
    await expect(resolve(value)).resolves.toMatchObject({ expiresAtMs: closed.deleteAfterMs,
      policy: { retention: { revision: 2, status: 'closed', deleteAfterMs: closed.deleteAfterMs } } });
  });

  it('invalidates an approval on any case revision change before sender invocation', async () => {
    const value = fixture();
    const request = { messageId: value.row.id, channel: 'email', text: 'Manual reply', expectedSourceAtMs: NOW - 10_000, key: KEY };
    const input = { db: value.db, request, actorUid: 'synthetic-admin', flags: { replyEnabled: true, dispatchEnabled: true },
      now: value.now, resolveEnvelope: value.resolver, send: vi.fn(async () => ({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'receipt' })) };
    const draft = await prepareExternalInboxReplyDraft(input);
    const approved = await approveExternalInboxReplyDraft({ ...input, humanApproved: true, expectedRevision: draft.revision, expectedDraftHash: draft.draftHash });
    expect(approved.code).toBe('APPROVED');
    const next = nextInboxCaseOnMessage(value.inboxCase, value.row.data, NOW);
    value.db.__set(`external_inbox_cases/${value.row.data.caseId}`, next);
    expect((await dispatchExternalInboxReply({ ...input, expectedRevision: approved.revision, expectedDraftHash: draft.draftHash })).code).toBe('DRAFT_CONFLICT');
    expect(input.send).not.toHaveBeenCalled();
  });

  it('does not substitute a client case identifier for the persisted v2 ownership proof', async () => {
    const value = fixture();
    expect(inboxCaseId(value.row.data)).toBe(value.row.data.caseId);
    value.db.__delete(`external_inbox_cases/${value.row.data.caseId}`);
    await expect(resolve(value)).resolves.toBeNull();
  });
});
