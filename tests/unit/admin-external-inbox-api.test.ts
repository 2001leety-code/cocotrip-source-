import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), init: vi.fn() }));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: dependencies.authorize }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: dependencies.init }));
import handler from '../../api/admin-external-inbox.js';
import { prepareExternalInboxMessage } from '../../api/_shared/external-inbox-store.js';
import { nextInboxCaseOnMessage } from '../../api/_shared/external-inbox-retention.js';

const NOW = Date.parse('2026-09-08T06:00:00.000Z');
const START = NOW - 60_000;
const PRIVATE = 'SYNTHETIC_PRIVATE_BODY_ERROR_CURSOR_TOKEN';
type Row = Record<string, unknown>;
function enable() {
  for (const [key, value] of Object.entries({ COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com',
    COMPANY_GMAIL_INBOX_CLIENT_ID: 'fake-only', COMPANY_GMAIL_INBOX_CLIENT_SECRET: PRIVATE, COMPANY_GMAIL_INBOX_REFRESH_TOKEN: PRIVATE,
    COMPANY_GMAIL_INBOX_CAPTURE_START_AT: new Date(START).toISOString(), COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30' })) vi.stubEnv(key, value);
}
function enableSecondary() {
  for (const [key, value] of Object.entries({ ENABLED: 'true', EMAIL: '2001leety@gmail.com', CLIENT_ID: 'fake-secondary',
    CLIENT_SECRET: PRIVATE, REFRESH_TOKEN: PRIVATE, CAPTURE_START_AT: new Date(START).toISOString(),
    RETENTION_DAYS: '30', LABEL_ID: 'Label_synthetic_work' })) vi.stubEnv('SECONDARY_GMAIL_INBOX_' + key, value);
}
function record(extra: Row = {}, accountId = 'cocotripkr@gmail.com') {
  const prepared = prepareExternalInboxMessage({ channel: 'email', accountId, providerMessageId: 'fake_id',
    providerThreadId: 'fake_thread', sourceAtMs: NOW - 1000, sender: 'Synthetic sender', subject: 'Synthetic subject', text: PRIVATE, kind: 'email' },
  { nowMs: NOW, retentionDays: 30 });
  return { id: prepared.docId, data: { ...prepared.data, ...extra }, caseData: nextInboxCaseOnMessage(null, prepared.data, NOW) };
}
function fakeDb(documents: { id: string; data: Row; caseData?: Row }[] = []) {
  const reads: string[] = [];
  const writes = vi.fn(() => { throw new Error('WRITE_FORBIDDEN'); });
  let failList = false;
  let failDetail = false;
  let hangList = false;
  let hangDetail = false;
  const db = { collection: (name: string) => {
    const query = {
      where: () => query, select: () => query, limit: () => query, orderBy: () => query,
      set: writes, update: writes, delete: writes,
      get: async () => {
        reads.push(`${name}:list`);
        if (failList) throw new Error(PRIVATE);
        if (hangList) return new Promise<never>(() => {});
        return { docs: name === 'external_inbox_messages' ? documents.map(doc => ({ id: doc.id, data: () => doc.data })) : [] };
      },
      doc: (id: string) => ({
        get: async () => { reads.push(`${name}/${id}`); if (failDetail) throw new Error(PRIVATE);
          if (hangDetail) return new Promise<never>(() => {});
          const found = name === 'external_inbox_cases'
            ? documents.find(doc => doc.data.caseId === id && doc.caseData)
            : documents.find(doc => doc.id === id);
          return { id, exists: Boolean(found), data: () => name === 'external_inbox_cases' ? found?.caseData : found?.data }; },
        set: writes, update: writes, delete: writes,
      }),
    };
    return query;
  } };
  return { db, reads, writes, setFailList: () => { failList = true; }, setFailDetail: () => { failDetail = true; },
    setHangList: () => { hangList = true; }, setHangDetail: () => { hangDetail = true; } };
}
async function request(method = 'GET', query = '', origin = 'https://cocotripkr.com') {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  await handler({ method, url: `/api/admin-external-inbox${query}`, headers: { origin } }, response);
  const body = response.end.mock.calls[0]?.[0];
  return { status: response.writeHead.mock.calls[0][0], headers: response.writeHead.mock.calls[0][1], body: body ? JSON.parse(body) : null };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); }));
  dependencies.authorize.mockResolvedValue({ ok: true }); dependencies.init.mockReturnValue(fakeDb().db);
  vi.stubEnv('VERCEL_ENV', 'production');
  for (const key of ['COMPANY_GMAIL_INBOX_ENABLED', 'SECONDARY_GMAIL_INBOX_ENABLED', 'WHATSAPP_INBOX_ENABLED']) vi.stubEnv(key, 'false');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('admin external inbox authorization and configuration boundaries', () => {
  it.each([401, 403])('rejects %i before DB bootstrap and provider calls', async status => {
    enable(); dependencies.authorize.mockResolvedValue({ ok: false, status, error: PRIVATE });
    const result = await request(); expect(result.status).toBe(status); expect(result.body).toEqual({ ok: false, error: 'ADMIN_REQUIRED' });
    expect(dependencies.init).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it('checks auth before malformed queries (no unauthenticated resource probing)', async () => {
    dependencies.authorize.mockResolvedValue({ ok: false, status: 401 });
    expect((await request('GET', '?id=../other')).status).toBe(401); expect(dependencies.init).not.toHaveBeenCalled();
  });
  it('fails safely when authorization itself throws', async () => {
    dependencies.authorize.mockRejectedValue(new Error(PRIVATE));
    const result = await request(); expect(result).toMatchObject({ status: 503, body: { ok: false, error: 'INBOX_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(dependencies.init).not.toHaveBeenCalled();
  });
  it('serves OPTIONS and refuses writes without reading or mutating storage', async () => {
    expect((await request('OPTIONS')).status).toBe(200);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) expect((await request(method)).status).toBe(405);
    expect(dependencies.authorize).not.toHaveBeenCalled(); expect(dependencies.init).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns disabled channels with no Firestore initialization or lookups', async () => {
    const result = await request(); expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ listStatus: 'not_connected', messages: [], channels: [
      { channel: 'email', accountId: 'cocotripkr@gmail.com', status: 'disabled' },
      { channel: 'email', accountId: '2001leety@gmail.com', status: 'disabled' },
      { channel: 'whatsapp', status: 'disabled' },
    ] });
    expect(dependencies.init).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not query storage when enabled but required retention/cutover settings are absent', async () => {
    enable(); vi.stubEnv('COMPANY_GMAIL_INBOX_RETENTION_DAYS', '');
    expect((await request()).body.data.channels[0].status).toBe('not_configured'); expect(dependencies.init).not.toHaveBeenCalled();
  });
  it.each(['preview', 'development'])('cannot read the production inbox in Vercel %s', async deployment => {
    enable(); vi.stubEnv('VERCEL_ENV', deployment);
    const result = await request(); expect(result.body.data.channels[0].status).toBe('disabled');
    expect(result.body.data.listStatus).toBe('not_connected'); expect(dependencies.init).not.toHaveBeenCalled();
    expect((await request('GET', `?id=${record().id}`)).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });
  it('makes direct detail unavailable while channels are off', async () => {
    expect((await request('GET', `?id=${record().id}`))).toMatchObject({ status: 404, body: { error: 'MESSAGE_NOT_AVAILABLE' } });
    expect(dependencies.init).not.toHaveBeenCalled();
  });
  it.each(['?channel=email', '?text=true', '?cursor=next', '?id=', '?id=../../secret', '?id=abcd', `?id=${'A'.repeat(64)}`, `?id=${'a'.repeat(64)}&id=${'b'.repeat(64)}`])('rejects malformed or expanded query %s before DB', async query => {
    enable(); expect((await request('GET', query))).toMatchObject({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(dependencies.init).not.toHaveBeenCalled();
  });
});

describe('live helper wiring against synthetic storage only', () => {
  it('lists the fixed email account and safe summaries without message body, provider cursor, token or writes', async () => {
    enable(); const doc = record({ cursorHistoryId: PRIVATE, accessToken: PRIVATE, html: PRIVATE }); const f = fakeDb([doc]); dependencies.init.mockReturnValue(f.db);
    const result = await request(); expect(result.status).toBe(200); expect(result.body.data.messages).toHaveLength(1);
    expect(result.body.data.messages[0]).not.toHaveProperty('text');
    expect(result.body.data.messages[0]).toMatchObject({ accountId: 'cocotripkr@gmail.com', replySupported: true });
    expect(Object.keys(result.body.data.messages[0]).sort()).toEqual([
      'id', 'channel', 'sourceAtMs', 'receivedAtMs', 'sender', 'subject', 'kind', 'truncated', 'accountId', 'replySupported', 'retention',
    ].sort());
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(f.reads).toContain('external_inbox_messages:list');
    expect(f.reads).toContain(`external_inbox_cases/${doc.data.caseId}`); expect(f.reads).not.toContain(`external_inbox_messages/${doc.id}`);
    expect(f.writes).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': 'https://cocotripkr.com' });
  });
  it('returns only the enabled secondary mailbox and denies the primary detail with synthetic storage', async () => {
    enableSecondary();
    const secondary = record({}, '2001leety@gmail.com'); const primary = record();
    const f = fakeDb([secondary, primary]); dependencies.init.mockReturnValue(f.db);
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.body.data.messages).toHaveLength(1);
    expect(result.body.data.messages[0]).toMatchObject({ accountId: '2001leety@gmail.com', replySupported: false });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect((await request('GET', `?id=${secondary.id}`)).body.data).toMatchObject({ accountId: '2001leety@gmail.com', replySupported: false });
    expect((await request('GET', `?id=${primary.id}`)).status).toBe(404);
    expect(f.writes).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns stored plain preview only for an explicit valid message ID', async () => {
    enable(); const doc = record(); const f = fakeDb([doc]); dependencies.init.mockReturnValue(f.db);
    const result = await request('GET', `?id=${doc.id}`); expect(result.status).toBe(200); expect(result.body.data.text).toBe(PRIVATE);
    expect(f.reads).toEqual([`external_inbox_messages/${doc.id}`, `external_inbox_cases/${doc.data.caseId}`]); expect(f.writes).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it.each([
    ['company mismatch', { accountId: 'personal@example.invalid' }], ['before cutover', { sourceAtMs: START - 1 }],
    ['expired', { expiresAtMs: NOW }], ['digest mismatch', { providerMessageId: 'different' }],
  ])('denies direct-ID %s without exposing content', async (_label, invalid) => {
    enable(); const doc = record(invalid); dependencies.init.mockReturnValue(fakeDb([doc]).db);
    const result = await request('GET', `?id=${doc.id}`); expect(result.status).toBe(404); expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  it('preserves HTTP 200 unknown list status distinct from genuine zero records', async () => {
    enable(); const f = fakeDb(); dependencies.init.mockReturnValue(f.db);
    const empty = await request(); expect(empty).toMatchObject({ status: 200, body: { ok: true, data: { messages: [], listStatus: 'ok' } } });
    f.setFailList(); const failed = await request();
    expect(failed).toMatchObject({ status: 200, body: { ok: true, data: { messages: [], listStatus: 'unknown' } } });
    expect(failed.body.data.channels[0].status).toBe('unknown'); expect(JSON.stringify(failed)).not.toContain(PRIVATE);
  });
  it('returns a sanitized 503 for missing storage or detail read failure, never 404/empty success', async () => {
    enable(); dependencies.init.mockReturnValue(null); expect((await request()).status).toBe(503);
    const f = fakeDb([record()]); f.setFailDetail(); dependencies.init.mockReturnValue(f.db);
    const result = await request('GET', `?id=${record().id}`); expect(result).toMatchObject({ status: 503, body: { error: 'INBOX_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it('returns HTTP 200 unknown after actual bounded state/list timeouts', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); enable();
    const f = fakeDb(); f.setHangList(); dependencies.init.mockReturnValue(f.db);
    const run = request(); await vi.advanceTimersByTimeAsync(6001);
    const result = await run;
    expect(result).toMatchObject({ status: 200, body: { ok: true, data: { listStatus: 'unknown', channels: [
      { channel: 'email', accountId: 'cocotripkr@gmail.com', status: 'unknown' },
      { channel: 'email', accountId: '2001leety@gmail.com', status: 'disabled' },
      { channel: 'whatsapp', status: 'disabled' },
    ] } } });
    expect(result.headers['Cache-Control']).toBe('no-store'); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns HTTP 503 after the actual bounded detail timeout', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); enable();
    const f = fakeDb([record()]); f.setHangDetail(); dependencies.init.mockReturnValue(f.db);
    const run = request('GET', `?id=${record().id}`); await vi.advanceTimersByTimeAsync(3001);
    expect(await run).toMatchObject({ status: 503, body: { ok: false, error: 'INBOX_UNAVAILABLE' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not allow arbitrary browser origins and keeps the lazy bootstrap after auth/config', async () => {
    const result = await request('GET', '', 'https://unrelated.example.invalid');
    expect(result.headers).not.toHaveProperty('Access-Control-Allow-Origin'); expect(result.headers.Vary).toBe('Origin');
    const source = readFileSync('api/admin-external-inbox.js', 'utf8');
    const bootstrap = source.indexOf("await import('./_shared/firebase-admin.js')");
    expect(bootstrap).toBeGreaterThan(source.indexOf('await verifyAdminToken(req)'));
    expect(bootstrap).toBeGreaterThan(source.indexOf('const ready ='));
  });
});
