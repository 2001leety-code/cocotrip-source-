import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminCompanyEmailReplyHandler, validCompanyEmailReplyAction } from '../../api/admin-company-email-reply.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import { createCompanyGmailReplyResolver, normalizeCompanyGmailReplyHeaders } from '../../api/_shared/company-gmail-reply-source.js';
import { nextInboxCaseOnMessage } from '../../api/_shared/external-inbox-retention.js';

const NOW = Date.parse('2026-09-09T01:00:00.000Z');
const ACCOUNT = 'cocotripkr@gmail.com';
const KEY = '12345678-1234-4234-8234-123456789abc';
const REPLY_TEXT = 'Synthetic reply';
const BASE_URL = 'https://cocotripkr.com/api/admin-company-email-reply';
const env = {
  VERCEL_ENV: 'production',
  COMPANY_GMAIL_INBOX_ENABLED: 'true',
  COMPANY_GMAIL_INBOX_EMAIL: ACCOUNT,
  COMPANY_GMAIL_INBOX_CLIENT_ID: 'synthetic-inbox-id',
  COMPANY_GMAIL_INBOX_CLIENT_SECRET: 'synthetic-inbox-secret',
  COMPANY_GMAIL_INBOX_REFRESH_TOKEN: 'synthetic-inbox-refresh',
  COMPANY_GMAIL_INBOX_CAPTURE_START_AT: '2026-01-01T00:00:00.000Z',
  COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30',
  COMPANY_GMAIL_REPLY_ENABLED: 'true',
  COMPANY_GMAIL_REPLY_SEND_ENABLED: 'true',
  COMPANY_GMAIL_REPLY_EMAIL: ACCOUNT,
  COMPANY_GMAIL_REPLY_CLIENT_ID: 'synthetic-reply-id',
  COMPANY_GMAIL_REPLY_CLIENT_SECRET: 'synthetic-reply-secret',
  COMPANY_GMAIL_REPLY_REFRESH_TOKEN: 'synthetic-reply-refresh',
};

type Fixture = ReturnType<typeof setup>;

function setup({ actorUid = 'synthetic-owner' }: { actorUid?: string } = {}) {
  const prepared = prepareExternalInboxMessage({
    channel: 'email',
    accountId: ACCOUNT,
    providerMessageId: 'source-message',
    providerThreadId: 'thread_source',
    sourceAtMs: NOW - 10_000,
    sender: 'Guest <guest@example.invalid>',
    subject: 'Question',
    text: 'Synthetic customer message',
    kind: 'email',
  }, { nowMs: NOW, retentionDays: 30 });
  const data = {
    ...prepared.data,
    gmailReply: normalizeCompanyGmailReplyHeaders([
      { name: 'From', value: 'Guest <guest@example.invalid>' },
      { name: 'Reply-To', value: 'guest@example.invalid' },
      { name: 'Message-ID', value: '<source@example.invalid>' },
      { name: 'References', value: '' },
      { name: 'Subject', value: 'Question' },
    ], 'thread_source'),
  };
  const inboxCase = nextInboxCaseOnMessage(null, data, NOW);
  const db = createFakeFirestore({
    [`external_inbox_messages/${prepared.docId}`]: data,
    [`external_inbox_cases/${data.caseId}`]: inboxCase,
  });
  const inboxConfig = { ready: true, accountId: ACCOUNT, captureStartAtMs: NOW - 86_400_000 };
  const resolver = createCompanyGmailReplyResolver({ db, inboxConfig, now: () => NOW });
  return {
    actorUid,
    db,
    prepared,
    resolver,
    request: {
      messageId: prepared.docId,
      channel: 'email',
      text: REPLY_TEXT,
      expectedSourceAtMs: NOW - 10_000,
      key: KEY,
    },
  };
}

function handlerFor(value: Fixture, overrides: Record<string, unknown> = {}) {
  return createAdminCompanyEmailReplyHandler({
    env,
    now: () => NOW,
    authenticate: vi.fn(async () => ({ ok: true, uid: value.actorUid })),
    loadDb: async () => value.db,
    resolverFactory: () => value.resolver,
    ...overrides,
  });
}

async function call(handler: ReturnType<typeof createAdminCompanyEmailReplyHandler>, {
  method = 'POST', body, id, origin = 'https://cocotripkr.com',
}: { method?: string; body?: unknown; id?: string; origin?: string } = {}) {
  const output: { status?: number; body?: string } = {};
  const url = id ? `${BASE_URL}?id=${id}` : BASE_URL;
  await handler({
    method,
    url,
    headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json', origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, {
    writeHead: (status: number) => { output.status = status; },
    end: (body?: string) => { output.body = body; },
  });
  return { ...output, data: output.body ? JSON.parse(output.body) : null };
}

function draftAction(request: Fixture['request']) {
  return { action: 'draft', request };
}

function sendAction(request: Fixture['request'], draft: { revision: number; draftHash: string }) {
  return {
    action: 'send',
    request,
    expectedRevision: draft.revision,
    expectedDraftHash: draft.draftHash,
    expectedApprovalExpiresAtMs: 0,
    confirmed: true,
  };
}

function response(status: number, value: unknown) {
  const body = JSON.stringify(value);
  return new Response(body, { status, headers: { 'content-length': String(Buffer.byteLength(body)) } });
}

afterEach(() => vi.unstubAllGlobals());

