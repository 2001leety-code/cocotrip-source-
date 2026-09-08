import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import { sessionDocId } from '../../api/_shared/whatsapp-support-sessions.js';
import { EXTERNAL_INBOX_REPLY_POLICY_VERSION } from '../../api/_shared/external-inbox-reply-policy.js';
import { approveExternalInboxReplyDraft, dispatchExternalInboxReply, EXTERNAL_INBOX_REPLY_WORKFLOWS,
  prepareExternalInboxReplyDraft, REPLY_SEND_TIMEOUT_MS } from '../../api/_shared/external-inbox-reply-workflow.js';

const NOW = Date.parse('2026-09-08T08:00:00Z');
const key = '12345678-1234-4234-8234-123456789abc';
const nextKey = 'abcdefab-1234-4234-8234-123456789abc';
const request = { messageId: 'a'.repeat(64), channel: 'email', text: 'SYNTHETIC_APPROVED_REPLY', expectedSourceAtMs: NOW - 1000, key };
const envelope = { messageId: request.messageId, channel: 'email', accountId: 'company@example.invalid', providerMessageId: 'mail123',
  recipient: 'guest@example.invalid', sourceAtMs: NOW - 1000, receivedAtMs: NOW - 500,
  captureStartAtMs: NOW - 86_400_000, expiresAtMs: NOW + 86_400_000, consentVersion: 'support-reply.v1',
  policy: { version: EXTERNAL_INBOX_REPLY_POLICY_VERSION, accountId: 'company@example.invalid',
    accountVerified: true, recipientVerified: true, direction: 'inbound', live: true, isEcho: false,
    email: { contextVerified: true, singleMailbox: true, headerControls: false, autoSubmitted: false,
      listHeader: false, noReply: false, ambiguous: false, threadId: 'thread123',
      rfcMessageId: '<mail123@example.invalid>', subject: 'Travel inquiry', references: [] as string[] } } };
const accepted = { status: 'provider_accepted', receiptVerified: true, providerMessageId: 'receipt.synthetic' };

