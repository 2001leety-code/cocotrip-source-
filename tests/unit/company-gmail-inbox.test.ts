import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COMPANY_GMAIL_ACCOUNT, COMPANY_GMAIL_STATE_ID, companyGmailInboxSweepTask, readCompanyGmailInboxConfig,
} from '../../api/_shared/company-gmail-inbox.js';
import handler from '../../api/_crons/company-gmail-inbox-sweep.js';

const authorize = vi.hoisted(() => vi.fn());
vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: authorize }));
const NOW = Date.parse('2026-09-08T05:00:00.000Z');
const START = NOW - 3_600_000;
const PRIVATE = 'SYNTHETIC_PRIVATE_NO_LOGS';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STATE = `external_inbox_state/${COMPANY_GMAIL_STATE_ID}`;
type Row = Record<string, unknown>;
type Ref = { path: string };
type Snapshot = { exists: boolean; data: () => Row | undefined };
type Write = { mode: 'set' | 'create' | 'update'; ref: Ref; data: Row };

function environment() {
  return { COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: COMPANY_GMAIL_ACCOUNT,
    COMPANY_GMAIL_INBOX_CLIENT_ID: PRIVATE + '_ID', COMPANY_GMAIL_INBOX_CLIENT_SECRET: PRIVATE + '_SECRET',
    COMPANY_GMAIL_INBOX_REFRESH_TOKEN: PRIVATE + '_REFRESH', COMPANY_GMAIL_INBOX_CAPTURE_START_AT: new Date(START).toISOString(),
    COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30' };
}

/** Serial, staged transactions reject reads after writes and any original business-collection mutation. */
function memoryStore() {
  const rows = new Map<string, Row>();
  const writes: Write[] = [];
  let chain = Promise.resolve();
  let rejectMessage = false;
  let uncertainMessage = false;
  const db = {
    collection: (name: string) => ({ doc: (id: string): Ref => ({ path: `${name}/${id}` }) }),
    runTransaction: async <T,>(fn: (tx: {
      get: (ref: Ref) => Promise<Snapshot>; set: (ref: Ref, data: Row) => void;
      update: (ref: Ref, data: Row) => void; create: (ref: Ref, data: Row) => void;
    }) => Promise<T>) => {
      const previous = chain;
      let release = () => {};
      chain = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const staged: Write[] = [];
        const write = (mode: Write['mode'], ref: Ref, data: Row) => staged.push({ mode, ref, data: structuredClone(data) });
        const result = await fn({
          get: async (ref) => {
            if (staged.length) throw new Error('READ_AFTER_WRITE');
            return { exists: rows.has(ref.path), data: () => rows.has(ref.path) ? structuredClone(rows.get(ref.path)) : undefined };
          },
          set: (ref, data) => { write('set', ref, data); }, update: (ref, data) => { write('update', ref, data); },
          create: (ref, data) => { write('create', ref, data); },
        });
        const hasMessage = staged.some((entry) => entry.ref.path.startsWith('external_inbox_messages/'));
        if (rejectMessage && hasMessage) throw new Error(PRIVATE);
        for (const entry of staged) {
          if (!/^(external_inbox_state|external_inbox_messages|external_inbox_cases)\/[A-Za-z0-9_]+$/.test(entry.ref.path)) throw new Error('OUT_OF_SCOPE_WRITE');
          if (entry.mode === 'create' && rows.has(entry.ref.path)) throw new Error('DUPLICATE_CREATE');
          if (entry.mode === 'update' && !rows.has(entry.ref.path)) throw new Error('MISSING_STATE');
        }
        for (const entry of staged) {
          rows.set(entry.ref.path, entry.mode === 'update' ? { ...rows.get(entry.ref.path), ...entry.data } : entry.data);
          writes.push(entry);
        }
        if (uncertainMessage && hasMessage) { uncertainMessage = false; throw new Error(PRIVATE); }
        return result;
      } finally { release(); }
    },
  };
  return { db, rows, writes, setRejectMessage: (flag: boolean) => { rejectMessage = flag; },
    setUncertainMessage: () => { uncertainMessage = true; } };
}

