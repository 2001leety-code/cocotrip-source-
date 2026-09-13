import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminWhatsAppReplyHandler, validWhatsAppReplyAction } from '../../api/admin-whatsapp-reply.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import { nextInboxCaseOnMessage } from '../../api/_shared/external-inbox-retention.js';
import { SESSION_DURATION_MS, sessionDocId, transitionSupportSession } from '../../api/_shared/whatsapp-support-sessions.js';

const NOW = Date.parse('2026-09-14T01:00:00.000Z');
const ACCOUNT = '1234567890';
const SENDER = '821055500001';
const START = NOW - 60_000;
const KEY = '12345678-1234-4234-8234-123456789abc';
const BASE_URL = 'https://cocotripkr.com/api/admin-whatsapp-reply';
const env = {
  VERCEL_ENV: 'production', WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_WABA_ID: '9876543210',
  WHATSAPP_INBOX_PHONE_NUMBER_ID: ACCOUNT, WHATSAPP_INBOX_APP_SECRET: 'synthetic-app-secret',
  WHATSAPP_INBOX_VERIFY_TOKEN: 'synthetic-verify-token', WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-13T00:00:00.000Z',
  WHATSAPP_INBOX_RETENTION_DAYS: '30', WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
  WHATSAPP_REPLY_ENABLED: 'true', WHATSAPP_REPLY_SEND_ENABLED: 'true', WHATSAPP_REPLY_ACCESS_TOKEN: 'synthetic-access-token-value',
};
type Row = Record<string, unknown>;
type Fixture = ReturnType<typeof setup>;

function setup() {
  const incoming = { channel: 'whatsapp', accountId: ACCOUNT, providerMessageId: 'wamid.synthetic-source', providerThreadId: SENDER,
    sourceAtMs: NOW - 10_000, sender: SENDER, subject: '', text: 'SYNTHETIC_CUSTOMER_ORIGINAL', kind: 'text' };
  const sessionId = sessionDocId(ACCOUNT, SENDER);
  const prepared = prepareExternalInboxMessage({ ...incoming, whatsappPolicyVersion: 1, whatsappSessionId: sessionId },
    { nowMs: NOW, retentionDays: 30 });
  const session = transitionSupportSession(null, { ...incoming, sourceAtMs: START,
    providerMessageId: 'wamid.synthetic-start', text: 'COCOTRIP SUPPORT START' }, { nowMs: START }).session;
  const inboxCase = nextInboxCaseOnMessage(null, prepared.data, NOW);
  const sourcePath = `external_inbox_messages/${prepared.docId}`;
  const sessionPath = `whatsapp_inbox_sessions/${sessionId}`;
  const casePath = `external_inbox_cases/${prepared.data.caseId}`;
  const db = createFakeFirestore({ [sourcePath]: prepared.data, [sessionPath]: session, [casePath]: inboxCase });
  const authenticate = vi.fn(async () => ({ ok: true, uid: 'synthetic-owner' }));
  const loadDb = vi.fn(async () => db);
  const sender = vi.fn(async () => ({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'wamid.synthetic-accepted' }));
  const senderFactory = vi.fn(() => sender);
  let current = NOW;
  return { db, prepared, session, sourcePath, sessionPath, casePath, authenticate, loadDb, sender, senderFactory,
    now: () => current, setNow: (at: number) => { current = at; },
    request: { messageId: prepared.docId, channel: 'whatsapp', text: 'Synthetic manual reply', expectedSourceAtMs: NOW - 10_000, key: KEY } };
}

function handlerFor(value: Fixture, overrides: Row = {}) {
  return createAdminWhatsAppReplyHandler({ env, now: value.now, authenticate: value.authenticate,
    loadDb: value.loadDb, senderFactory: value.senderFactory, ...overrides });
}