describe('admin company email reply handler', () => {
  it('keeps disabled, unauthenticated, and evil-origin requests outside Firestore', async () => {
    const value = setup();
    const loadDb = vi.fn(async () => value.db);
    const disabled = handlerFor(value, {
      env: { ...env, COMPANY_GMAIL_REPLY_ENABLED: 'false' },
      loadDb,
    });
    const disabledResult = await call(disabled, { method: 'GET', id: value.prepared.docId });
    expect(disabledResult).toMatchObject({ status: 200, data: { ok: true, data: { reason: 'REPLY_DISABLED', canCompose: false } } });
    expect(loadDb).not.toHaveBeenCalled();

    const noAuth = handlerFor(value, { authenticate: vi.fn(async () => ({ ok: false, status: 401 })), loadDb });
    expect(await call(noAuth, { method: 'GET', id: value.prepared.docId })).toMatchObject({ status: 401, data: { code: 'ADMIN_REQUIRED' } });

    const evilOrigin = await call(handlerFor(value, { loadDb }), {
      method: 'GET', id: value.prepared.docId, origin: 'https://evil.invalid',
    });
    expect(evilOrigin).toMatchObject({ status: 403, data: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('requires exact actions and an explicit send confirmation', async () => {
    const value = setup();
    expect(validCompanyEmailReplyAction({ ...draftAction(value.request), extra: 'not-allowed' })).toBe(false);
    expect(validCompanyEmailReplyAction({ ...sendAction(value.request, { revision: 1, draftHash: 'a'.repeat(64) }), confirmed: false })).toBe(false);
    const result = await call(handlerFor(value), {
      body: { ...sendAction(value.request, { revision: 1, draftHash: 'a'.repeat(64) }), confirmed: false },
    });
    expect(result).toMatchObject({ status: 400, data: { code: 'INVALID_REQUEST' } });
  });

  it('uses the prepared document id through draft, GET, and provider acceptance', async () => {
    const value = setup();
    const sender = vi.fn(async () => ({
      status: 'provider_accepted', receiptVerified: true, providerMessageId: 'provider-receipt',
    }));
    const handler = handlerFor(value, { senderFactory: () => sender });
    const draft = await call(handler, { body: draftAction(value.request) });
    expect(draft).toMatchObject({ status: 200, data: { ok: true, status: 'draft' } });

    const view = await call(handler, { method: 'GET', id: value.prepared.docId });
    expect(view).toMatchObject({ status: 200, data: { ok: true, data: { workflow: { status: 'draft' } } } });

    const sent = await call(handler, { body: sendAction(value.request, draft.data) });
    expect(sent).toMatchObject({ status: 200, data: { ok: true, status: 'provider_accepted', deliveryVerified: false } });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0]).toMatchObject({ authorizationExpiresAtMs: NOW + 300_000 });
  });

  it('rejects a source with a different case and a workflow owned by another actor', async () => {
    const foreign = setup();
    foreign.db.__patch(`external_inbox_messages/${foreign.prepared.docId}`, { caseId: 'b'.repeat(64) });
    expect(await call(handlerFor(foreign), { method: 'GET', id: foreign.prepared.docId }))
      .toMatchObject({ status: 404, data: { code: 'SOURCE_CONTEXT_INVALID' } });

    const owner = setup();
    const sender = vi.fn(async () => ({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'never-used' }));
    const draft = await call(handlerFor(owner, { senderFactory: () => sender }), { body: draftAction(owner.request) });
    const otherActor = handlerFor(owner, {
      authenticate: vi.fn(async () => ({ ok: true, uid: 'different-admin' })),
      senderFactory: () => sender,
    });
    expect(await call(otherActor, { body: sendAction(owner.request, draft.data) }))
      .toMatchObject({ status: 409, data: { code: 'LEDGER_CONFLICT' } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('quarantines unknown delivery and never invokes the sender twice', async () => {
    const value = setup();
    const sender = vi.fn(async () => ({ status: 'outcome_unknown' }));
    const handler = handlerFor(value, { senderFactory: () => sender });
    const draft = await call(handler, { body: draftAction(value.request) });
    const action = sendAction(value.request, draft.data);
    expect(await call(handler, { body: action })).toMatchObject({ status: 409, data: { code: 'DELIVERY_UNCERTAIN' } });
    expect(await call(handler, { body: action })).toMatchObject({ status: 409 });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('exercises the Gmail sender with fake HTTP only', async () => {
    const value = setup();
    const fakeHttp = vi.fn(async (url: string, options: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        expect(options.method).toBe('POST');
        return response(200, {
          access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata',
        });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress') {
        return response(200, { emailAddress: ACCOUNT });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        const payload = JSON.parse(String(options.body));
        expect(payload).toMatchObject({ threadId: 'thread_source', raw: expect.any(String) });
        return response(200, { id: 'gmail-accepted', threadId: 'thread_source' });
      }
      throw new Error(`unexpected fake HTTP URL: ${url}`);
    });
    vi.stubGlobal('fetch', fakeHttp);
    const handler = handlerFor(value);
    const draft = await call(handler, { body: draftAction(value.request) });
    const sent = await call(handler, { body: sendAction(value.request, draft.data) });
    expect(sent).toMatchObject({ status: 200, data: { status: 'provider_accepted' } });
    expect(fakeHttp.mock.calls.map(([url]) => url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ]);
  });
});
