import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Authentication boundaries only. No Firestore object, transaction, or coupon
// persistence substitute is created; the handler stops at DB-unavailable.
const state = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  initDb: vi.fn(() => null),
  captureError: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: () => [{ name: '[DEFAULT]' }],
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: state.verifyIdToken }),
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: state.initDb }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: state.captureError }));

const phoneIdentity = { uid: 'phone-user', firebase: { sign_in_provider: 'phone' } };
const request = (authorization: unknown = 'Bearer test-token') => ({
  method: 'POST',
  headers: { authorization },
  body: { uid: 'untrusted-target', email: 'untrusted@example.test', phone_number: '+821012345678' },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.verifyIdToken.mockReset();
  state.initDb.mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('signup-specific verified identity', () => {
  it('accepts an email-less Firebase phone sign-in using only its verified uid', async () => {
    state.verifyIdToken.mockResolvedValue(phoneIdentity);
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toEqual({
      ok: true, uid: 'phone-user', email: null, emailVerified: false,
    });
    expect(state.verifyIdToken).toHaveBeenCalledExactlyOnceWith('test-token', true);
  });

  it.each(['google.com', 'apple.com', 'password', 'oidc.line', 'phone'])('preserves authenticated email sign-in for %s', async provider => {
    state.verifyIdToken.mockResolvedValue({
      uid: 'email-user', email: ' User@Example.Test ', email_verified: true,
      firebase: { sign_in_provider: provider },
    });
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toEqual({
      ok: true, uid: 'email-user', email: 'user@example.test', emailVerified: true,
    });
  });

  it.each([undefined, '', 'anonymous', 'anonymous ', ' anonymous', ' phone ', 1])('rejects absent, malformed, or anonymous sign-in provider %s even with email', async provider => {
    state.verifyIdToken.mockResolvedValue({
      uid: 'guest-user', email: 'guest@example.test',
      firebase: { sign_in_provider: provider },
    });
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('rejects an anonymous identity even when it contains a phone number', async () => {
    state.verifyIdToken.mockResolvedValue({
      uid: 'anonymous-user', phone_number: '+821012345678', firebase: { sign_in_provider: 'anonymous' },
    });
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it.each(['google.com', 'apple.com', 'password', 'custom'])('does not broaden email-less %s identities using body data or a linked phone', async provider => {
    state.verifyIdToken.mockResolvedValue({
      uid: 'no-email-user', phone_number: '+821012345678', firebase: { sign_in_provider: provider },
    });
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it.each([undefined, '', ' ', 123, 'bad/uid', 'x'.repeat(129)])('rejects unusable verified uid %s', async uid => {
    state.verifyIdToken.mockResolvedValue({ ...phoneIdentity, uid });
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it.each(['', 'Basic test-token', 'Bearer ', ['Bearer test-token'], 123, null])('rejects malformed Authorization %s without SDK access', async header => {
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request(header))).resolves.toMatchObject({ ok: false, status: 401 });
    expect(state.verifyIdToken).not.toHaveBeenCalled();
  });

  it('accepts the capitalized Authorization header', async () => {
    state.verifyIdToken.mockResolvedValue(phoneIdentity);
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken({ headers: { Authorization: 'Bearer test-token' } })).resolves.toMatchObject({ ok: true, uid: 'phone-user' });
  });

  it('rejects missing headers before SDK access', async () => {
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken({})).resolves.toMatchObject({ ok: false, status: 401 });
    expect(state.verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'unexpected SDK rejection'])('fails closed without exposing unexpected rejection %s', async error => {
    state.verifyIdToken.mockRejectedValue(error);
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    await expect(verifyOnboardingUserToken(request())).resolves.toEqual({
      ok: false, status: 401, error: 'Token verification failed: AUTH_VERIFICATION_FAILED',
    });
  });

  it.each(['auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/argument-error', 'auth/internal-error'])('fails closed for SDK rejection %s', async code => {
    state.verifyIdToken.mockRejectedValue(Object.assign(new Error('sensitive SDK detail'), { code }));
    const { verifyOnboardingUserToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyOnboardingUserToken(request());
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(JSON.stringify(result)).not.toContain('sensitive SDK detail');
    expect(state.verifyIdToken).toHaveBeenCalledExactlyOnceWith('test-token', true);
  });

  it('leaves the shared payment/user auth email requirement unchanged', async () => {
    state.verifyIdToken.mockResolvedValue(phoneIdentity);
    const { default: defaultAuth, verifyUserToken } = await import('../../api/_shared/user-auth.js');
    expect(defaultAuth).toBe(verifyUserToken);
    await expect(verifyUserToken(request())).resolves.toEqual({ ok: false, status: 403, error: 'Token has no email claim' });
    expect(state.verifyIdToken).toHaveBeenCalledExactlyOnceWith('test-token', true);
  });
});

async function callHandler(method = 'POST') {
  const response = { status: 0, body: '', writeHead: vi.fn(), end: vi.fn() };
  response.writeHead.mockImplementation((status: number) => { response.status = status; });
  response.end.mockImplementation((body = '') => { response.body = body; });
  const { default: handler } = await import('../../api/onboarding-coupons.js');
  await handler({ ...request(), method }, response);
  return response;
}

describe('signup handler authentication wiring without persistence', () => {
  it('passes verified phone auth, then stops at the mocked unavailable DB before issuance', async () => {
    state.verifyIdToken.mockResolvedValue(phoneIdentity);
    const response = await callHandler();
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'Firestore unavailable' });
    expect(state.initDb).toHaveBeenCalledExactlyOnceWith('onboarding-coupons');
    expect(state.captureError).not.toHaveBeenCalled();
  });

  it('blocks anonymous identity before asking for a DB', async () => {
    state.verifyIdToken.mockResolvedValue({ uid: 'guest', firebase: { sign_in_provider: 'anonymous' } });
    const response = await callHandler();
    expect(response.status).toBe(403);
    expect(state.initDb).not.toHaveBeenCalled();
  });

  it('blocks rejected tokens before asking for a DB', async () => {
    state.verifyIdToken.mockRejectedValue(Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }));
    const response = await callHandler();
    expect(response.status).toBe(401);
    expect(state.initDb).not.toHaveBeenCalled();
  });

  it.each([['OPTIONS', 200], ['GET', 405]] as const)('preserves %s without auth or DB work', async (method, status) => {
    const response = await callHandler(method);
    expect(response.status).toBe(status);
    expect(state.verifyIdToken).not.toHaveBeenCalled();
    expect(state.initDb).not.toHaveBeenCalled();
  });
});
