// Import-failure response contract only. No SDK, storage, transaction, or external calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = { auth: vi.fn(), db: vi.fn(), issue: vi.fn(), loaded: vi.fn() };
const specs = ['./_shared/admin-auth.js', './_shared/firebase-admin.js', './onboarding-coupons.js'];
const routes = ['../../api/admin-coupon-fix.js', '../../api/admin-issue-onboarding-coupons.js'];
const sentinel = 'INTERNAL-IMPORT-DETAIL-MUST-NOT-LEAK';
function mockRuntime(fail: string) {
  vi.doMock('../../api/_shared/admin-auth.js', () => {
    calls.loaded('auth'); if (fail === specs[0]) throw new Error(sentinel);
    return { verifyAdminToken: calls.auth };
  });
  vi.doMock('../../api/_shared/firebase-admin.js', () => {
    calls.loaded('db'); if (fail === specs[1]) throw new Error(sentinel);
    return { initAdminDb: calls.db };
  });
  vi.doMock('../../api/onboarding-coupons.js', () => {
    calls.loaded('issuer'); if (fail === specs[2]) throw new Error(sentinel);
    return { issueOnboardingCouponsForUid: calls.issue };
  });
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock('../../api/_shared/admin-auth.js');
  vi.doUnmock('../../api/_shared/firebase-admin.js');
  vi.doUnmock('../../api/onboarding-coupons.js');
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function call(file: string) {
  const { default: handler } = await import(file);
  const response = { status: 0, raw: '', headers: {} as Record<string, string> };
  await handler({ method: 'POST', headers: { origin: 'http://localhost:5173' }, body: { uid: 'fixture', dryRun: false } }, {
    writeHead: (status: number, headers: Record<string, string>) => { response.status = status; response.headers = headers; },
    end: (raw: string) => { response.raw = raw; },
  });
  return response;
}
describe.each(routes)('%s runtime import failure', file => {
  it.each(specs)('returns stable JSON when %s fails', async fail => {
    mockRuntime(fail);
    const res = await call(file);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.raw)).toEqual({ ok: false, error: 'Coupon recovery runtime unavailable', code: 'RECOVERY_RUNTIME_UNAVAILABLE' });
    expect(res.raw).not.toContain(sentinel);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(calls.auth).not.toHaveBeenCalled();
    expect(calls.db).not.toHaveBeenCalled();
    expect(calls.issue).not.toHaveBeenCalled();
  });
  it('rejects Preview without attempting any runtime imports', async () => {
    mockRuntime(specs[0]);
    vi.stubEnv('VERCEL_ENV', 'preview');
    const res = await call(file);
    expect(res.status).toBe(503);
    expect(calls.loaded).not.toHaveBeenCalled();
  });
});
