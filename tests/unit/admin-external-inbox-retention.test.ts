import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { createAdminExternalInboxRetentionHandler } from '../../api/admin-external-inbox-retention.js';
import { prepareExternalInboxMessage, EXTERNAL_INBOX_MESSAGES_COLLECTION } from '../../api/_shared/external-inbox-store.js';
import { INBOX_CASES_COLLECTION, nextInboxCaseOnMessage, transitionInboxCase } from '../../api/_shared/external-inbox-retention.js';

const NOW = Date.parse('2026-09-09T08:00:00.000Z');
const START = NOW - 60_000;
const PRIVATE = 'SYNTHETIC_PRIVATE_INBOX_BODY_TOKEN';
const messageId = 'a'.repeat(64);
const env = () => ({ VERCEL_ENV: 'production', COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com',
  COMPANY_GMAIL_INBOX_CLIENT_ID: 'synthetic-client', COMPANY_GMAIL_INBOX_CLIENT_SECRET: PRIVATE,
  COMPANY_GMAIL_INBOX_REFRESH_TOKEN: PRIVATE, COMPANY_GMAIL_INBOX_CAPTURE_START_AT: new Date(START).toISOString(), COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30' });

function seeded() {
  const prepared = prepareExternalInboxMessage({ channel: 'email', accountId: 'cocotripkr@gmail.com', providerMessageId: 'message-1',
    providerThreadId: 'thread-1', sourceAtMs: NOW - 1_000, sender: 'Synthetic sender', subject: 'Synthetic subject', text: PRIVATE, kind: 'email' },
  { nowMs: NOW, retentionDays: 30 });
  const inboxCase = nextInboxCaseOnMessage(null, prepared.data, NOW);
  const db = createFakeFirestore({ [`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${prepared.docId}`]: prepared.data,
    [`${INBOX_CASES_COLLECTION}/${inboxCase.caseId}`]: inboxCase });
  return { db, prepared, inboxCase };
}

function handler(fixture = seeded(), overrides: Record<string, unknown> = {}) {
  return { fixture, api: createAdminExternalInboxRetentionHandler({ authenticate: async () => ({ ok: true, uid: 'admin-user' }),
    loadDb: async () => fixture.db, now: () => NOW, env: env(), ...overrides }) };
}
async function call(api: ReturnType<typeof createAdminExternalInboxRetentionHandler>, body: unknown,
  method = 'POST', headers: Record<string, string> = { origin: 'https://cocotripkr.com', 'content-type': 'application/json' }) {
  const res = { writeHead: vi.fn(), end: vi.fn() };
  await api({ method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, res);
  return { status: res.writeHead.mock.calls[0]?.[0], headers: res.writeHead.mock.calls[0]?.[1], body: JSON.parse(res.end.mock.calls[0]?.[0] || '{}') };
}
const closeBody = (id = messageId, revision = 1) => ({ messageId: id, expectedRevision: revision, action: 'close', confirmation: 'ordinary_no_evidence' });

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('admin external inbox retention transition API', () => {
  it('authenticates before storage and permits only POST/OPTIONS with no-store CORS', async () => {
    const { fixture, api } = handler(seeded(), { authenticate: async () => ({ ok: false, status: 403 }) });
    const denied = await call(api, closeBody());
    expect(denied).toMatchObject({ status: 403, body: { error: 'ADMIN_REQUIRED' } });
    expect(fixture.db.__stats.transactions).toBe(0);
    const { api: methods } = handler();
    expect((await call(methods, {}, 'OPTIONS')).status).toBe(200);
    expect((await call(methods, {}, 'GET')).status).toBe(405);
    expect(denied.headers).toMatchObject({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  });

  it('closes only the current consent-checked case and writes no message fields', async () => {
    const { fixture, api } = handler(); const beforeMessage = fixture.db.__get(`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${fixture.prepared.docId}`);
    const result = await call(api, closeBody(fixture.prepared.docId));
    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { caseId: fixture.inboxCase.caseId, status: 'closed', revision: 2 } } });
    expect(fixture.db.__get(`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${fixture.prepared.docId}`)).toEqual(beforeMessage);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });

  it.each([
    [{ messageId: 'a'.repeat(64), expectedRevision: 1, action: 'close' }],
    [{ ...closeBody(), extra: 'nope' }],
    [{ ...closeBody(), confirmation: 'wrong' }],
    [{ ...closeBody(), messageId: '../foreign' }],
    [JSON.stringify({ ...closeBody(), padding: 'x'.repeat(3_000) })],
  ])('rejects unknown, invalid, or oversized body before DB (%j)', async body => {
    const { fixture, api } = handler(); const result = await call(api, body as unknown);
    expect(result).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } }); expect(fixture.db.__stats.transactions).toBe(0);
  });

  it('returns 404 for disabled, legacy, foreign, or expired source context without transition writes', async () => {
    const disabled = handler(seeded(), { env: { VERCEL_ENV: 'production' } });
    expect((await call(disabled.api, closeBody(disabled.fixture.prepared.docId))).status).toBe(404); expect(disabled.fixture.db.__stats.transactions).toBe(0);
    const legacy = handler(); legacy.fixture.db.__patch(`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${legacy.fixture.prepared.docId}`, { retentionPolicyVersion: undefined });
    expect((await call(legacy.api, closeBody(legacy.fixture.prepared.docId))).status).toBe(404);
    const foreign = handler(); foreign.fixture.db.__patch(`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/${foreign.fixture.prepared.docId}`, { accountId: 'personal@example.invalid' });
    expect((await call(foreign.api, closeBody(foreign.fixture.prepared.docId))).status).toBe(404);
  });

  it('keeps protected cases non-reopenable/non-closeable and maps stale revisions to 409', async () => {
    const protectedFixture = seeded(); const protectedCase = transitionInboxCase(protectedFixture.inboxCase,
      { action: 'protect', expectedRevision: 1, nowMs: NOW });
    protectedFixture.db.__set(`${INBOX_CASES_COLLECTION}/${protectedCase.caseId}`, protectedCase);
    const protectedApi = handler(protectedFixture).api;
    expect((await call(protectedApi, closeBody(protectedFixture.prepared.docId, 2)))).toMatchObject({ status: 409, body: { error: 'CASE_TRANSITION_CONFLICT' } });
    const { fixture, api } = handler();
    expect((await call(api, closeBody(fixture.prepared.docId, 99)))).toMatchObject({ status: 409, body: { error: 'CASE_TRANSITION_CONFLICT' } });
  });

  it('hides an expired closed case and refuses non-JSON input before any transaction', async () => {
    const expiredFixture = seeded(); const closed = transitionInboxCase(expiredFixture.inboxCase,
      { action: 'close', expectedRevision: 1, confirmation: 'ordinary_no_evidence', nowMs: NOW });
    expiredFixture.db.__set(`${INBOX_CASES_COLLECTION}/${closed.caseId}`, closed);
    const expired = handler(expiredFixture, { now: () => closed.deleteAfterMs });
    expect((await call(expired.api, closeBody(expiredFixture.prepared.docId, 2)))).toMatchObject({ status: 404, body: { error: 'MESSAGE_NOT_AVAILABLE' } });
    const { fixture, api } = handler();
    const invalid = await call(api, closeBody(fixture.prepared.docId), 'POST', { origin: 'https://cocotripkr.com', 'content-type': 'text/plain' });
    expect(invalid).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } }); expect(fixture.db.__stats.transactions).toBe(0);
  });

  it('rechecks the clock after transactional reads so a slow request cannot cross an expiry or move time backward', async () => {
    const slowFixture = seeded(); const closed = transitionInboxCase(slowFixture.inboxCase,
      { action: 'close', expectedRevision: 1, confirmation: 'ordinary_no_evidence', nowMs: NOW });
    slowFixture.db.__set(`${INBOX_CASES_COLLECTION}/${closed.caseId}`, closed);
    const beforeExpiry = closed.deleteAfterMs - 1;
    const clock = vi.fn().mockReturnValueOnce(beforeExpiry).mockReturnValueOnce(closed.deleteAfterMs);
    const slow = handler(slowFixture, { now: clock });
    expect((await call(slow.api, closeBody(slowFixture.prepared.docId, 2))).status).toBe(404);
    expect(slowFixture.db.__get(`${INBOX_CASES_COLLECTION}/${closed.caseId}`)).toEqual(closed);
    const backwardsFixture = seeded(); const backwards = handler(backwardsFixture, { now: vi.fn().mockReturnValueOnce(NOW).mockReturnValueOnce(NOW - 1) });
    expect((await call(backwards.api, closeBody(backwardsFixture.prepared.docId))).status).toBe(404);
    expect(backwardsFixture.db.__get(`${INBOX_CASES_COLLECTION}/${backwardsFixture.inboxCase.caseId}`)).toEqual(backwardsFixture.inboxCase);
  });

  it('does not expose the production inbox from non-production or disallowed origins', async () => {
    const preview = handler(seeded(), { env: { ...env(), VERCEL_ENV: 'preview' } });
    expect((await call(preview.api, closeBody(preview.fixture.prepared.docId)))).toMatchObject({ status: 503, body: { error: 'INBOX_UNAVAILABLE' } });
    expect(preview.fixture.db.__stats.transactions).toBe(0);
    const { fixture, api } = handler(); const rejected = await call(api, closeBody(fixture.prepared.docId), 'POST',
      { origin: 'https://unrelated.example.invalid', 'content-type': 'application/json' });
    expect(rejected.status).toBe(403); expect(rejected.headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });
});
