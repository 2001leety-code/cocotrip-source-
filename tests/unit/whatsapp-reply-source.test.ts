import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { prepareExternalInboxMessage, writeExternalInboxMessages } from '../../api/_shared/external-inbox-store.js';
import { nextInboxCaseOnMessage, transitionInboxCase } from '../../api/_shared/external-inbox-retention.js';
import { SESSION_DURATION_MS, sessionDocId, transitionSupportSession, WHATSAPP_PRIVACY_MODE } from '../../api/_shared/whatsapp-support-sessions.js';
import { createWhatsAppReplyResolver } from '../../api/_shared/whatsapp-reply-source.js';
import { approveExternalInboxReplyDraft, dispatchExternalInboxReply, prepareExternalInboxReplyDraft } from '../../api/_shared/external-inbox-reply-workflow.js';

const NOW = Date.parse('2026-09-14T01:00:00.000Z');
const ACCOUNT = '1234567890';
const SENDER = '821055500001';
const START = NOW - 60_000;
const CONFIG = { enabled: true, ready: true, accountId: ACCOUNT, captureStartAtMs: NOW - 86_400_000,
  privacyMode: WHATSAPP_PRIVACY_MODE, retentionDays: 30 };
const KEY = '12345678-1234-4234-8234-123456789abc';
type Row = Record<string, unknown>;

function message(extra: Row = {}) {
  return { channel: 'whatsapp', accountId: ACCOUNT, providerMessageId: 'wamid.synthetic-receipt', providerThreadId: SENDER,
    sourceAtMs: NOW - 10_000, sender: SENDER, subject: '', text: 'SYNTHETIC_BODY', kind: 'text', ...extra };
}

function fixture() {
  const sessionId = sessionDocId(ACCOUNT, SENDER);
  const prepared = prepareExternalInboxMessage({ ...message(), whatsappPolicyVersion: 1, whatsappSessionId: sessionId },
    { nowMs: NOW, retentionDays: 30 });
  const row = { id: prepared.docId, data: prepared.data };
  const session = transitionSupportSession(null, message({ sourceAtMs: START, providerMessageId: 'wamid.synthetic-start',
    text: 'COCOTRIP SUPPORT START' }), { nowMs: START }).session;
  const inboxCase = nextInboxCaseOnMessage(null, row.data, NOW);
  const sourcePath = `external_inbox_messages/${row.id}`;
  const casePath = `external_inbox_cases/${row.data.caseId}`;
  const sessionPath = `whatsapp_inbox_sessions/${sessionId}`;
  const db = createFakeFirestore({ [sourcePath]: row.data, [casePath]: inboxCase, [sessionPath]: session });
  let current = NOW;
  return { db, row, inboxCase, session, sourcePath, casePath, sessionPath,
    resolver: createWhatsAppReplyResolver({ db, inboxConfig: CONFIG, now: () => current }),
    now: () => current, setNow: (value: number) => { current = value; } };
}

async function resolve(value: ReturnType<typeof fixture>, extra: Row = {}) {
  return value.db.runTransaction(tx => value.resolver(tx, { messageId: value.row.id, channel: 'whatsapp', ...extra }));
}