function message(id: string, extra: Row = {}) {
  return { id, threadId: `thread_${id}`, internalDate: String(NOW - 10_000), labelIds: ['INBOX', 'UNREAD'],
    snippet: PRIVATE + '_preview', payload: { headers: [{ name: 'From', value: 'Fake Sender <sender@example.invalid>' },
      { name: 'Subject', value: PRIVATE + '_subject' }] }, ...extra };
}
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function fixture() {
  const store = memoryStore();
  let current = NOW;
  const env = environment();
  const api = {
    token: vi.fn(async () => response({ access_token: PRIVATE + '_ACCESS', token_type: 'Bearer', scope: SCOPE })),
    profile: vi.fn(async () => response({ emailAddress: COMPANY_GMAIL_ACCOUNT, historyId: '100' })),
    list: vi.fn(async (url: URL) => { void url; return response({ messages: [] }); }),
    history: vi.fn(async (url: URL) => { void url; return response({ history: [], historyId: '200' }); }),
    message: vi.fn(async (id: string) => response(message(id))),
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      expect(init.method).toBe('POST');
      expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token');
      return api.token();
    }
    expect(url.origin).toBe('https://gmail.googleapis.com');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(url.searchParams.has('access_token')).toBe(false);
    const endpoint = url.pathname.replace('/gmail/v1/users/me/', '');
    if (endpoint === 'profile') return api.profile();
    if (endpoint === 'messages') return api.list(url);
    if (endpoint === 'history') { expect(url.searchParams.get('labelId')).toBe('INBOX'); return api.history(url); }
    if (/^messages\/[A-Za-z0-9_-]+$/.test(endpoint)) {
      expect(url.searchParams.get('format')).toBe('metadata');
      expect(url.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
      expect(url.searchParams.get('fields')).toBe('id,threadId,internalDate,labelIds,snippet,payload/headers');
      return api.message(endpoint.split('/')[1]);
    }
    throw new Error('FORBIDDEN_PROVIDER_ENDPOINT');
  });
  const loadServices = vi.fn(async () => ({ db: store.db }));
  const run = () => companyGmailInboxSweepTask({ env, fetchImpl, loadServices, now: () => current });
  const messages = () => [...store.rows].filter(([key]) => key.startsWith('external_inbox_messages/')).map(([, data]) => data);
  const state = () => store.rows.get(STATE) || {};
  return { ...store, env, api, fetchImpl, loadServices, run, messages, state, setNow: (time: number) => { current = time; } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('company Gmail configuration (no account files or provider I/O)', () => {
  it('returns only safe configuration data, not OAuth values', () => {
    const config = readCompanyGmailInboxConfig(environment(), NOW);
    expect(config).toEqual({ enabled: true, ready: true, status: 'ready', reason: null,
      accountId: COMPANY_GMAIL_ACCOUNT, captureStartAtMs: START, retentionDays: 30, missing: [] });
    expect(JSON.stringify(config)).not.toContain(PRIVATE);
  });
  it.each(['', 'false', '1', 'yes', 'TRUE'])('does no I/O when enabled is %s', async (enabled) => {
    const f = fixture(); f.env.COMPANY_GMAIL_INBOX_ENABLED = enabled;
    expect(await f.run()).toMatchObject({ ok: true, code: 'DISABLED', status: 'disabled' });
    expect(f.loadServices).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['preview', 'development', 'unknown', '', '   ', null, ' production '])('blocks all worker I/O in Vercel %s even when credentials and enabled are present', async deployment => {
    const f = fixture(); Object.assign(f.env, { VERCEL_ENV: deployment });
    expect(readCompanyGmailInboxConfig(f.env, NOW)).toMatchObject({ enabled: false, ready: false, status: 'disabled', reason: 'PRODUCTION_ONLY' });
    expect(await f.run()).toMatchObject({ ok: true, enabled: false, status: 'disabled', code: 'PRODUCTION_ONLY' });
    expect(f.loadServices).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.rows.size).toBe(0);
  });
  it('permits explicit production and an absent Vercel runtime for isolated tests/future VPS adapters', () => {
    expect(readCompanyGmailInboxConfig({ ...environment(), VERCEL_ENV: 'production' }, NOW).ready).toBe(true);
    expect(readCompanyGmailInboxConfig(environment(), NOW).ready).toBe(true);
  });
  it.each(['EMAIL', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'CAPTURE_START_AT', 'RETENTION_DAYS'])('fails closed when %s is missing', async (name) => {
    const f = fixture(); Object.assign(f.env, { [`COMPANY_GMAIL_INBOX_${name}`]: '' });
    expect(await f.run()).toMatchObject({ ok: false, code: 'CONFIGURATION_REQUIRED' });
    expect(f.loadServices).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['personal@example.invalid', 'othercompany@gmail.com'])('does not accept a different account %s', async (email) => {
    const f = fixture(); f.env.COMPANY_GMAIL_INBOX_EMAIL = email;
    expect(await f.run()).toMatchObject({ code: 'COMPANY_ACCOUNT_REQUIRED' }); expect(f.rows.size).toBe(0);
  });
  it.each(['', '0', '91', '365', '1.5', '-1', '30days'])('rejects invalid retention %s', (retention) => {
    const env = { ...environment(), COMPANY_GMAIL_INBOX_RETENTION_DAYS: retention };
    expect(readCompanyGmailInboxConfig(env, NOW).ready).toBe(false);
  });
  it.each(['2026-09-08', '2026-02-30T00:00:00.000Z', '2026-09-09T00:00:00.000Z', 'tomorrow'])('rejects ambiguous/invalid/future cutover %s', (start) => {
    expect(readCompanyGmailInboxConfig({ ...environment(), COMPANY_GMAIL_INBOX_CAPTURE_START_AT: start }, NOW).reason).toBe('CAPTURE_START_INVALID');
  });
  it('accepts explicit whole-second UTC and 1/90 day boundaries', () => {
    for (const days of ['1', '90']) expect(readCompanyGmailInboxConfig({ ...environment(),
      COMPANY_GMAIL_INBOX_CAPTURE_START_AT: '2026-09-08T04:00:00Z', COMPANY_GMAIL_INBOX_RETENTION_DAYS: days }, NOW).ready).toBe(true);
  });
});

describe('company identity, read-only provider and private output boundaries', () => {
  it('verifies company profile before any list/history/message or cursor baseline', async () => {
    const f = fixture(); f.api.profile.mockResolvedValue(response({ emailAddress: 'private@example.invalid', historyId: '101' }));
    const result = await f.run();
    expect(result).toMatchObject({ ok: false, code: 'COMPANY_ACCOUNT_MISMATCH' });
    expect(f.api.list).not.toHaveBeenCalled(); expect(f.api.history).not.toHaveBeenCalled(); expect(f.messages()).toEqual([]);
    expect(f.state()).toMatchObject({ baselineHistoryId: null, cursorHistoryId: null, status: 'error' });
    expect(JSON.stringify(result)).not.toContain('private@example.invalid');
  });
  it.each(['', 'https://www.googleapis.com/auth/gmail.modify', `${SCOPE} https://www.googleapis.com/auth/gmail.send`])('requires an explicitly granted receive-only scope: %s', async (scope) => {
    const f = fixture(); f.api.token.mockResolvedValue(response({ access_token: PRIVATE, token_type: 'Bearer', scope }));
    expect(await f.run()).toMatchObject({ code: 'READONLY_SCOPE_REQUIRED' }); expect(f.api.profile).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403])('fails safely on revoked/invalid authorization HTTP %i', async (status) => {
    const f = fixture(); f.api.token.mockResolvedValue(response({ error: PRIVATE }, status));
    expect(await f.run()).toMatchObject({ code: 'GMAIL_AUTH_REQUIRED' }); expect(f.api.profile).not.toHaveBeenCalled();
    expect(JSON.stringify(f.state())).not.toContain(PRIVATE);
  });
  it('never logs private provider exceptions or returns message content in aggregate results', async () => {
    const f = fixture(); const log = vi.spyOn(console, 'log'); const error = vi.spyOn(console, 'error');
    f.api.list.mockRejectedValue(new Error(PRIVATE));
    const result = await f.run();
    expect(result).toMatchObject({ ok: false, code: 'GMAIL_UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(JSON.stringify(f.state())).not.toContain(PRIVATE);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('stores only metadata/preview and never original HTML, bodies, attachments or labels', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    f.api.message.mockResolvedValue(response(message('a', { raw: PRIVATE + '_raw', payload: { body: { data: PRIVATE + '_html' },
      parts: [{ body: { attachmentId: PRIVATE + '_attachment' } }], headers: [{ name: 'From', value: 'sender@example.invalid' }, { name: 'Subject', value: 'Synthetic' }] } })));
    expect(await f.run()).toMatchObject({ ok: true, status: 'connected', created: 1 });
    expect(f.messages()[0]).toMatchObject({ channel: 'email', accountId: COMPANY_GMAIL_ACCOUNT, providerMessageId: 'a', kind: 'email', truncated: true,
      sourceAtMs: NOW - 10_000, receivedAtMs: NOW, retentionPolicyVersion: 2, caseId: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAtMs: 0, expiresAt: null });
    expect(Object.keys(f.messages()[0]).sort()).toEqual(['accountId', 'caseId', 'channel', 'expiresAt', 'expiresAtMs', 'kind', 'providerMessageId',
      'providerThreadId', 'receivedAtMs', 'retentionPolicyVersion', 'sender', 'sourceAtMs', 'subject', 'text', 'truncated'].sort());
    expect(JSON.stringify(f.messages())).not.toContain('_html'); expect(JSON.stringify(f.messages())).not.toContain('_attachment');
  });
  it('bounds even an uncooperative fetch and preserves an unknown/error state', async () => {
    vi.useFakeTimers(); const f = fixture(); f.api.token.mockImplementation(() => new Promise(() => {}));
    const result = f.run(); await vi.advanceTimersByTimeAsync(8001);
    expect(await result).toMatchObject({ ok: false, code: 'GMAIL_TIMEOUT', status: 'error' });
    expect(f.state()).toMatchObject({ lastSuccessAtMs: null, leaseUntilMs: 0 });
  });
  it('also applies the timeout while reading the provider response body', async () => {
    vi.useFakeTimers(); const f = fixture(); const slow = response({});
    vi.spyOn(slow, 'text').mockImplementation(() => new Promise(() => {}));
    f.api.token.mockResolvedValue(slow);
    const result = f.run(); await vi.advanceTimersByTimeAsync(8001);
    expect(await result).toMatchObject({ code: 'GMAIL_TIMEOUT', ok: false }); expect(f.api.profile).not.toHaveBeenCalled();
  });
});

