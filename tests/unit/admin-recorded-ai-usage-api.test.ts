import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dependencies = vi.hoisted(() => ({ authorize: vi.fn(), init: vi.fn(), capture: vi.fn() }));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: dependencies.authorize }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: dependencies.init }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: dependencies.capture }));
import handler from '../../api/admin-ai-ops-center.js';

const NOW = Date.parse('2026-09-08T11:00:00+09:00');
function fakeDb(failUsage = false) {
  const accessed: string[] = [];
  const db = { collection: (name: string) => {
    accessed.push(name);
    const query = {
      where: () => query, limit: () => query, orderBy: () => query, select: () => query,
      doc: () => ({ get: async () => ({ exists: false }) }),
      get: async () => {
        if (name === 'api_usage' && failUsage) throw new Error('SYNTHETIC_USAGE_FAILURE');
        return { docs: name === 'api_usage' ? [{ data: () => ({ service: 'gemini', cost_usd: 0.125, ms: NOW }) }] : [] };
      },
    };
    return query;
  } };
  return { db, accessed };
}
async function request(method = 'GET') {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  await handler({ method, url: '/api/admin-ai-ops-center', headers: { host: 'localhost' } }, response);
  const body = response.end.mock.calls[0]?.[0];
  return { status: response.writeHead.mock.calls[0][0], headers: response.writeHead.mock.calls[0][1], body: body ? JSON.parse(body) : null };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); }));
  dependencies.authorize.mockResolvedValue({ ok: true });
  vi.stubEnv('OWNER_EVENT_PUSH_ENABLED', 'false');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('existing admin endpoint recorded usage wiring', () => {
  it.each([401, 403])('retains existing admin authorization before all DB reads (%s)', async status => {
    dependencies.authorize.mockResolvedValue({ ok: false, status, error: 'denied' });
    const result = await request();
    expect(result.status).toBe(status);
    expect(dependencies.init).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not query usage for OPTIONS or unsupported writes', async () => {
    expect((await request('OPTIONS')).status).toBe(200);
    expect((await request('POST')).status).toBe(405);
    expect(dependencies.init).not.toHaveBeenCalled();
  });
  it('includes the live read result without changing existing operational aggregates', async () => {
    const store = fakeDb();
    dependencies.init.mockReturnValue(store.db);
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.body.data.recordedAiUsage).toMatchObject({ status: 'ok', recordedCostUsd: 0.125, actualBillConnected: false });
    expect(result.body.data.ownerDispatchReadiness).toEqual({ state: 'off', deliveryVerified: false });
    expect(result.body.data.partialErrors).toEqual([]);
    expect(result.body.data.summary.todayReservations).toBe(0);
    expect(result.body.data.sources).toHaveLength(12);
    expect(store.accessed.filter(name => name === 'api_usage')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a failed usage read visible without breaking reservation or inbox counts', async () => {
    dependencies.init.mockReturnValue(fakeDb(true).db);
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.body.data.recordedAiUsage).toMatchObject({ status: 'unknown', recordedCostUsd: null });
    expect(result.body.data.partialErrors).toEqual([]);
    expect(result.body.data.sources.every((source: { ok: boolean }) => source.ok)).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain('SYNTHETIC_USAGE_FAILURE');
    expect(fetch).not.toHaveBeenCalled();
  });
});
