import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), init: vi.fn() }));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: dependencies.authorize }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: dependencies.init }));
import handler from '../../api/admin-whatsapp-privacy.js';
import { applyWhatsAppPrivacyAction, loadWhatsAppPrivacy, readWhatsAppPrivacyScope } from '../../api/_shared/adminWhatsAppPrivacy.js';
import { sessionDocId } from '../../api/_shared/whatsapp-support-sessions.js';

const NOW = Date.parse('2026-09-08T10:00:00Z');
const SENDER = '15550001111';
const ACCOUNT = '222';
const ID = sessionDocId(ACCOUNT, SENDER);
const PATH = `whatsapp_inbox_sessions/${ID}`;
const SECRET = 'SYNTHETIC_PRIVATE_ERROR_BODY';
const ENV = { VERCEL_ENV: 'production', WHATSAPP_INBOX_ENABLED: 'false', WHATSAPP_INBOX_PHONE_NUMBER_ID: ACCOUNT,
  WHATSAPP_INBOX_WABA_ID: '111', WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1' };
type Row = Record<string, unknown>;
function active(extra: Row = {}) { return { policyVersion: 1, accountId: ACCOUNT, sender: SENDER, status: 'active',
  startedAtMs: NOW - 60_000, expiresAtMs: NOW - 60_000 + 7_200_000, updatedAtMs: NOW - 60_000,
  closedAtMs: 0, lastStartMessageId: 'wamid.synthetic-start', ...extra }; }
function db(seed: Row = {}) {
  const fake = createFakeFirestore(seed);
  const original = fake.collection;
  // This existing shared fake has no projection API; retain its transactions/races and add a projection stub.
  function projection(query: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...query, select: () => result };
    for (const method of ['where', 'limit', 'orderBy']) result[method] = (...args: unknown[]) => projection((query[method] as (...values: unknown[]) => Record<string, unknown>)(...args));
    return result;
  }
  fake.collection = (name: string) => projection(original(name));
  return fake;
}
async function request(method = 'GET', body?: unknown, headers: Row = {}, query = '') {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  await handler({ method, url: `/api/admin-whatsapp-privacy${query}`, body,
    headers: { origin: 'https://cocotripkr.com', 'content-type': 'application/json', ...headers } }, response);
  const text = response.end.mock.calls[0]?.[0];
  return { status: response.writeHead.mock.calls[0][0], headers: response.writeHead.mock.calls[0][1], body: text ? JSON.parse(text) : null };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); }));
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  dependencies.authorize.mockResolvedValue({ ok: true }); dependencies.init.mockReturnValue(db());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('privacy controls authorize, validate, then access pinned storage', () => {
  it.each([401, 403])('rejects %i before database access and without error details', async status => {
    dependencies.authorize.mockResolvedValue({ ok: false, status, error: SECRET });
    const result = await request('POST', { action: 'block', sender: SENDER });
    expect(result).toMatchObject({ status, body: { ok: false, error: 'ADMIN_REQUIRED' } });
    expect(dependencies.init).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain(SECRET);
  });
  it('allows exclusions before receiving is switched on', async () => {
    const fake = db(); dependencies.init.mockReturnValue(fake);
    expect(readWhatsAppPrivacyScope(ENV)).toMatchObject({ ready: true, enabled: false });
    expect((await request()).body.data).toMatchObject({ ready: true, enabled: false, sessions: [] });
    expect((await request('POST', { action: 'block', sender: SENDER })).status).toBe(200);
    expect(fake.__dump()[PATH]).toEqual({ policyVersion: 1, accountId: ACCOUNT, sender: SENDER, status: 'blocked',
      startedAtMs: 0, expiresAtMs: 0, updatedAtMs: NOW, closedAtMs: NOW, lastStartMessageId: '' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['preview', 'development', '', ' production '])('does not configure even privacy storage on %s', async value => {
    vi.stubEnv('VERCEL_ENV', value);
    expect((await request()).body.data).toMatchObject({ ready: false, enabled: false, sessions: [] });
    expect((await request('POST', { action: 'block', sender: SENDER })).status).toBe(503);
    expect(dependencies.init).not.toHaveBeenCalled();
  });
  it.each(['WHATSAPP_INBOX_PRIVACY_MODE', 'WHATSAPP_INBOX_PHONE_NUMBER_ID', 'WHATSAPP_INBOX_WABA_ID'])('requires exact scope %s', async key => {
    vi.stubEnv(key, ''); expect((await request()).body.data.ready).toBe(false);
    expect((await request('POST', { action: 'block', sender: SENDER })).status).toBe(503);
    expect(dependencies.init).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { action: 'start', sender: SENDER }, { action: 'delete', sender: SENDER },
    { action: 'block', sender: '../../other' }, { action: 'block', sender: `+${SENDER}` },
    { action: 'block', sender: `${SENDER}\u0000` }, { action: 'block', sender: '1'.repeat(21) },
    { action: 'block', sender: 15550001111 }, { action: 'block', sender: SENDER, accountId: 'another' },
    { action: 'block', sender: SENDER, text: SECRET }, '{malformed',
  ])('rejects broadened/malformed actions without database writes (%j)', async body => {
    expect((await request('POST', body)).status).toBe(400); expect(dependencies.init).not.toHaveBeenCalled();
  });
  it('rejects query scope, unrelated origins and non-JSON/oversized bodies', async () => {
    const body = { action: 'block', sender: SENDER };
    expect((await request('GET', undefined, {}, '?accountId=other')).status).toBe(400);
    expect((await request('POST', body, { origin: 'https://unrelated.example.invalid' })).status).toBe(403);
    expect((await request('POST', body, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await request('POST', body, { 'content-length': '1025' })).status).toBe(400);
    expect((await request('POST', ' '.repeat(1025))).status).toBe(400);
    expect(dependencies.init).not.toHaveBeenCalled();
  });
  it('supports JSON bytes and OPTIONS but never arbitrary methods', async () => {
    expect((await request('OPTIONS')).status).toBe(200); expect(dependencies.authorize).not.toHaveBeenCalled();
    expect((await request('DELETE')).status).toBe(405);
    expect((await request('POST', Buffer.from(JSON.stringify({ action: 'block', sender: SENDER })))).status).toBe(200);
  });
});

describe('minimal privacy state and conservative closure', () => {
  it('returns only the pinned safe session fields, without hidden tombstones or other accounts', async () => {
    const anotherId = sessionDocId('333', SENDER);
    const tombstoneId = sessionDocId(ACCOUNT, '15550002222');
    const fake = db({ [PATH]: active(), [`whatsapp_inbox_sessions/${anotherId}`]: active({ accountId: '333' }),
      [`whatsapp_inbox_sessions/${tombstoneId}`]: { policyVersion: 1, accountId: ACCOUNT, status: 'closed',
        startedAtMs: 0, expiresAtMs: 0, updatedAtMs: NOW, closedAtMs: NOW, lastStartMessageId: '' },
      'external_inbox_messages/private': { text: SECRET } });
    dependencies.init.mockReturnValue(fake);
    const result = await request();
    expect(result.body.data.sessions).toEqual([{ id: ID, sender: SENDER, status: 'active',
      startedAtMs: NOW - 60_000, expiresAtMs: NOW - 60_000 + 7_200_000, updatedAtMs: NOW - 60_000 }]);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    expect(JSON.stringify(result)).not.toContain(SECRET); expect(fetch).not.toHaveBeenCalled();
  });
  it('shows expired sessions as closed without pretending to delete stored inquiry history', async () => {
    const data = active({ startedAtMs: NOW - 7_200_000, expiresAtMs: NOW, updatedAtMs: NOW - 7_200_000 });
    const fake = db({ [PATH]: data }); dependencies.init.mockReturnValue(fake);
    expect((await request()).body.data.sessions[0].status).toBe('closed'); expect(fake.__dump()[PATH]).toEqual(data);
  });
  it('close preserves a permanent exclusion, and unblock never restores active status', async () => {
    const fake = db({ [PATH]: active() }); dependencies.init.mockReturnValue(fake);
    await request('POST', { action: 'block', sender: SENDER });
    await request('POST', { action: 'close', sender: SENDER });
    expect(fake.__dump()[PATH].status).toBe('blocked');
    await request('POST', { action: 'unblock', sender: SENDER });
    expect(fake.__dump()[PATH]).toMatchObject({ status: 'closed', closedAtMs: NOW, startedAtMs: NOW - 60_000 });
    expect(Object.keys(fake.__dump())).toEqual([PATH]);
  });
  it('does not normalize a corrupt session into an openable state; blocking only can tighten it', async () => {
    const fake = db({ [PATH]: active({ privateText: SECRET }) }); dependencies.init.mockReturnValue(fake);
    expect((await request('POST', { action: 'unblock', sender: SENDER })).status).toBe(503);
    expect(fake.__dump()[PATH]).toHaveProperty('privateText', SECRET);
    expect((await request('POST', { action: 'block', sender: SENDER })).status).toBe(200);
    expect(fake.__dump()[PATH]).toMatchObject({ status: 'blocked', startedAtMs: 0 });
    expect(JSON.stringify(await request())).not.toContain(SECRET);
  });
  it('never moves a close barrier backwards even with a stale request clock', async () => {
    const fake = db({ [PATH]: active({ status: 'closed', closedAtMs: NOW + 1000, updatedAtMs: NOW + 1000 }) });
    const before = fake.__dump();
    await expect(applyWhatsAppPrivacyAction({ db: fake, scope: readWhatsAppPrivacyScope(ENV), action: 'unblock', sender: SENDER, now: () => NOW })).rejects.toThrow();
    expect(fake.__dump()).toEqual(before);
  });
  it('rechecks a concurrently committed block instead of closing it into an unblocked state', async () => {
    const fake = db({ [PATH]: active() }); const barrier = makeBarrier(2);
    fake.__beforeCommit = async () => { await barrier.wait(); };
    await Promise.all(['close', 'block'].map(action => applyWhatsAppPrivacyAction({ db: fake, scope: readWhatsAppPrivacyScope(ENV), action, sender: SENDER, now: () => NOW })));
    expect(fake.__dump()[PATH].status).toBe('blocked'); expect(fake.__stats.retries).toBeGreaterThan(0);
  });
  it('rejects storage failure or timeout rather than displaying empty-success', async () => {
    dependencies.init.mockReturnValue(null); expect((await request()).status).toBe(503);
    dependencies.init.mockImplementation(() => { throw new Error(SECRET); });
    const error = await request('POST', { action: 'block', sender: SENDER });
    expect(error.status).toBe(503); expect(JSON.stringify(error)).not.toContain(SECRET);
    vi.useFakeTimers();
    const query = { where: () => query, select: () => query, limit: () => query, get: () => new Promise(() => {}) };
    const result = loadWhatsAppPrivacy({ db: { collection: () => query }, scope: readWhatsAppPrivacyScope(ENV), nowMs: NOW });
    const check = expect(result).rejects.toThrow('PRIVACY_READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(3001); await check;
  });
});