async function call(handler: ReturnType<typeof createAdminWhatsAppReplyHandler>, {
  method = 'POST', body, id, url, origin = 'https://cocotripkr.com', headers = {}, rawBody,
}: { method?: string; body?: unknown; id?: string; url?: string; origin?: string; headers?: Row; rawBody?: unknown } = {}) {
  const result: { status?: number; headers?: Record<string, string>; raw?: string } = {};
  await handler({ method, url: url || (id ? `${BASE_URL}?id=${id}` : BASE_URL),
    headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json', origin, ...headers },
    body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
  }, {
    writeHead: (status: number, responseHeaders: Record<string, string>) => { result.status = status; result.headers = responseHeaders; },
    end: (raw?: string) => { result.raw = raw; },
  });
  return { ...result, body: result.raw ? JSON.parse(result.raw) : null };
}

const draftAction = (value: Fixture) => ({ action: 'draft', request: value.request });
const sendAction = (value: Fixture, draft: { revision: number; draftHash: string }) => ({ action: 'send', request: value.request,
  expectedRevision: draft.revision, expectedDraftHash: draft.draftHash, expectedApprovalExpiresAtMs: 0, confirmed: true });

function storedReply(value: Fixture) {
  const entry = Object.entries(value.db.__dump()).find(([path]) => path.startsWith('external_inbox_reply_workflows/reply-'));
  if (!entry) throw new Error('SYNTHETIC_REPLY_NOT_FOUND');
  return { path: entry[0], record: entry[1] };
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('admin WhatsApp reply handler with real source resolver', () => {
  it.each([
    ['reply disabled', { WHATSAPP_REPLY_ENABLED: 'false' }, 'REPLY_DISABLED'],
    ['preview', { VERCEL_ENV: 'preview' }, 'REPLY_DISABLED'],
    ['inbox disabled', { WHATSAPP_INBOX_ENABLED: 'false' }, 'INBOX_CONNECTION_REQUIRED'],
    ['privacy missing', { WHATSAPP_INBOX_PRIVACY_MODE: '' }, 'INBOX_CONNECTION_REQUIRED'],
    ['phone missing', { WHATSAPP_INBOX_PHONE_NUMBER_ID: '' }, 'INBOX_CONNECTION_REQUIRED'],
  ])('keeps %s GET and POST outside Firestore', async (_label, patch, reason) => {
    const value = setup();
    const handler = handlerFor(value, { env: { ...env, ...patch } });
    expect(await call(handler, { method: 'GET', id: value.prepared.docId })).toMatchObject({ status: 200,
      body: { ok: true, data: { messageId: value.prepared.docId, sourceAtMs: 0, recipient: '', canCompose: false, canSend: false, reason, workflow: null } } });
    expect(await call(handler, { body: draftAction(value) })).toMatchObject({ status: 503, body: { ok: false, code: reason } });
    expect(value.loadDb).not.toHaveBeenCalled();
    expect(value.senderFactory).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, status: 401 }, 401], [{ ok: false, status: 403 }, 403],
    [{ ok: true, uid: '' }, 401], [{ ok: true, uid: '   ' }, 401],
  ])('denies unverified administrator %j without loading Firestore', async (auth, status) => {
    const value = setup();
    const handler = handlerFor(value, { authenticate: vi.fn(async () => auth) });
    expect(await call(handler, { body: draftAction(value) })).toMatchObject({ status, body: { code: 'ADMIN_REQUIRED' } });
    expect(value.loadDb).not.toHaveBeenCalled();
  });

  it('checks origin before authentication, allows only preflight, and rejects unsupported methods', async () => {
    const value = setup();
    const handler = handlerFor(value);
    expect(await call(handler, { method: 'GET', id: value.prepared.docId, origin: 'https://evil.invalid' }))
      .toMatchObject({ status: 403, body: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(await call(handler, { method: 'OPTIONS' })).toMatchObject({ status: 200, body: null });
    expect(await call(handler, { method: 'DELETE' })).toMatchObject({ status: 405, body: { code: 'METHOD_NOT_ALLOWED' } });
    expect(value.authenticate).not.toHaveBeenCalled();
    expect(value.loadDb).not.toHaveBeenCalled();
  });

  it.each([
    ['email channel', { channel: 'email' }], ['client recipient', { recipient: '821055500099' }],
    ['client account', { accountId: '99999' }], ['client policy', { policy: { live: true } }],
    ['coerced message id', { messageId: ['a'.repeat(64)] }], ['blank text', { text: ' ' }],
    ['text too long', { text: 'x'.repeat(4001) }], ['text controls', { text: 'bad\u0001body' }],
    ['invalid source', { expectedSourceAtMs: 0 }],
  ])('rejects %s request before database access', async (_label, patch) => {
    const value = setup();
    const body = { ...draftAction(value), request: { ...value.request, ...patch } };
    expect(validWhatsAppReplyAction(body)).toBe(false);
    expect(await call(handlerFor(value), { body })).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    expect(value.loadDb).not.toHaveBeenCalled();
  });

  it('requires exact action shape and explicit true confirmation', async () => {
    const value = setup();
    const send = sendAction(value, { revision: 1, draftHash: 'a'.repeat(64) });
    const bodies = [{ ...draftAction(value), extra: true }, { ...draftAction(value), expectedRevision: 1 },
      { ...send, confirmed: false }, { ...send, confirmed: 'true' }, { ...send, expectedApprovalExpiresAtMs: undefined },
      { ...send, expectedFailedAttemptId: 'not-a-uuid' }, { ...send, text: 'injected body' }];
    for (const body of bodies) {
      expect(validWhatsAppReplyAction(body)).toBe(false);
      expect(await call(handlerFor(value), { body })).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    }
    expect(value.loadDb).not.toHaveBeenCalled();
    expect(value.senderFactory).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong content type', { headers: { 'content-type': 'text/plain' } }],
    ['declared body too large', { headers: { 'content-length': '20481' } }],
    ['invalid declared length', { headers: { 'content-length': '-1' } }],
    ['malformed JSON', { rawBody: '{' }], ['oversized body', { rawBody: ' '.repeat(20481) }],
    ['POST query injection', { url: `${BASE_URL}?channel=email` }],
  ])('rejects %s before database access', async (_label, options) => {
    const value = setup();
    expect(await call(handlerFor(value), { body: draftAction(value), ...options }))
      .toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    expect(value.loadDb).not.toHaveBeenCalled();
  });

  it('rejects duplicate/extra GET parameters and missing id before database access', async () => {
    const value = setup();
    for (const query of ['', `?id=${value.prepared.docId}&id=${value.prepared.docId}`, `?id=${value.prepared.docId}&recipient=${SENDER}`]) {
      expect(await call(handlerFor(value), { method: 'GET', url: `${BASE_URL}${query}` }))
        .toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    }
    expect(value.loadDb).not.toHaveBeenCalled();
  });

  it('runs draft, safe GET preview, explicit confirmation and provider acceptance without claiming delivery', async () => {
    const value = setup();
    const handler = handlerFor(value);
    const initial = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(initial).toMatchObject({ status: 200, body: { data: { recipient: SENDER, canCompose: true, canSend: false, workflow: null } } });
    const draft = await call(handler, { body: draftAction(value) });
    expect(draft).toMatchObject({ status: 200, body: { ok: true, code: 'DRAFT_PREPARED', status: 'draft', deliveryVerified: false } });
    expect(value.senderFactory).not.toHaveBeenCalled();
    const view = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(view).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      body: { data: { canCompose: true, canSend: true, sourceAtMs: value.request.expectedSourceAtMs, recipient: SENDER,
        workflow: { request: value.request, status: 'draft', providerAccepted: false, deliveryVerified: false, failedAttemptId: '' } } } });
    expect(Object.keys(view.body.data).sort()).toEqual(['canCompose', 'canSend', 'messageId', 'reason', 'recipient', 'sourceAtMs', 'workflow']);
    expect(Object.keys(view.body.data.workflow).sort()).toEqual(['approvalExpiresAtMs', 'deliveryVerified', 'draftExpiresAtMs', 'draftHash',
      'failedAttemptId', 'providerAccepted', 'request', 'revision', 'status']);
    expect(view.raw).not.toContain('SYNTHETIC_CUSTOMER_ORIGINAL');
    expect(view.raw).not.toContain('synthetic-access-token-value');
    expect(view.raw).not.toContain('session');
    const sent = await call(handler, { body: sendAction(value, draft.body) });
    expect(sent).toMatchObject({ status: 200, body: { ok: true, status: 'provider_accepted', providerAccepted: true, deliveryVerified: false } });
    expect(value.sender).toHaveBeenCalledTimes(1);
    expect(value.sender.mock.calls[0][0]).toMatchObject({ text: value.request.text, authorizationExpiresAtMs: NOW + 300_000,
      envelope: { recipient: SENDER, accountId: ACCOUNT, policy: { whatsapp: { lastCustomerAtMs: NOW - 10_000 } } } });
    const final = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(final).toMatchObject({ body: { data: { canCompose: false, canSend: false,
      workflow: { status: 'provider_accepted', providerAccepted: true, deliveryVerified: false } } } });
  });

  it('will not turn a valid confirmation into a send without a saved draft', async () => {
    const value = setup();
    expect(await call(handlerFor(value), { body: sendAction(value, { revision: 1, draftHash: 'a'.repeat(64) }) }))
      .toMatchObject({ status: 409, body: { code: 'DRAFT_REQUIRED' } });
    expect(value.senderFactory).not.toHaveBeenCalled();
  });

  it('permits draft editing with dispatch disabled but blocks sending before database access', async () => {
    const value = setup();
    const handler = handlerFor(value, { env: { ...env, WHATSAPP_REPLY_SEND_ENABLED: 'false' } });
    const draft = await call(handler, { body: draftAction(value) });
    expect(draft).toMatchObject({ status: 200, body: { code: 'DRAFT_PREPARED' } });
    expect(await call(handler, { method: 'GET', id: value.prepared.docId })).toMatchObject({ status: 200,
      body: { data: { canCompose: true, canSend: false, reason: 'DISPATCH_DISABLED' } } });
    value.loadDb.mockClear();
    expect(await call(handler, { body: sendAction(value, draft.body) })).toMatchObject({ status: 503, body: { code: 'DISPATCH_DISABLED' } });
    expect(value.loadDb).not.toHaveBeenCalled();
    expect(value.senderFactory).not.toHaveBeenCalled();
  });

  it('allows one sender invocation across concurrent confirmations and later repeats', async () => {
    const value = setup();
    const handler = handlerFor(value);
    const draft = await call(handler, { body: draftAction(value) });
    const action = sendAction(value, draft.body);
    const results = await Promise.all([call(handler, { body: action }), call(handler, { body: action })]);
    expect(results.filter(result => result.body.code === 'PROVIDER_ACCEPTED')).toHaveLength(1);
    expect(results.every(result => result.status === 200 || result.status === 409)).toBe(true);
    expect(await call(handler, { body: action })).toMatchObject({ status: 409, body: { code: 'APPROVAL_LOCKED' } });
    expect(value.sender).toHaveBeenCalledTimes(1);
    expect(storedReply(value).record).toMatchObject({ status: 'provider_accepted', attempts: 1, approvalConsumed: true, retryAllowed: false });
  });

  it.each(['stop', 'blocked', 'new_session', 'source_changed', 'source_removed'])('blocks %s between draft and confirmation', async mode => {
    const value = setup();
    const handler = handlerFor(value);
    const draft = await call(handler, { body: draftAction(value) });
    if (mode === 'stop' || mode === 'blocked') value.db.__patch(value.sessionPath,
      { status: mode === 'stop' ? 'closed' : 'blocked', updatedAtMs: NOW, closedAtMs: NOW });
    if (mode === 'new_session') value.db.__patch(value.sessionPath,
      { startedAtMs: NOW, updatedAtMs: NOW, expiresAtMs: NOW + SESSION_DURATION_MS, lastStartMessageId: 'wamid.new-start' });
    if (mode === 'source_changed') value.db.__patch(value.sourcePath, { sourceAtMs: NOW - 9_000 });
    if (mode === 'source_removed') value.db.__delete(value.sourcePath);
    expect(await call(handler, { body: sendAction(value, draft.body) })).toMatchObject({ status: 404, body: { code: 'SOURCE_CONTEXT_INVALID' } });
    expect(value.sender).not.toHaveBeenCalled();
  });

  it('catches STOP committed during approval and source replacement during the dispatch transaction', async () => {
    for (const phase of ['approval', 'dispatch']) {
      const value = setup();
      const handler = handlerFor(value);
      const draft = await call(handler, { body: draftAction(value) });
      let changed = false;
      value.db.__beforeCommit = async () => {
        if (changed) return;
        const record = storedReply(value).record;
        if (phase === 'dispatch' && record.status !== 'approved') return;
        changed = true;
        if (phase === 'approval') value.db.__patch(value.sessionPath, { status: 'closed', updatedAtMs: NOW, closedAtMs: NOW });
        else value.db.__patch(value.sourcePath, { providerMessageId: 'wamid.replaced-source' });
      };
      expect(await call(handler, { body: sendAction(value, draft.body) })).toMatchObject({ status: 404, body: { code: 'SOURCE_CONTEXT_INVALID' } });
      expect(value.db.__stats.retries).toBe(1);
      expect(value.sender).not.toHaveBeenCalled();
    }
  });

  it('rejects session expiry before human confirmation', async () => {
    const value = setup();
    const handler = handlerFor(value);
    const draft = await call(handler, { body: draftAction(value) });
    value.setNow(value.session.expiresAtMs);
    expect(await call(handler, { body: sendAction(value, draft.body) })).toMatchObject({ status: 404, body: { code: 'SOURCE_CONTEXT_INVALID' } });
    expect(await call(handler, { method: 'GET', id: value.prepared.docId })).toMatchObject({ status: 404, body: { code: 'SOURCE_CONTEXT_INVALID' } });
    expect(value.sender).not.toHaveBeenCalled();
  });

  it.each(['malformed_record', 'wrong_actor', 'future_record'])('does not expose %s on GET', async mode => {
    const value = setup();
    await call(handlerFor(value), { body: draftAction(value) });
    const reply = storedReply(value);
    if (mode === 'malformed_record') value.db.__patch(reply.path, { attempts: -1 });
    if (mode === 'future_record') value.db.__patch(reply.path, { updatedAtMs: NOW + 1 });
    const handler = handlerFor(value, mode === 'wrong_actor'
      ? { authenticate: vi.fn(async () => ({ ok: true, uid: 'different-owner' })) } : {});
    const result = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(result).toMatchObject({ status: 503, body: { ok: false, code: 'REPLY_UNAVAILABLE' } });
    expect(result.raw).not.toContain(value.request.text);
    expect(value.sender).not.toHaveBeenCalled();
  });

  it('quarantines an unknown provider result and disallows repeat or client-forced retry', async () => {
    const value = setup();
    const sender = vi.fn(async () => ({ status: 'outcome_unknown' }));
    const handler = handlerFor(value, { senderFactory: () => sender });
    const draft = await call(handler, { body: draftAction(value) });
    const action = sendAction(value, draft.body);
    expect(await call(handler, { body: action })).toMatchObject({ status: 409, body: { code: 'DELIVERY_UNCERTAIN', deliveryVerified: false } });
    const view = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(view).toMatchObject({ status: 200, body: { data: { canCompose: false, canSend: false,
      workflow: { status: 'outcome_unknown', providerAccepted: false, deliveryVerified: false, failedAttemptId: '' } } } });
    const reply = storedReply(value).record;
    expect(reply).toMatchObject({ status: 'outcome_unknown', attempts: 1, approvalConsumed: true, retryAllowed: false });
    expect(await call(handler, { body: action })).toMatchObject({ status: 409, body: { code: 'APPROVAL_LOCKED' } });
    expect(await call(handler, { body: { ...action, expectedFailedAttemptId: reply.attemptId } }))
      .toMatchObject({ status: 409, body: { code: 'APPROVAL_LOCKED' } });
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