function workflow(value: ReturnType<typeof fixture>) {
  return { db: value.db, request: { messageId: value.row.id, channel: 'whatsapp', text: 'Manual reply',
    expectedSourceAtMs: value.row.data.sourceAtMs, key: KEY }, actorUid: 'synthetic-admin',
  flags: { replyEnabled: true, dispatchEnabled: true }, now: value.now, resolveEnvelope: value.resolver,
  send: vi.fn(async () => ({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'wamid.synthetic-sent' })) };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('WhatsApp transaction reply source resolver', () => {
  it('uses only the pinned phone account and stored live source time and never copies original text or client routing', async () => {
    const value = fixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const envelope = await resolve(value, { recipient: '821055500099', accountId: '99999', lastCustomerAtMs: NOW,
      sessionId: 'b'.repeat(64), caseId: 'c'.repeat(64) });
    expect(envelope).toEqual({ messageId: value.row.id, channel: 'whatsapp', accountId: ACCOUNT,
      providerMessageId: value.row.data.providerMessageId, recipient: SENDER, sourceAtMs: NOW - 10_000,
      receivedAtMs: NOW, captureStartAtMs: CONFIG.captureStartAtMs, expiresAtMs: 0, consentVersion: 'whatsapp-explicit-reply.v2',
      policy: { version: 'external-inbox-reply.v1', accountId: ACCOUNT, accountVerified: true, recipientVerified: true,
        direction: 'inbound', live: true, isEcho: false,
        retention: { policyVersion: 2, caseId: value.row.data.caseId, revision: 1, status: 'open', deleteAfterMs: 0 },
        whatsapp: { windowVerified: true, stopped: false, blocked: false, sessionId: sessionDocId(ACCOUNT, SENDER),
          lastCustomerAtMs: NOW - 10_000, session: value.session } } });
    expect(JSON.stringify(envelope)).not.toContain('SYNTHETIC_BODY');
    expect(fetch).not.toHaveBeenCalled();
    expect(value.db.__stats.reads).toBe(3);
    expect(value.db.__dump()).toEqual({ [value.sourcePath]: value.row.data, [value.casePath]: value.inboxCase, [value.sessionPath]: value.session });
  });

  it('accepts a real synthetic writer receipt but discards unknown private messages and START controls', async () => {
    const value = fixture();
    const db = createFakeFirestore();
    const send = (candidate: Row, at: number) => writeExternalInboxMessages({ db, messages: [candidate], nowMs: at, now: () => at,
      captureStartAtMs: CONFIG.captureStartAtMs, retentionDays: 30 });
    expect((await send(message({ sourceAtMs: START - 1 }), START - 1)).created).toBe(0);
    expect((await send(message({ sourceAtMs: START, providerMessageId: 'wamid.synthetic-start', text: 'COCOTRIP SUPPORT START' }), START)).created).toBe(0);
    expect((await send(message(), NOW)).created).toBe(1);
    const resolver = createWhatsAppReplyResolver({ db, inboxConfig: CONFIG, now: () => NOW });
    await expect(db.runTransaction(tx => resolver(tx, { channel: 'whatsapp', messageId: value.row.id }))).resolves.toMatchObject({ recipient: SENDER });
  });

  it.each([
    ['foreign account', { accountId: '999' }], ['other channel', { channel: 'email' }],
    ['foreign sender', { sender: '821055500099' }], ['thread redirect', { providerThreadId: '821055500099' }],
    ['provider identity', { providerMessageId: 'wamid.other' }], ['missing proof', { whatsappPolicyVersion: undefined }],
    ['foreign session', { whatsappSessionId: 'b'.repeat(64) }], ['coerced session', { whatsappSessionId: ['b'.repeat(64)] }],
    ['foreign case', { caseId: 'b'.repeat(64) }], ['coerced case', { caseId: ['b'.repeat(64)] }],
    ['legacy receipt', { retentionPolicyVersion: 1 }], ['invented deadline', { expiresAtMs: NOW + 1 }],
    ['unexpected TTL', { expiresAt: new Date(NOW + 1) }], ['future source', { sourceAtMs: NOW + 1 }],
    ['future receipt', { receivedAtMs: NOW + 1 }], ['source after receipt', { receivedAtMs: NOW - 20_000 }],
    ['pre-capture source', { sourceAtMs: CONFIG.captureStartAtMs - 1 }], ['missing source', { sourceAtMs: undefined }],
    ['fractional source', { sourceAtMs: NOW - 0.5 }], ['history record', { history: true }],
    ['echo record', { isEcho: true }], ['outbound record', { direction: 'outbound' }],
    ['raw provider data', { payload: {} }], ['unsupported kind', { kind: 'synthetic_untrusted' }],
    ['START control', { text: 'COCOTRIP SUPPORT START' }], ['STOP control', { text: 'STOP' }],
    ['support STOP control', { text: 'COCOTRIP SUPPORT STOP' }], ['non-string body', { text: [] }],
    ['unsanitized controls', { text: 'bad\u0001body' }], ['non-text original body', { kind: 'image', text: 'unexpected body' }],
  ])('rejects %s without upgrading it to live evidence', async (_label, extra) => {
    const value = fixture();
    value.db.__patch(value.sourcePath, extra);
    await expect(resolve(value)).resolves.toBeNull();
  });

  it.each([
    ['disabled', { enabled: false }], ['unready', { ready: false }], ['wrong phone', { accountId: '999' }],
    ['wrong privacy mode', { privacyMode: 'all_messages' }], ['missing capture', { captureStartAtMs: undefined }],
    ['future capture', { captureStartAtMs: NOW + 1 }], ['coerced phone', { accountId: [ACCOUNT] }],
  ])('rejects %s server configuration', async (_label, patch) => {
    const value = fixture();
    const resolver = createWhatsAppReplyResolver({ db: value.db, inboxConfig: { ...CONFIG, ...patch }, now: value.now });
    await expect(value.db.runTransaction(tx => resolver(tx, { messageId: value.row.id, channel: 'whatsapp' }))).resolves.toBeNull();
  });

  it.each([undefined, null, [], ['a'.repeat(64)], {}, 123, '../bad', 'A'.repeat(64)])('rejects non-hash request %j before database reads', async messageId => {
    const value = fixture();
    await expect(resolve(value, { messageId })).resolves.toBeNull();
    expect(value.db.__stats.reads).toBe(0);
  });

  it.each(['sourcePath', 'casePath', 'sessionPath'] as const)('rejects missing %s', async path => {
    const value = fixture();
    value.db.__delete(value[path]);
    await expect(resolve(value)).resolves.toBeNull();
  });

  it.each([
    ['STOP', { status: 'closed', closedAtMs: NOW, updatedAtMs: NOW }],
    ['operator block', { status: 'blocked', closedAtMs: NOW, updatedAtMs: NOW }],
    ['unvalidated field', { extra: 'unknown' }], ['foreign session account', { accountId: '999' }],
    ['foreign session sender', { sender: '821055500099' }], ['future update', { updatedAtMs: NOW + 1 }],
    ['invalid duration', { expiresAtMs: NOW + 1 }], ['missing START', { lastStartMessageId: '' }],
    ['source is START receipt', { lastStartMessageId: 'wamid.synthetic-receipt' }],
  ])('rejects current session with %s', async (_label, patch) => {
    const value = fixture();
    value.db.__patch(value.sessionPath, patch);
    await expect(resolve(value)).resolves.toBeNull();
  });

  it('refuses prior sessions, equal-second START sources, pre-capture consent, and receipt after session expiry', async () => {
    for (const startedAtMs of [NOW - 5_000, NOW - 10_000, CONFIG.captureStartAtMs - 1]) {
      const value = fixture();
      value.db.__patch(value.sessionPath, { startedAtMs, expiresAtMs: startedAtMs + SESSION_DURATION_MS, updatedAtMs: startedAtMs });
      await expect(resolve(value)).resolves.toBeNull();
    }
    const value = fixture();
    value.db.__patch(value.sourcePath, { receivedAtMs: value.session.expiresAtMs });
    value.setNow(value.session.expiresAtMs);
    await expect(resolve(value)).resolves.toBeNull();
  });

  it('uses the clock after all transaction reads and rejects expiry at the exact boundary', async () => {
    const value = fixture();
    value.setNow(value.session.expiresAtMs - 1);
    await expect(resolve(value)).resolves.not.toBeNull();
    await expect(value.db.runTransaction(tx => value.resolver({ get: async (ref: { path: string }) => {
      const snapshot = await tx.get(ref);
      if (ref.path === value.sessionPath) value.setNow(value.session.expiresAtMs);
      return snapshot;
    } }, { channel: 'whatsapp', messageId: value.row.id }))).resolves.toBeNull();
  });

  it('binds retained closed/protected case revisions while rejecting malformed or expired-through records', async () => {
    for (const action of ['close', 'protect']) {
      const value = fixture();
      const record = transitionInboxCase(value.inboxCase, { action, expectedRevision: 1, nowMs: NOW,
        ...(action === 'close' ? { confirmation: 'ordinary_no_evidence' } : {}) });
      value.db.__set(value.casePath, record);
      await expect(resolve(value)).resolves.toMatchObject({ expiresAtMs: record.deleteAfterMs,
        policy: { retention: { revision: 2, status: record.status, deleteAfterMs: record.deleteAfterMs } } });
    }
    for (const patch of [{ expiredThroughMs: NOW }, { revision: 0 }, { lastActivityAtMs: NOW - 1 }, { updatedAtMs: NOW + 1 }]) {
      const value = fixture();
      value.db.__patch(value.casePath, patch);
      await expect(resolve(value)).resolves.toBeNull();
    }
  });

  it('rechecks STOP committed during the approval transaction before any sender call', async () => {
    const value = fixture();
    const input = workflow(value);
    const draft = await prepareExternalInboxReplyDraft(input);
    let stopped = false;
    value.db.__beforeCommit = async () => {
      if (stopped) return;
      stopped = true;
      value.db.__patch(value.sessionPath, { status: 'closed', closedAtMs: NOW, updatedAtMs: NOW });
    };
    const approval = await approveExternalInboxReplyDraft({ ...input, humanApproved: true,
      expectedRevision: draft.revision, expectedDraftHash: draft.draftHash });
    expect(approval.code).toBe('SOURCE_CONTEXT_INVALID');
    expect(value.db.__stats.retries).toBe(1);
    expect(input.send).not.toHaveBeenCalled();
  });

  it('rechecks operator block committed while claiming dispatch', async () => {
    const value = fixture();
    const input = workflow(value);
    const draft = await prepareExternalInboxReplyDraft(input);
    const approval = await approveExternalInboxReplyDraft({ ...input, humanApproved: true,
      expectedRevision: draft.revision, expectedDraftHash: draft.draftHash });
    expect(approval.code).toBe('APPROVED');
    let blocked = false;
    value.db.__beforeCommit = async () => {
      if (blocked) return;
      blocked = true;
      value.db.__patch(value.sessionPath, { status: 'blocked', closedAtMs: NOW, updatedAtMs: NOW });
    };
    const dispatched = await dispatchExternalInboxReply({ ...input, expectedRevision: approval.revision, expectedDraftHash: draft.draftHash });
    expect(dispatched.code).toBe('SOURCE_CONTEXT_INVALID');
    expect(value.db.__stats.retries).toBe(1);
    expect(input.send).not.toHaveBeenCalled();
  });

  it('requires new approval if retention changes and sends a valid approved synthetic reply at most once', async () => {
    const value = fixture();
    const input = workflow(value);
    const draft = await prepareExternalInboxReplyDraft(input);
    const approval = await approveExternalInboxReplyDraft({ ...input, humanApproved: true,
      expectedRevision: draft.revision, expectedDraftHash: draft.draftHash });
    value.db.__set(value.casePath, nextInboxCaseOnMessage(value.inboxCase, value.row.data, NOW));
    const dispatch = () => dispatchExternalInboxReply({ ...input, expectedRevision: approval.revision, expectedDraftHash: draft.draftHash });
    expect((await dispatch()).code).toBe('DRAFT_CONFLICT');
    expect(input.send).not.toHaveBeenCalled();
    value.db.__set(value.casePath, value.inboxCase);
    expect((await dispatch()).code).toBe('PROVIDER_ACCEPTED');
    expect((await dispatch()).code).toBe('ALREADY_DISPATCHED');
    expect(input.send).toHaveBeenCalledTimes(1);
  });
});
