import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  initDb: vi.fn(),
  issue: vi.fn(),
  captureError: vi.fn(),
  readUser: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  orderBy: vi.fn(),
  startAfter: vi.fn(),
  limit: vi.fn(),
  readCandidates: vi.fn(),
  getAuth: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: state.verifyAdmin }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: state.initDb }));
// Dispatch-only tests: no real issuance, transaction, or persistence implementation is loaded.
vi.mock('../../api/onboarding-coupons.js', () => ({ issueOnboardingCouponsForUid: state.issue }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: state.captureError }));
vi.mock('firebase-admin/auth', () => ({ getAuth: state.getAuth }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));

import handler from '../../api/admin-issue-onboarding-coupons.js';

const AUDIT = { audit: { callerUid: 'synthetic-admin', callerEmail: 'admin@example.invalid', action: 'onboarding_coupon_issue' } };

async function call(body: unknown, method = 'POST') {
  const response = { status: 0, body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  await handler({ method, body, headers: { origin: 'http://localhost:5173' } }, {
    writeHead: (status: number, headers: Record<string, string>) => { response.status = status; response.headers = headers; },
    end: (value?: string) => { response.body = value ? JSON.parse(value) : {}; },
  });
  return response;
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.resetAllMocks();
  state.verifyAdmin.mockResolvedValue({ ok: true, email: 'admin@example.invalid', uid: 'synthetic-admin' });
  state.readUser.mockResolvedValue({ exists: true });
  state.doc.mockReturnValue({ get: state.readUser });
  state.readCandidates.mockResolvedValue({ size: 1, docs: [{ id: 'synthetic-candidate', data: () => ({}) }] });
  state.limit.mockReturnValue({ get: state.readCandidates });
  state.startAfter.mockReturnValue({ limit: state.limit });
  state.orderBy.mockReturnValue({ limit: state.limit, startAfter: state.startAfter });
  state.collection.mockReturnValue({ doc: state.doc, orderBy: state.orderBy });
  state.initDb.mockReturnValue({ collection: state.collection });
  state.issue.mockResolvedValue({ issued: 3, alreadyIssued: false });
  state.getAuth.mockReturnValue({ getUser: state.getUser });
  state.getUser.mockImplementation(async (uid: string) => ({ uid }));
  state.captureError.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('admin onboarding explicit request contract', () => {
  it.each(['{broken-json', '{"uid":"synthetic-user",', 'not-json'])('rejects malformed JSON before DB access: %s', async body => {
    const result = await call(body);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, error: 'Invalid JSON body' });
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.collection).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getAuth).not.toHaveBeenCalled();
    expect(state.captureError).not.toHaveBeenCalled();
  });

  it.each([{ uid: 'synthetic-user', dryRun: false }, '{"uid":"synthetic-user","dryRun":false}'])('preserves an explicit single-target request: %j', async body => {
    const result = await call(body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, results: { issued: 3, alreadyIssued: 0, errors: 0, errorDetails: [] } });
    expect(state.issue).toHaveBeenCalledExactlyOnceWith(state.initDb.mock.results[0].value, 'synthetic-user', AUDIT);
    expect(state.collection).not.toHaveBeenCalled();
    expect(state.getUser).toHaveBeenCalledExactlyOnceWith('synthetic-user');
    expect(state.getUser.mock.invocationCallOrder[0]).toBeLessThan(state.issue.mock.invocationCallOrder[0]);
  });

  it.each([
    undefined, '', ' ', null, 'null', [], '[]', 0, '0', false, 'false', true, 'true', '"text"', {}, '{}',
    { uid: 'synthetic-user' }, { pageSize: 1 }, { dryRun: false },
    { dryRun: 'true' }, { dryRun: 'false', uid: 'synthetic-user' }, { dryRun: null }, { dryRun: 0 },
    { dryRun: true, uid: '' }, { dryRun: false, uid: '  ' }, { dryRun: true, uid: [] },
    { dryRun: false, uid: 123 }, { dryRun: false, uid: 'parent/child' }, { dryRun: false, uid: 'x'.repeat(129) },
    { dryRun: true, typo: 1 }, { dryRun: true, pageSize: '1' }, { dryRun: true, pageSize: 0 },
    { dryRun: true, pageSize: -1 }, { dryRun: true, pageSize: 1.5 }, { dryRun: true, pageSize: 501 },
    { dryRun: true, pageSize: null }, { dryRun: true, uid: 'synthetic-user', pageSize: 1 },
    { dryRun: true, cursor: '' }, { dryRun: true, cursor: ' ' }, { dryRun: true, cursor: 1 },
    { dryRun: true, cursor: 'a/b' }, { dryRun: true, cursor: 'x'.repeat(129) },
    { dryRun: true, uid: 'synthetic-user', cursor: 'c' }, { dryRun: false, uid: 'synthetic-user', cursor: 'c' },
  ])('rejects absent or ambiguous intent/target before DB access: %j', async body => {
    const result = await call(body);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false });
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.collection).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it.each([1, 500, undefined])('preserves bounded read-only scanning with pageSize %s', async pageSize => {
    const body = pageSize === undefined ? { dryRun: true } : { pageSize, dryRun: true };
    const result = await call(body);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, results: { dryRun: true, candidates: 1, issued: 0, alreadyIssued: 0, errors: 0 } });
    expect(state.limit).toHaveBeenCalledExactlyOnceWith(pageSize === undefined ? 100 : pageSize);
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it('normalizes the explicit UID without widening its target', async () => {
    expect((await call({ uid: ' synthetic-user ', dryRun: false })).status).toBe(200);
    expect(state.issue).toHaveBeenCalledExactlyOnceWith(state.initDb.mock.results[0].value, 'synthetic-user', AUDIT);
    expect(state.orderBy).not.toHaveBeenCalled();
    expect(state.getUser).toHaveBeenCalledExactlyOnceWith('synthetic-user');
  });

  it('preserves explicit dryRun without dispatching issuance', async () => {
    const result = await call('{"uid":"synthetic-user","dryRun":true}');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, results: { dryRun: true, candidates: 1, issued: 0 } });
    expect(state.collection).toHaveBeenCalledExactlyOnceWith('users');
    expect(state.doc).toHaveBeenCalledExactlyOnceWith('synthetic-user');
    expect(state.readUser).toHaveBeenCalledOnce();
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserves admin rejection %i before parsing or DB access', async status => {
    state.verifyAdmin.mockResolvedValueOnce({ ok: false, status, error: 'Not authorized' });
    const result = await call('{broken-json');
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ ok: false, error: 'Not authorized' });
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.getAuth).not.toHaveBeenCalled();
  });

  it('preserves the existing non-admin CI empty-object rejection', async () => {
    state.verifyAdmin.mockResolvedValueOnce({ ok: false, status: 403, error: 'Not authorized' });
    expect((await call('{}')).status).toBe(403);
    expect(state.initDb).not.toHaveBeenCalled();
  });

  it('preserves OPTIONS before authentication and validation', async () => {
    expect((await call(undefined, 'OPTIONS')).status).toBe(200);
    expect(state.verifyAdmin).not.toHaveBeenCalled();
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves the method guard', async () => {
    expect((await call('{broken-json', 'GET')).status).toBe(405);
    expect(state.verifyAdmin).not.toHaveBeenCalled();
    expect(state.initDb).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent target like admin-coupon-fix without dispatching issuance', async () => {
    state.getUser.mockRejectedValueOnce(Object.assign(new Error('Missing synthetic user'), { code: 'auth/user-not-found' }));
    const result = await call({ uid: 'missing-user', dryRun: false });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ ok: false, error: 'User not found for uid: missing-user', code: 'USER_NOT_FOUND' });
    expect(state.getUser).toHaveBeenCalledExactlyOnceWith('missing-user');
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.captureError).not.toHaveBeenCalled();
  });

  it.each(['auth/internal-error', 'auth/invalid-uid'])('fails closed like admin-coupon-fix on target lookup error %s', async code => {
    state.getUser.mockRejectedValueOnce(Object.assign(new Error('Synthetic lookup error'), { code }));
    const result = await call({ uid: 'unverified-user', dryRun: false });
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.captureError).toHaveBeenCalledOnce();
  });

  it('waits for target Auth lookup before any issuance dispatch', async () => {
    let resolveUser!: (value: { uid: string }) => void;
    state.getUser.mockImplementationOnce(() => new Promise(resolve => { resolveUser = resolve; }));
    const pending = call({ uid: 'existing-user', dryRun: false });
    await vi.waitFor(() => expect(state.getUser).toHaveBeenCalledOnce());
    expect(state.issue).not.toHaveBeenCalled();
    resolveUser({ uid: 'existing-user' });
    expect((await pending).status).toBe(200);
    expect(state.issue).toHaveBeenCalledOnce();
  });

  it('fails closed when Auth app selection is unavailable', async () => {
    state.getAuth.mockImplementationOnce(() => { throw new Error('Synthetic app selection failure'); });
    const result = await call({ uid: 'existing-user', dryRun: false });
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('keeps DB-unavailable handling before Auth lookup', async () => {
    state.initDb.mockReturnValueOnce(null);
    expect((await call({ uid: 'existing-user', dryRun: false })).status).toBe(500);
    expect(state.getAuth).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });

  it('preserves the existing dryRun read-error response without Auth lookup', async () => {
    state.readUser.mockRejectedValueOnce(new Error('Synthetic read failure'));
    const result = await call({ uid: 'synthetic-user', dryRun: true });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ ok: false, error: 'Synthetic read failure' });
    expect(state.getAuth).not.toHaveBeenCalled();
    expect(state.issue).not.toHaveBeenCalled();
  });
});