describe('cutover, baseline race, paging and atomic deduplication', () => {
  it('catches an arrival between initial profile/list and baseline completion', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'before' }] }));
    f.api.history.mockImplementation(async (url) => {
      expect(url.searchParams.get('startHistoryId')).toBe('100');
      expect(f.state()).toMatchObject({ cursorHistoryId: null, phase: 'history' });
      return response({ history: [{ id: '120', messagesAdded: [{ message: { id: 'during' } }, { message: { id: 'before' } }] }], historyId: '150' });
    });
    const result = await f.run();
    expect(result).toMatchObject({ code: 'SYNC_COMPLETE', created: 2, duplicates: 1 });
    expect(f.messages().map((row) => row.providerMessageId).sort()).toEqual(['before', 'during']);
    expect(f.state()).toMatchObject({ baselineHistoryId: '100', cursorHistoryId: '150', lastSuccessAtMs: NOW });
    const query = f.api.list.mock.calls[0][0].searchParams;
    expect(query.get('labelIds')).toBe('INBOX'); expect(query.get('q')).toBe(`after:${Math.floor(START / 1000) - 1}`);
  });
  it('does not promote the cursor until every history page is durably completed', async () => {
    const f = fixture(); f.api.history.mockImplementation(async (url) => url.searchParams.get('pageToken') === 'second'
      ? response({ history: [{ id: '150', messagesAdded: [{ message: { id: 'second' } }] }], historyId: '200' })
      : response({ history: [{ id: '120', messagesAdded: [{ message: { id: 'first' } }] }], nextPageToken: 'second', historyId: '199' }));
    f.api.message.mockImplementation(async (id) => { expect(f.state().cursorHistoryId).toBeNull(); return response(message(id)); });
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 2 });
    expect(f.state()).toMatchObject({ cursorHistoryId: '200', pageToken: null, pending: null });
  });
  it('resumes bounded bootstrap pages without selecting a new baseline', async () => {
    const f = fixture(); f.api.list.mockImplementation(async (url) => {
      const token = url.searchParams.get('pageToken') || '0';
      const n = Number(token);
      return response({ messages: [{ id: `m${n}` }], ...(n < 3 ? { nextPageToken: String(n + 1) } : {}) });
    });
    expect(await f.run()).toMatchObject({ code: 'SYNC_IN_PROGRESS', pages: 3, created: 3 });
    expect(f.state()).toMatchObject({ baselineHistoryId: '100', cursorHistoryId: null, phase: 'bootstrap', pageToken: '3' });
    f.api.profile.mockResolvedValue(response({ emailAddress: COMPANY_GMAIL_ACCOUNT, historyId: '180' }));
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    expect(f.api.history.mock.calls[0][0].searchParams.get('startHistoryId')).toBe('100'); expect(f.messages()).toHaveLength(4);
  });
  it('resumes a large history page at the persisted message position', async () => {
    const f = fixture(); const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    f.api.history.mockResolvedValue(response({ history: [{ id: '120', messagesAdded: ids.map((id) => ({ message: { id } })) }], historyId: '200' }));
    expect(await f.run()).toMatchObject({ code: 'SYNC_IN_PROGRESS', scanned: 20, created: 20 });
    expect(f.state()).toMatchObject({ cursorHistoryId: null, pending: { index: 20, ids } });
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', scanned: 5, created: 5 });
    expect(f.api.history).toHaveBeenCalledTimes(1); expect(f.messages()).toHaveLength(25);
  });
  it('pauses at the run budget without skipping the rest of its pending page', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }, { id: 'b' }] }));
    f.api.message.mockImplementationOnce(async (id) => { f.setNow(NOW + 40_001); return response(message(id)); });
    expect(await f.run()).toMatchObject({ code: 'SYNC_IN_PROGRESS', created: 1 });
    expect(f.state()).toMatchObject({ pending: { ids: ['a', 'b'], index: 1 }, cursorHistoryId: null, lastSuccessAtMs: null });
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    expect(f.api.list).toHaveBeenCalledTimes(1); expect(f.messages()).toHaveLength(2);
  });
  it('treats an empty real page as success, not a failed provider response', async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 0, scanned: 0, status: 'connected' });
    expect(f.state().lastSuccessAtMs).toBe(NOW);
  });
  it('does not bootstrap silently when the saved history cursor expires', async () => {
    const f = fixture(); await f.run(); f.api.history.mockResolvedValue(response({ error: PRIVATE }, 404));
    expect(await f.run()).toMatchObject({ code: 'RESYNC_REQUIRED', status: 'resync_required', ok: false });
    const calls = f.fetchImpl.mock.calls.length;
    expect(await f.run()).toMatchObject({ code: 'RESYNC_REQUIRED' }); expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.api.list).toHaveBeenCalledTimes(1); expect(f.state()).toMatchObject({ cursorHistoryId: '200', lastSuccessAtMs: NOW });
  });
  it('keeps a page on provider failure then resumes without duplicate storage', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }, { id: 'b' }] }));
    f.api.message.mockImplementation(async (id) => id === 'b' ? response({ error: PRIVATE }, 503) : response(message(id)));
    expect(await f.run()).toMatchObject({ ok: false, created: 1 });
    expect(f.state()).toMatchObject({ pending: { index: 1, ids: ['a', 'b'] }, cursorHistoryId: null });
    f.api.message.mockImplementation(async (id) => response(message(id)));
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    expect(f.api.list).toHaveBeenCalledTimes(1); expect(f.messages()).toHaveLength(2);
  });
  it('retains the old cursor after failure on the final history page', async () => {
    const f = fixture(); await f.run();
    f.api.history.mockImplementation(async (url) => url.searchParams.has('pageToken')
      ? response({ error: PRIVATE }, 503)
      : response({ history: [{ id: '210', messagesAdded: [{ message: { id: 'a' } }] }], nextPageToken: 'last', historyId: '299' }));
    expect(await f.run()).toMatchObject({ ok: false, created: 1 });
    expect(f.state()).toMatchObject({ cursorHistoryId: '200', pageToken: 'last' });
    f.api.history.mockResolvedValue(response({ history: [{ id: '220', messagesAdded: [{ message: { id: 'b' } }] }], historyId: '300' }));
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    expect(f.state().cursorHistoryId).toBe('300'); expect(f.messages()).toHaveLength(2);
  });
  it.each(['rejected', 'uncertain'])('absorbs %s message transaction retry without loss or duplication', async (mode) => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    if (mode === 'rejected') f.setRejectMessage(true); else f.setUncertainMessage();
    expect(await f.run()).toMatchObject({ ok: false, code: 'INBOX_SYNC_FAILED' });
    expect(f.state()).toMatchObject({ cursorHistoryId: null });
    f.setRejectMessage(false);
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE' }); expect(f.messages()).toHaveLength(1);
    expect(f.writes.filter((entry) => entry.ref.path.startsWith('external_inbox_messages/'))).toHaveLength(1);
  });
  it('ignores duplicate IDs within and between list/history pages', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }, { id: 'a' }] }));
    f.api.history.mockResolvedValue(response({ history: [{ id: '101', messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'a' } }],
      labelsAdded: [{ message: { id: 'a' }, labelIds: ['INBOX'] }] }], historyId: '200' }));
    expect(await f.run()).toMatchObject({ created: 1, duplicates: 1, scanned: 2 }); expect(f.messages()).toHaveLength(1);
  });
  it('does not revive messages outside INBOX, before cutover, already expired, or deleted before metadata', async () => {
    const f = fixture(); f.env.COMPANY_GMAIL_INBOX_CAPTURE_START_AT = new Date(NOW - 40 * 86_400_000).toISOString();
    f.api.list.mockResolvedValue(response({ messages: ['archive', 'old', 'expired', 'removed', 'edge'].map((id) => ({ id })) }));
    f.api.message.mockImplementation(async (id) => id === 'removed' ? response({}, 404) : response(message(id,
      id === 'archive' ? { labelIds: ['SENT'] } : id === 'old' ? { internalDate: String(NOW - 41 * 86_400_000) }
        : id === 'expired' ? { internalDate: String(NOW - 30 * 86_400_000) } : { internalDate: String(NOW) })));
    expect(await f.run()).toMatchObject({ skipped: 4, created: 1 }); expect(f.messages()[0].providerMessageId).toBe('edge');
  });
  it('does not import a 31-day-old new v2 receipt even when legacy configuration permits 90 days', async () => {
    const f = fixture();
    f.env.COMPANY_GMAIL_INBOX_CAPTURE_START_AT = new Date(NOW - 40 * 86_400_000).toISOString();
    f.env.COMPANY_GMAIL_INBOX_RETENTION_DAYS = '90';
    f.api.list.mockResolvedValue(response({ messages: [{ id: 'late' }] }));
    f.api.message.mockResolvedValue(response(message('late', { internalDate: String(NOW - 31 * 86_400_000) })));
    expect(await f.run()).toMatchObject({ skipped: 1, created: 0 });
    expect(f.messages()).toEqual([]);
  });
  it('rejects a same-thread receipt when the stored case is ahead of the actual commit clock', async () => {
    const f = fixture();
    f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    f.setNow(NOW - 1);
    f.api.history.mockResolvedValue(response({ history: [{ id: '201', messagesAdded: [{ message: { id: 'b' } }] }], historyId: '300' }));
    f.api.message.mockResolvedValue(response(message('b', { threadId: 'thread_a' })));
    expect(await f.run()).toMatchObject({ ok: false, code: 'INBOX_SYNC_FAILED' });
    expect(f.messages()).toHaveLength(1);
  });
  it('applies cutover and INBOX filtering to history label-added and resumed IDs too', async () => {
    const f = fixture(); f.api.history.mockResolvedValue(response({ history: [{ id: '101', labelsAdded: [
      { message: { id: 'old' }, labelIds: ['INBOX'] }, { message: { id: 'archived' }, labelIds: ['INBOX'] },
      { message: { id: 'irrelevant' }, labelIds: ['STARRED'] }, { message: { id: 'new' }, labelIds: ['INBOX'] },
    ] }], historyId: '200' }));
    f.api.message.mockImplementation(async (id) => response(message(id, id === 'old' ? { internalDate: String(START - 1) }
      : id === 'archived' ? { labelIds: [] } : {})));
    expect(await f.run()).toMatchObject({ skipped: 2, created: 1 }); expect(f.api.message).not.toHaveBeenCalledWith('irrelevant');
  });
  it('does not fetch SENT-only or spam metadata from a supplied history label list', async () => {
    const f = fixture(); f.api.history.mockResolvedValue(response({ history: [{ id: '101', messagesAdded: [
      { message: { id: 'sent', labelIds: ['SENT'] } }, { message: { id: 'spam', labelIds: ['SPAM'] } },
      { message: { id: 'inbox', labelIds: ['INBOX'] } }, { message: { id: 'normal_minimal' } },
    ] }], historyId: '200' }));
    expect(await f.run()).toMatchObject({ created: 2 });
    expect(f.api.message).not.toHaveBeenCalledWith('sent'); expect(f.api.message).not.toHaveBeenCalledWith('spam');
    expect(f.api.message).toHaveBeenCalledWith('normal_minimal');
  });
  it.each([{ internalDate: String(NOW + 1) }, { internalDate: 'nonsense' }, { threadId: '../invalid' }, { id: 'wrong' }])('halts on invalid message identity/time %j', async (bad) => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    f.api.message.mockResolvedValue(response(message('a', bad)));
    expect(await f.run()).toMatchObject({ code: 'GMAIL_MESSAGE_INVALID', ok: false });
    expect(f.messages()).toEqual([]); expect(f.state().cursorHistoryId).toBeNull();
  });
});

