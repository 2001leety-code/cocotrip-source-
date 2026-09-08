import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAdminWebchatInboxHandler } from '../../api/admin-webchat-inbox.js';

const ID = 'sess_abcdefghijklmnopqrstuvwxyz012345';
const input = { sessionId: ID, requestId: '123e4567-e89b-42d3-a456-426614174000', text: 'original', expectedLastMessageAtMs: 1000 };
function response() { return { writeHead: vi.fn(), end: vi.fn() }; }
function request(method = 'GET', body: unknown = undefined, headers: Record<string, string> = {}, url = '/api/admin-webchat-inbox') {
  return { method, url, body, headers: { origin: 'https://cocotripkr.com', 'content-type': 'application/json', ...headers } };
}
async function invoke(handler: ReturnType<typeof createAdminWebchatInboxHandler>, req = request()) {
  const res = response(); await handler(req, res);
  return { status: res.writeHead.mock.calls[0]?.[0], headers: res.writeHead.mock.calls[0]?.[1], body: JSON.parse(res.end.mock.calls[0]?.[0] || '{}') };
}

describe('admin webchat inbox API security boundary', () => {
  it('does not statically bootstrap Firestore before admin authentication', () => {
    const source = readFileSync(new URL('../../api/admin-webchat-inbox.js', import.meta.url), 'utf8');
    expect(source).not.toContain("from './_shared/firebase-admin.js'");
    expect(source).toContain("await import('./_shared/firebase-admin.js')");
  });

  it('authenticates before obtaining a database handle and hides authentication exceptions', async () => {
    const loadDb = vi.fn(() => { throw new Error('PRIVATE_DATABASE_DETAIL'); });
    const denied = createAdminWebchatInboxHandler({ authenticate: async () => ({ ok: false, status: 401 }), loadDb });
    expect(await invoke(denied)).toMatchObject({ status: 401, body: { code: 'ADMIN_REQUIRED' } });
    expect(loadDb).not.toHaveBeenCalled();

    const throws = createAdminWebchatInboxHandler({ authenticate: async () => { throw new Error('PRIVATE_AUTH_DETAIL'); }, loadDb });
    const result = await invoke(throws);
    expect(result).toMatchObject({ status: 503, body: { code: 'CHAT_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_AUTH_DETAIL'); expect(loadDb).not.toHaveBeenCalled();
  });

  it('hides database setup failures and rejects unknown origins before auth or storage access', async () => {
    const auth = vi.fn(async () => ({ ok: true, uid: 'admin-uid' }));
    const loadDb = vi.fn(() => { throw new Error('PRIVATE_DATABASE_DETAIL'); });
    const handler = createAdminWebchatInboxHandler({ authenticate: auth, loadDb });
    const unavailable = await invoke(handler);
    expect(unavailable).toMatchObject({ status: 503, body: { code: 'CHAT_UNAVAILABLE' } });
    expect(JSON.stringify(unavailable)).not.toContain('PRIVATE_DATABASE_DETAIL');

    const blocked = await invoke(handler, request('POST', input, { origin: 'https://unrelated.invalid' }));
    expect(blocked).toMatchObject({ status: 403, body: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(auth).toHaveBeenCalledTimes(1); expect(loadDb).toHaveBeenCalledTimes(1);
  });

  it('enforces full JSON byte bounds and exact reply fields before database access', async () => {
    const loadDb = vi.fn(() => ({ runTransaction: vi.fn() }));
    const handler = createAdminWebchatInboxHandler({ authenticate: async () => ({ ok: true, uid: 'admin-uid' }), loadDb });
    const hugeText = '😀'.repeat(6_000);
    const cases = [
      request('POST', input, { 'content-length': 'not-a-number' }),
      request('POST', input, { 'content-length': String(20 * 1024 + 1) }),
      request('POST', JSON.stringify({ ...input, text: hugeText })),
      request('POST', { ...input, ignored: true }),
      request('POST', { ...input, text: 'x'.repeat(4001) }),
      request('POST', input, { 'content-type': 'text/plain' }),
    ];
    for (const req of cases) expect(await invoke(handler, req)).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('uses a fixed URL base and rejects duplicate or unrelated query fields before storage access', async () => {
    const loadDb = vi.fn(() => ({ collection: vi.fn() }));
    const handler = createAdminWebchatInboxHandler({ authenticate: async () => ({ ok: true, uid: 'admin-uid' }), loadDb });
    for (const url of ['/api/admin-webchat-inbox?sessionId=a&sessionId=b', '/api/admin-webchat-inbox?other=x',
      'https://unrelated.invalid/api/admin-webchat-inbox?sessionId=x', '//unrelated.invalid/path']) {
      expect(await invoke(handler, request('GET', undefined, {}, url))).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
    }
    expect(loadDb).not.toHaveBeenCalled();
  });

  it('keeps no-store responses and preflight origin enforcement without a database read', async () => {
    const auth = vi.fn(async () => ({ ok: true, uid: 'admin-uid' }));
    const loadDb = vi.fn();
    const handler = createAdminWebchatInboxHandler({ authenticate: auth, loadDb });
    const options = await invoke(handler, request('OPTIONS'));
    expect(options.status).toBe(200); expect(options.headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://cocotripkr.com' });
    expect(auth).not.toHaveBeenCalled(); expect(loadDb).not.toHaveBeenCalled();
  });
});
