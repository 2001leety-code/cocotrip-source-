// Coverage for api/_shared/admin-auth.js — Firebase ID token verification.
// firebase-admin/app + auth dynamically imported inside; mocked at module level.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyIdTokenMock = vi.fn();

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: vi.fn(() => [{ name: '[DEFAULT]' }]), // pretend app already initialized
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

describe('api/_shared/admin-auth — verifyAdminToken', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.resetModules();
  });

  function reqWith(authHeader?: string) {
    return { headers: authHeader ? { authorization: authHeader } : {} };
  }

  it('rejects 401 when Authorization header missing', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith());
    expect(result).toEqual({ ok: false, status: 401, error: expect.stringMatching(/Bearer/) });
  });

  it('rejects 401 when header is not Bearer scheme', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Basic abc123'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects 500 when ADMIN_EMAIL env var missing', async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.VITE_ADMIN_EMAIL;
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer some-token'));
    expect(result).toEqual({ ok: false, status: 500, error: expect.stringMatching(/ADMIN_EMAIL/) });
  });

  it('falls back to VITE_ADMIN_EMAIL when ADMIN_EMAIL absent', async () => {
    delete process.env.ADMIN_EMAIL;
    process.env.VITE_ADMIN_EMAIL = 'fallback@example.com';
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'fallback@example.com',
      email_verified: true,
      uid: 'uid-1',
    });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer t'));
    expect(result).toEqual({ ok: true, email: 'fallback@example.com', uid: 'uid-1' });
  });

  it('rejects 403 when token email is unverified', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'admin@example.com',
      email_verified: false,
      uid: 'uid-1',
    });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer t'));
    expect(result).toEqual({ ok: false, status: 403, error: 'Email not verified' });
  });

  it('rejects 403 when verified email != ADMIN_EMAIL', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'random@example.com',
      email_verified: true,
      uid: 'uid-1',
    });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer t'));
    expect(result).toEqual({ ok: false, status: 403, error: 'Not admin' });
  });

  it('returns ok:true with email + uid on valid admin token', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'admin@example.com',
      email_verified: true,
      uid: 'uid-42',
    });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer valid-token'));
    expect(result).toEqual({ ok: true, email: 'admin@example.com', uid: 'uid-42' });
  });

  it('rejects 401 when verifyIdToken throws', async () => {
    verifyIdTokenMock.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }));
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer expired-token'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/auth\/id-token-expired/);
    }
  });

  it('case-insensitive email comparison + trim', async () => {
    process.env.ADMIN_EMAIL = '  Admin@Example.COM  ';
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'admin@EXAMPLE.com',
      email_verified: true,
      uid: 'uid-x',
    });
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const result = await verifyAdminToken(reqWith('Bearer t'));
    expect(result.ok).toBe(true);
  });
});