describe('lease fencing and malformed state/page safety', () => {
  it('allows one active poller and does not refresh credentials for the busy second run', async () => {
    const f = fixture(); let release: (value: Response) => void = () => {};
    f.api.profile.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = f.run(); await vi.waitFor(() => expect(f.api.profile).toHaveBeenCalledTimes(1));
    expect(await f.run()).toMatchObject({ code: 'BUSY' }); expect(f.api.token).toHaveBeenCalledTimes(1);
    release(response({ emailAddress: COMPANY_GMAIL_ACCOUNT, historyId: '100' }));
    expect(await first).toMatchObject({ code: 'SYNC_COMPLETE' }); expect(f.state().fence).toBe(1);
  });
  it('rejects late metadata and cursor writes after a newer poller has taken the lease', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    let release: (value: Response) => void = () => {};
    f.api.message.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = f.run(); await vi.waitFor(() => expect(f.api.message).toHaveBeenCalledTimes(1));
    f.setNow(NOW + 70_000);
    expect(await f.run()).toMatchObject({ code: 'SYNC_COMPLETE', created: 1 });
    release(response(message('a')));
    expect(await first).toMatchObject({ ok: false, code: 'LEASE_LOST' });
    expect(f.messages()).toHaveLength(1); expect(f.state()).toMatchObject({ status: 'connected', fence: 2, cursorHistoryId: '200' });
  });
  it('cannot save after its own lease expires even without another poller', async () => {
    const f = fixture(); f.api.list.mockResolvedValue(response({ messages: [{ id: 'a' }] }));
    f.api.message.mockImplementation(async (id) => { f.setNow(NOW + 65_001); return response(message(id)); });
    expect(await f.run()).toMatchObject({ code: 'LEASE_LOST', ok: false });
    expect(f.messages()).toEqual([]); expect(f.state()).toMatchObject({ cursorHistoryId: null, pending: { index: 0 } });
  });
  it('does not reuse a cursor under a changed capture or retention policy', async () => {
    const f = fixture(); await f.run(); f.env.COMPANY_GMAIL_INBOX_RETENTION_DAYS = '7';
    const calls = f.fetchImpl.mock.calls.length;
    expect(await f.run()).toMatchObject({ code: 'CONFIGURATION_CHANGED', ok: false }); expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.state()).toMatchObject({ cursorHistoryId: '200', retentionDays: 30 });
  });
  it('detects a persisted policy mismatch even if the stored fingerprint was not changed', async () => {
    const f = fixture(); await f.run(); f.rows.set(STATE, { ...f.state(), accountId: 'wrong@example.invalid' });
    const calls = f.fetchImpl.mock.calls.length;
    expect(await f.run()).toMatchObject({ code: 'CONFIGURATION_CHANGED', ok: false }); expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
  });
  it('refuses malformed persisted pending state without provider I/O or cursor reset', async () => {
    const f = fixture(); await f.run(); f.rows.set(STATE, { ...f.state(), pending: { ids: ['../bad'], index: 0 } });
    const calls = f.fetchImpl.mock.calls.length;
    expect(await f.run()).toMatchObject({ code: 'STATE_INVALID' }); expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.state().cursorHistoryId).toBe('200');
  });
  it.each([{ historyId: 'bad' }, { historyId: '50' }, { history: [{ id: '101', labelsAdded: [{ message: { id: 'a' }, labelIds: 'INBOX' }] }], historyId: '200' }])('does not advance on malformed history %j', async (bad) => {
    const f = fixture(); f.api.history.mockResolvedValue(response(bad));
    expect(await f.run()).toMatchObject({ code: 'GMAIL_RESPONSE_INVALID' }); expect(f.state().cursorHistoryId).toBeNull();
  });
  it('does not silently restart an invalid bootstrap page token', async () => {
    const f = fixture(); f.api.list.mockImplementation(async (url) => url.searchParams.has('pageToken')
      ? response({}, 400) : response({ messages: [], nextPageToken: 'expired_page' }));
    expect(await f.run()).toMatchObject({ code: 'PAGE_TOKEN_INVALID', status: 'resync_required' });
    expect(f.state()).toMatchObject({ pageToken: 'expired_page', cursorHistoryId: null });
  });
  it('stops an over-sized page instead of dropping message IDs', async () => {
    const f = fixture(); f.api.history.mockResolvedValue(response({ historyId: '200', history: [{ id: '101',
      messagesAdded: Array.from({ length: 501 }, (_, index) => ({ message: { id: `a${index}` } })) }] }));
    expect(await f.run()).toMatchObject({ code: 'GMAIL_PAGE_TOO_LARGE' }); expect(f.messages()).toEqual([]);
  });
});