function fixture() {
  const db = createFakeFirestore({ 'synthetic_source/current': structuredClone(envelope) });
  const options = { db, request: structuredClone(request), actorUid: 'synthetic-owner', flags: { replyEnabled: true, dispatchEnabled: true },
    now: vi.fn(() => NOW), resolveEnvelope: vi.fn(async (tx: { get: (ref: unknown) => Promise<{ data: () => unknown }> }) =>
      (await tx.get(db.doc('synthetic_source/current'))).data()), send: vi.fn(async () => ({ ...accepted })) };
  return options;
}
type Options = ReturnType<typeof fixture>;
const records = (options: Options) => Object.entries(options.db.__dump()).filter(([path]) => path.startsWith(`${EXTERNAL_INBOX_REPLY_WORKFLOWS}/reply-`));
const record = (options: Options) => records(options)[0][1];
const path = (options: Options) => records(options)[0][0];
async function prepared(options = fixture()) {
  const draft = await prepareExternalInboxReplyDraft(options);
  expect(draft.ok).toBe(true);
  return { ...options, expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, humanApproved: true };
}
async function approved(options = fixture()) {
  const value = await prepared(options);
  expect((await approveExternalInboxReplyDraft(value)).code).toBe('APPROVED');
  return value;
}
function strictReadOrder(db: Options['db']) {
  const original = db.runTransaction.bind(db);
  db.runTransaction = (callback, options) => original(tx => {
    let written = false;
    return callback({ ...tx, get: ref => { if (written) throw new Error('READ_AFTER_WRITE'); return tx.get(ref); },
      set: (...args: Parameters<typeof tx.set>) => { written = true; return tx.set(...args); } });
  }, options);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('draft and human approval server ledger', () => {
  it.each([undefined, {}, { replyEnabled: false }, { replyEnabled: 'true' }])('all OFF states %j do no I/O', async flags => {
    const value = fixture(); const original = value.db.__dump();
    for (const operation of [prepareExternalInboxReplyDraft, approveExternalInboxReplyDraft, dispatchExternalInboxReply]) {
      expect((await operation({ ...value, flags })).code).toBe('REPLY_DISABLED');
    }
    expect(value.db.__stats.transactions).toBe(0); expect(value.db.__dump()).toEqual(original);
    expect(value.resolveEnvelope).not.toHaveBeenCalled(); expect(value.send).not.toHaveBeenCalled();
  });
  it('requires separate strict dispatcher opt-in before DB or callback', async () => {
    const value = fixture();
    for (const dispatchEnabled of [undefined, false, 'true', 1]) {
      expect((await dispatchExternalInboxReply({ ...value, flags: { replyEnabled: true, dispatchEnabled } })).code).toBe('DISPATCH_DISABLED');
    }
    expect(value.db.__stats.transactions).toBe(0); expect(value.send).not.toHaveBeenCalled();
  });
  it('returns a fixed code instead of leaking adapter initialization errors', async () => {
    const value = fixture(); value.db.collection = () => { throw new Error('PRIVATE_ADAPTER_DETAIL'); };
    for (const operation of [prepareExternalInboxReplyDraft, approveExternalInboxReplyDraft, dispatchExternalInboxReply]) {
      expect(await operation(value)).toEqual({ ok: false, code: 'SERVER_DEPENDENCY_UNAVAILABLE', sendAllowed: false, deliveryVerified: false });
    }
  });
  it('stores server-only content, hashed actor and separate source/approval expiry, with safe summaries', async () => {
    const value = await approved();
    const row = record(value);
    expect(row.request.text).toBe(request.text);
    expect(row.actorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.expiresAtMs).toBe(envelope.expiresAtMs);
    expect(row.approval.expiresAtMs).toBe(NOW + 300_000);
    expect(JSON.stringify(value.db.__dump())).not.toContain(value.actorUid);
    const output = JSON.stringify(await approveExternalInboxReplyDraft(value));
    for (const pii of [request.text, envelope.accountId, envelope.recipient, envelope.providerMessageId, value.actorUid]) expect(output).not.toContain(pii);
    expect(value.send).not.toHaveBeenCalled();
  });
  it('holds snippet-only email as DRAFT_ONLY without approving, sending or persisting arbitrary fields', async () => {
    const value = fixture();
    value.db.__set('synthetic_source/current', { ...envelope, originalText: 'PRIVATE_ORIGINAL_BODY', credentials: 'PRIVATE_CREDENTIAL',
      policy: { ...envelope.policy, email: { subject: { secret: 'PRIVATE_HEADER_OBJECT' }, references: { secret: 'PRIVATE_REFERENCES' } } } });
    const data = await prepared(value);
    expect(record(value).status).toBe('draft_only');
    expect((await approveExternalInboxReplyDraft(data)).code).toBe('REPLY_CONTEXT_MISSING');
    expect((await dispatchExternalInboxReply(data)).ok).toBe(false);
    const row = JSON.stringify(record(value));
    for (const forbidden of ['PRIVATE_ORIGINAL_BODY', 'PRIVATE_CREDENTIAL', 'PRIVATE_HEADER_OBJECT', 'PRIVATE_REFERENCES']) expect(row).not.toContain(forbidden);
    expect(value.send).not.toHaveBeenCalled();
  });
  it('missing human approval makes no approval writes', async () => {
    const value = await prepared(); const before = value.db.__dump();
    expect((await approveExternalInboxReplyDraft({ ...value, humanApproved: false })).code).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(value.db.__dump()).toEqual(before);
  });
  it('same UUID is idempotent but cannot be reused with another body or source', async () => {
    const value = await prepared(); const before = value.db.__dump();
    expect((await prepareExternalInboxReplyDraft(value)).code).toBe('DRAFT_ALREADY_EXISTS');
    expect(value.db.__dump()).toEqual(before);
    expect((await prepareExternalInboxReplyDraft({ ...value, request: { ...value.request, text: 'changed' } })).code).toBe('REQUEST_KEY_CONFLICT');
    value.db.__patch('synthetic_source/current', { messageId: 'b'.repeat(64) });
    expect((await prepareExternalInboxReplyDraft({ ...value, request: { ...value.request, messageId: 'b'.repeat(64) } })).code).toBe('REQUEST_KEY_CONFLICT');
  });
  it('new UUID cannot silently replace another draft; explicit revision/hash permits pre-approval edit', async () => {
    const value = await prepared();
    const changed = { ...value, request: { ...value.request, key: nextKey, text: 'new manually edited reply' } };
    expect((await prepareExternalInboxReplyDraft({ ...changed, expectedRevision: undefined })).code).toBe('DRAFT_CONFLICT');
    const edited = await prepareExternalInboxReplyDraft(changed);
    expect(edited.revision).toBe(2);
    expect((await approveExternalInboxReplyDraft(value)).code).toBe('DRAFT_CONFLICT');
    expect((await approveExternalInboxReplyDraft({ ...changed, expectedRevision: edited.revision, expectedDraftHash: edited.draftHash })).code).toBe('APPROVED');
    expect((await prepareExternalInboxReplyDraft({ ...changed, request: { ...changed.request, key: 'bbbbbbbb-1234-4234-8234-123456789abc', text: 'third reply' },
      expectedRevision: edited.revision, expectedDraftHash: edited.draftHash })).code).toBe('DRAFT_CONFLICT');
  });
  it('same body with two UUIDs shares one approval and one final reply', async () => {
    const value = await approved();
    const duplicate = { ...value, request: { ...value.request, key: nextKey } };
    expect((await prepareExternalInboxReplyDraft(duplicate)).code).toBe('DRAFT_ALREADY_EXISTS');
    expect((await approveExternalInboxReplyDraft(duplicate)).code).toBe('ALREADY_APPROVED');
    const before = record(value).approval;
    expect((await dispatchExternalInboxReply(duplicate)).code).toBe('PROVIDER_ACCEPTED');
    expect((await dispatchExternalInboxReply(value)).code).toBe('ALREADY_DISPATCHED');
    expect(record(value).approval).toEqual(before); expect(value.send).toHaveBeenCalledTimes(1);
  });
  it('another actor and changed server recipient/account cannot reuse an approval', async () => {
    const value = await approved();
    expect((await dispatchExternalInboxReply({ ...value, actorUid: 'other-owner' })).code).toBe('LEDGER_CONFLICT');
    value.db.__patch('synthetic_source/current', { recipient: 'other@example.invalid' });
    expect((await dispatchExternalInboxReply(value)).code).toBe('DRAFT_CONFLICT');
    value.db.__patch('synthetic_source/current', { accountId: 'personal@example.invalid' });
    expect((await dispatchExternalInboxReply(value)).code).toBe('SOURCE_CONTEXT_INVALID');
    expect(value.send).not.toHaveBeenCalled();
  });
  it('expired approval needs explicit new human approval of the same content and expiry version', async () => {
    const value = await approved(); const oldExpiry = record(value).approval.expiresAtMs;
    value.now.mockReturnValue(NOW + 300_000);
    expect((await dispatchExternalInboxReply(value)).code).toBe('REAPPROVAL_REQUIRED');
    expect((await approveExternalInboxReplyDraft(value)).code).toBe('REAPPROVAL_REQUIRED');
    expect((await approveExternalInboxReplyDraft({ ...value, renewApproval: true, expectedApprovalExpiresAtMs: oldExpiry })).code).toBe('APPROVED');
    expect(record(value).approval.expiresAtMs).toBe(NOW + 600_000);
    expect(value.send).not.toHaveBeenCalled();
  });
  it('enforces all reads before writes in prepare, approve, claim and finalization', async () => {
    const base = fixture(); strictReadOrder(base.db); const value = await approved(base);
    expect((await dispatchExternalInboxReply(value)).code).toBe('PROVIDER_ACCEPTED');
    expect(value.send).toHaveBeenCalledTimes(1);
  });
});

describe('exactly one attempted dispatch claim and uncertainty quarantine', () => {
  it('two concurrent requests only invoke the callback once, after a durable sending claim', async () => {
    const value = await approved(); const barrier = makeBarrier(2); let first = 0;
    value.db.__beforeCommit = async ({ attempt }: { attempt: number }) => { if (attempt === 1 && first++ < 2) await barrier.wait(); };
    value.send.mockImplementation(async () => { expect(record(value).status).toBe('sending'); expect(record(value).approvalConsumed).toBe(true); return accepted; });
    const results = await Promise.all([dispatchExternalInboxReply(value), dispatchExternalInboxReply(value)]);
    expect(value.send).toHaveBeenCalledTimes(1);
    expect(results.some(result => result.code === 'PROVIDER_ACCEPTED')).toBe(true);
    expect(value.db.__stats.retries).toBeGreaterThan(0);
  });
  it('claim commit-response loss invokes no callback and permanently quarantines the committed claim', async () => {
    const value = await approved(); const original = value.db.runTransaction.bind(value.db); let lose = true;
    value.db.runTransaction = async callback => { const result = await original(callback); if (lose) { lose = false; throw new Error('PRIVATE_COMMIT_RESPONSE_LOST'); } return result; };
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect(record(value).status).toBe('outcome_unknown');
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect(value.send).not.toHaveBeenCalled();
  });
  it('definite failed claim commit has no callback; a later fresh request can safely claim once', async () => {
    const value = await approved(); value.db.__beforeCommit = async () => { throw new Error('PRIVATE_STORE_FAILURE'); };
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).not.toHaveBeenCalled();
    expect(record(value).status).toBe('approved'); value.db.__beforeCommit = null;
    expect((await dispatchExternalInboxReply(value)).code).toBe('PROVIDER_ACCEPTED'); expect(value.send).toHaveBeenCalledTimes(1);
  });
  it('provider acceptance followed by failed state write never causes another callback', async () => {
    const value = await approved();
    value.send.mockImplementation(async () => { value.db.__beforeCommit = async () => { throw new Error('PRIVATE_FINISH_FAILURE'); }; return accepted; });
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect(record(value).status).toBe('sending'); value.db.__beforeCommit = null;
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(record(value))).not.toContain('PRIVATE_FINISH_FAILURE');
  });
  it('accepted finalization commit-response loss retains the accepted state, without a second send', async () => {
    const value = await approved(); const original = value.db.runTransaction.bind(value.db); let lose = false;
    value.db.runTransaction = async callback => { const result = await original(callback); if (lose) { lose = false; throw new Error('PRIVATE_FINISH_RESPONSE_LOST'); } return result; };
    value.send.mockImplementation(async () => { lose = true; return accepted; });
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect(record(value).status).toBe('provider_accepted');
    expect((await dispatchExternalInboxReply(value)).code).toBe('ALREADY_DISPATCHED'); expect(value.send).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { status: 'provider_accepted' }, { status: 'outcome_unknown', error: 'PRIVATE_RESPONSE' }])('missing/unknown provider receipt %j is never retried', async result => {
    const value = await approved(); value.send.mockResolvedValue(result);
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(record(value))).not.toContain('PRIVATE_RESPONSE');
  });
  it('thrown provider errors are fixed-code uncertainty, not trusted pre-send proof', async () => {
    const value = await approved(); value.send.mockRejectedValue(Object.assign(new Error('PRIVATE_ERROR_BODY'), { preSend: true }));
    expect(await dispatchExternalInboxReply(value)).toMatchObject({ code: 'DELIVERY_UNCERTAIN', deliveryVerified: false });
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(record(value))).not.toContain('PRIVATE_ERROR_BODY');
  });
  it('times out once, aborts and ignores a late callback success', async () => {
    vi.useFakeTimers(); const value = await approved(); let finish: (result: typeof accepted) => void = () => {};
    value.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const running = dispatchExternalInboxReply(value);
    await vi.advanceTimersByTimeAsync(REPLY_SEND_TIMEOUT_MS + 1);
    expect((await running).code).toBe('DELIVERY_UNCERTAIN');
    expect(value.send.mock.calls[0][0].signal.aborted).toBe(true);
    finish(accepted); await Promise.resolve();
    expect(record(value).status).toBe('outcome_unknown');
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).toHaveBeenCalledTimes(1);
  });
  it('only verified pre-send failure permits one additional attempt within the original approval', async () => {
    const value = await approved(); value.send.mockResolvedValue({ status: 'failed_pre_send', preSendVerified: true });
    expect((await dispatchExternalInboxReply(value)).code).toBe('PRE_SEND_FAILURE'); expect(record(value).retryAllowed).toBe(true);
    expect((await dispatchExternalInboxReply(value)).code).toBe('PRE_SEND_FAILURE'); expect(record(value).retryAllowed).toBe(false);
    expect((await dispatchExternalInboxReply(value)).code).toBe('APPROVAL_REQUIRED'); expect(value.send).toHaveBeenCalledTimes(2);
  });
  it('does not retry contradictory accepted/pre-send evidence', async () => {
    const value = await approved(); value.send.mockResolvedValue({ ...accepted, status: 'failed_pre_send', preSendVerified: true });
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN');
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).toHaveBeenCalledTimes(1);
  });
  it('never calls accepted delivered, even if a send callback claims delivered/read', async () => {
    const value = await approved(); value.send.mockResolvedValue({ ...accepted, status: 'read', deliveryVerified: true, readVerified: true, raw: 'PRIVATE_RESPONSE' });
    expect(await dispatchExternalInboxReply(value)).toMatchObject({ status: 'provider_accepted', deliveryVerified: false });
    expect(record(value).providerReceiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record(value))).not.toContain('receipt.synthetic'); expect(JSON.stringify(record(value))).not.toContain('PRIVATE_RESPONSE');
  });
  it('commit-response delay beyond approval expiry does not start an external send', async () => {
    const value = await approved(); value.db.__beforeCommit = async () => { value.now.mockReturnValue(NOW + 300_000); };
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).not.toHaveBeenCalled();
    expect(record(value).status).toBe('outcome_unknown');
  });
  it('clock rollback after claim does not authorize a callback', async () => {
    const value = await approved(); value.db.__beforeCommit = async () => { value.now.mockReturnValue(NOW - 1); };
    expect((await dispatchExternalInboxReply(value)).code).toBe('DELIVERY_UNCERTAIN'); expect(value.send).not.toHaveBeenCalled();
    expect(record(value).status).toBe('sending');
  });
  it.each([{ approvalConsumed: true }, { attempts: 1 }, { retryAllowed: true }, { approval: null },
    { providerReceiptHash: ['b'.repeat(64)] }, { status: 'sending' }])('denies contradictory ledger state %j without resetting it', async patch => {
    const value = await approved(); value.db.__patch(path(value), patch);
    const before = value.db.__dump();
    expect((await dispatchExternalInboxReply(value)).code).toBe('LEDGER_CONFLICT');
    expect(value.db.__dump()).toEqual(before); expect(value.send).not.toHaveBeenCalled();
  });
  it('rejects tampered/missing ledger and future source clocks without resetting any state', async () => {
    const value = await approved(); value.db.__patch(path(value), { draftHash: 'b'.repeat(64) });
    expect((await dispatchExternalInboxReply(value)).code).toBe('LEDGER_CONFLICT'); expect(value.send).not.toHaveBeenCalled();
    const clean = await approved(); clean.db.__patch('synthetic_source/current', { receivedAtMs: NOW + 1 });
    expect((await dispatchExternalInboxReply(clean)).code).toBe('SOURCE_CONTEXT_INVALID'); expect(clean.send).not.toHaveBeenCalled();
  });
});

