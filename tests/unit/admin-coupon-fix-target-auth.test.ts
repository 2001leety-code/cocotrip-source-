import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  initDb: vi.fn(),
  issue: vi.fn(),
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  captureError: vi.fn(),
  db: { fixture: 'no-persistence' },
}));

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: state.verifyAdmin }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: state.initDb }));
// The real issuance function is deliberately never executed. This checks dispatch, not storage.
vi.mock('../../api/onboarding-coupons.js', () => ({ issueOnboardingCouponsForUid: state.issue }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: state.captureError }));
vi.mock('firebase-admin/app', () => ({
  getApps: () => [{ name: '[DEFAULT]' }],
  initializeApp: () => { throw new Error('Credential initialization forbidden in this test'); },
  cert: () => { throw new Error('Credential parsing forbidden in this test'); },
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: state.getUser, getUserByEmail: state.getUserByEmail }) }));

import handler from '../../api/admin-coupon-fix.js';

const AUDIT = { audit: { callerUid: 'synthetic-admin', callerEmail: 'admin@example.invalid', action: 'onboarding_coupon_fix' } };

async function call(body: unknown, method = 'POST') {
  const response = { status: 0, body: {} as Record<string, unknown> };
  await handler({ method, body, headers: { origin: 'http://localhost:5173' } }, {
    writeHead: (status: number) => { response.status = status; },
    end: (value?: string) => { response.body = value ? JSON.parse(value) : {}; },
  });
  return response;
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.resetAllMocks();
  state.verifyAdmin.mockResolvedValue({ ok: true, email: 'admin@example.invalid', uid: 'synthetic-admin' });
  state.initDb.mockReturnValue(state.db);
  state.issue.mockResolvedValue({ issued: 3, alreadyIssued: false });
  state.getUser.mockImplementation(async (uid: string) => ({ uid }));
  state.getUserByEmail.mockResolvedValue({ uid: 'email-user' });
  state.captureError.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('admin-coupon-fix target Auth existence', () => {
  it('rejects a nonexistent direct UID before invoking issuance', async () => {
    state.getUser.mockRejectedValueOnce(Object.assign(new Error('Missing synthetic user'), { code: 'auth/user-not-found' }));
    const result = await call({ uid: 'missing-user' });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ ok: false, code: 'USER_NOT_FOUND' });
    expect(state.getUser).toHaveBeenCalledWith('missing-user');
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getUserByEmail).not.toHaveBeenCalled();
  });

  it('verifies the trimmed direct UID before preserving the normal issuance call', async () => {
    const result = await call({ uid: '  existing-user  ' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, data: { uid: 'existing-user', issued: 3 } });
    expect(state.getUser).toHaveBeenCalledWith('existing-user');
    expect(state.issue).toHaveBeenCalledExactlyOnceWith(state.db, 'existing-user', AUDIT);
    expect(state.getUser.mock.invocationCallOrder[0]).toBeLessThan(state.issue.mock.invocationCallOrder[0]);
    expect(state.getUserByEmail).not.toHaveBeenCalled();
  });

  it('waits for UID verification to finish before calling issuance', async () => {
    let resolveUser!: (value: { uid: string }) => void;
    state.getUser.mockImplementationOnce(() => new Promise(resolve => { resolveUser = resolve; }));
    const pending = call({ uid: 'existing-user' });
    await vi.waitFor(() => expect(state.getUser).toHaveBeenCalledOnce());
    expect(state.issue).not.toHaveBeenCalled();
    resolveUser({ uid: 'existing-user' });
    expect((await pending).status).toBe(200);
    expect(state.issue).toHaveBeenCalledOnce();
  });

  it('preserves normalized email lookup and the returned UID', async () => {
    const result = await call({ email: '  PERSON@EXAMPLE.INVALID  ' });
    expect(result.status).toBe(200);
    expect(state.getUserByEmail).toHaveBeenCalledExactlyOnceWith('person@example.invalid');
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.issue).toHaveBeenCalledExactlyOnceWith(state.db, 'email-user', AUDIT);
    expect(result.body).toMatchObject({ data: { uid: 'email-user', email: 'person@example.invalid', issued: 3 } });
  });

  it('preserves not-found handling for email without issuing', async () => {
    state.getUserByEmail.mockRejectedValueOnce(Object.assign(new Error('Missing synthetic user'), { code: 'auth/user-not-found' }));
    const result = await call({ email: 'missing@example.invalid' });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ ok: false, code: 'USER_NOT_FOUND' });
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves UID precedence when both UID and email are supplied', async () => {
    expect((await call({ uid: 'existing-user', email: 'ignored@example.invalid' })).status).toBe(200);
    expect(state.getUser).toHaveBeenCalledExactlyOnceWith('existing-user');
    expect(state.getUserByEmail).not.toHaveBeenCalled();
    expect(state.issue).toHaveBeenCalledExactlyOnceWith(state.db, 'existing-user', AUDIT);
  });

  it.each(['auth/internal-error', 'auth/invalid-uid'])('fails closed on %s without issuing', async code => {
    state.getUser.mockRejectedValueOnce(Object.assign(new Error('Synthetic lookup failure'), { code }));
    const result = await call({ uid: 'unverified-user' });
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    expect(state.issue).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves admin rejection %i before any target lookup', async status => {
    state.verifyAdmin.mockResolvedValueOnce({ ok: false, status, error: 'Not authorized' });
    const result = await call({ uid: 'existing-user' });
    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ ok: false, code: 'AUTH_FAILED' });
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.getUserByEmail).not.toHaveBeenCalled();
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves malformed body rejection without target lookup', async () => {
    expect((await call('{broken-json')).status).toBe(400);
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.getUserByEmail).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves the endpoint method guard', async () => {
    expect((await call({ uid: 'existing-user' }, 'GET')).status).toBe(405);
    expect(state.verifyAdmin).not.toHaveBeenCalled();
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves no-database rejection without issuing', async () => {
    state.initDb.mockReturnValueOnce(null);
    const result = await call({ uid: 'existing-user' });
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, code: 'DB_UNAVAILABLE' });
    expect(state.issue).not.toHaveBeenCalled();
  });
});