describe('cron invocation boundaries', () => {
  it('does not call the worker when the cron authorization fails', async () => {
    authorize.mockResolvedValue({ ok: false }); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    await handler({ method: 'GET' }, res);
    expect(res.status).toHaveBeenCalledWith(401); expect(res.json).toHaveBeenCalledWith({ ok: false, code: 'AUTH_REQUIRED' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('registers a protected dispatcher job without changing existing auto-response or push workers', () => {
    const dispatcher = readFileSync('api/cron-runner.js', 'utf8');
    expect(dispatcher).toContain("'company-gmail-inbox-sweep':   companyGmailInboxSweep");
    expect(dispatcher.indexOf('await verifyCronRequest(req)')).toBeLessThan(dispatcher.indexOf('return JOBS[job](req, res)'));
    const schedules = JSON.parse(readFileSync('vercel.json', 'utf8')).crons;
    expect(schedules.filter((entry: { path: string }) => entry.path.includes('company-gmail-inbox-sweep')))
      .toEqual([{ path: '/api/cron-runner?job=company-gmail-inbox-sweep', schedule: '*/5 * * * *' }]);
    const source = readFileSync('api/_shared/company-gmail-inbox.js', 'utf8');
    expect(source).not.toMatch(/from ['"].*(?:gmail_service|gmail_accounts|notify|send-email|owner-notification|ai_adapter)/);
    expect(source).not.toMatch(/readFile|writeFile|process\.env\.(?:SMTP|GMAIL_REFRESH|GOOGLE_REFRESH)|messages\.send|batchModify|attachments\//);
  });
});