describe('current WhatsApp STOP and original expiry transaction fences', () => {
  function whatsapp() {
    const value = fixture(); const accountId = '222'; const recipient = '821011112222';
    value.request.channel = 'whatsapp';
    value.db.__set('synthetic_source/current', { ...envelope, channel: 'whatsapp', accountId, recipient,
      policy: { ...envelope.policy, accountId, whatsapp: { windowVerified: true, stopped: false, blocked: false,
        sessionId: sessionDocId(accountId, recipient), lastCustomerAtMs: NOW - 1000,
        session: { policyVersion: 1, accountId, sender: recipient, status: 'active', startedAtMs: NOW - 60_000,
          expiresAtMs: NOW - 60_000 + 7_200_000, updatedAtMs: NOW - 60_000, closedAtMs: 0, lastStartMessageId: 'start.synthetic' } } } });
    return value;
  }
  it('STOP between approve and claim prevents any callback', async () => {
    const value = await approved(whatsapp()); const current = value.db.__get('synthetic_source/current');
    current.policy.whatsapp.stopped = true; value.db.__set('synthetic_source/current', current);
    expect((await dispatchExternalInboxReply(value)).code).toBe('WHATSAPP_CONSENT_REQUIRED'); expect(value.send).not.toHaveBeenCalled();
  });
  it('STOP racing with claim commit causes Firestore retry to reread and reject', async () => {
    const value = await approved(whatsapp()); let stop = true;
    value.db.__beforeCommit = async () => {
      if (!stop) return; stop = false; const current = value.db.__get('synthetic_source/current');
      current.policy.whatsapp.blocked = true; value.db.__set('synthetic_source/current', current);
    };
    expect((await dispatchExternalInboxReply(value)).code).toBe('WHATSAPP_CONSENT_REQUIRED');
    expect(value.db.__stats.retries).toBe(1); expect(value.send).not.toHaveBeenCalled(); expect(record(value).status).toBe('approved');
  });
  it('a transaction retry crossing two-hour consent expiry reruns the real-time policy', async () => {
    const value = await approved(whatsapp()); let expire = true;
    value.db.__beforeCommit = async () => {
      if (!expire) return; expire = false;
      const current = value.db.__get('synthetic_source/current');
      value.now.mockReturnValue(current.policy.whatsapp.session.expiresAtMs);
      value.db.__set('synthetic_source/current', current);
    };
    expect((await dispatchExternalInboxReply(value)).code).toBe('WHATSAPP_CONSENT_REQUIRED'); expect(value.send).not.toHaveBeenCalled();
  });
  it('source expiry and cutover stay authoritative rather than extending stored retention', async () => {
    const value = await prepared(); value.db.__patch('synthetic_source/current', { expiresAtMs: NOW });
    expect((await approveExternalInboxReplyDraft(value)).code).toBe('SOURCE_CONTEXT_INVALID');
    expect(record(value).expiresAtMs).toBe(envelope.expiresAtMs); expect(value.send).not.toHaveBeenCalled();
  });
});
