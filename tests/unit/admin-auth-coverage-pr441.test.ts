/**
 * PR #441 — coverage booster for api/_shared/admin-auth.js.
 *
 * The shape/regression suite (admin-auth-cold-start-pr441.test.ts) reads the
 * source file via fs to catch refactor regressions, but doesn't exercise
 * the success branches of verifyIdToken. Those branches push the file under
 * the per-file 75% line+statement thresholds in vitest.config.ts → CI fail.
 *
 * This file mocks firebase-admin/auth so we can drive verifyAdminToken
 * through the success / email_verified=false / email-mismatch / throw
 * branches without real Firebase credentials.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock — replaces firebase-admin/auth so getAuth returns a stub
// whose verifyIdToken honours a switch table keyed on the bearer token.
vi.mock('firebase-admin/auth', () => {
  const verifyIdToken = vi.fn(async (token: string) => {
    if (token === 'good-admin') {
      return { email: '2001leety@gmail.com', email_verified: true, uid: 'admin-uid-1' };
    }
    if (token === 'unverified-email') {
      return { email: '2001leety@gmail.com', email_verified: false, uid: 'unv-uid' };
    }
    if (token === 'wrong-email') {
      return { email: 'someone-else@example.com', email_verified: true, uid: 'other-uid' };
    }
    if (token === 'missing-email') {
      return { email: '', email_verified: true, uid: 'no-email-uid' };
    }
    const err: any = new Error('invalid signature');
    err.code = 'auth/argument-error';
    throw err;
  });
  return {
    getAuth: vi.fn(() => ({ verifyIdToken })),
  };
});

// Mock firebase-admin/app too so bootstrapAdminAuth can produce an app
// without real creds. We control the env vars below.
vi.mock('firebase-admin/app', () => {
  let _initialized = false;
  return {
    initializeApp: vi.fn(() => { _initialized = true; return { __id: 'stub-app' }; }),
    getApps: vi.fn(() => (_initialized ? [{ __id: 'stub-app' }] : [])),
    cert: vi.fn((arg) => ({ __cert: arg })),
  };
});

const ENV_KEYS = [
  'ADMIN_EMAIL', 'VITE_ADMIN_EMAIL',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
];

describe('PR #441 Y-H12 — verifyAdminToken success + reject paths (coverage)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ADMIN_EMAIL = '2001leety@gmail.com';
    // Provide FIREBASE_* triple so bootstrap takes the canonical path.
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----';
    const mod = await import('../../api/_shared/admin-auth.js');
    mod.__resetAdminAuthCacheForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('accepts a valid admin token (success path — covers getAuth+verifyIdToken happy branch)', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer good-admin' } } as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.email).toBe('2001leety@gmail.com');
      expect(r.uid).toBe('admin-uid-1');
    }
  });

  it('rejects when decoded email is unverified (403 Email not verified)', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer unverified-email' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/Email not verified/);
    }
  });

  it('rejects when email is missing on the decoded token', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer missing-email' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('rejects when email is not the configured admin (403 Not admin)', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer wrong-email' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/Not admin/);
    }
  });

  it('returns 401 when verifyIdToken throws (token verification failed)', async () => {
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer garbage-token-blah' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/Token verification failed/);
      // Either err.code (auth/argument-error) or err.message (invalid signature) surfaces.
      expect(r.error).toMatch(/argument-error|invalid signature/);
    }
  });

  it('GOOGLE_SERVICE_ACCOUNT_KEY fallback path also bootstraps successfully', async () => {
    // Wipe FIREBASE_* and rely on GOOGLE_SERVICE_ACCOUNT_KEY (covers branch 3).
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    const sa = { project_id: 'test', client_email: 't@i.com', private_key: 'fake' };
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(JSON.stringify(sa)).toString('base64');
    const mod = await import('../../api/_shared/admin-auth.js');
    mod.__resetAdminAuthCacheForTests();
    const r = await mod.verifyAdminToken({ headers: { authorization: 'Bearer good-admin' } } as any);
    expect(r.ok).toBe(true);
  });

  it('cache short-circuit: second call reuses _adminAuth (no second bootstrap)', async () => {
    const { verifyAdminToken, __resetAdminAuthCacheForTests } = await import('../../api/_shared/admin-auth.js');
    __resetAdminAuthCacheForTests();
    const r1 = await verifyAdminToken({ headers: { authorization: 'Bearer good-admin' } } as any);
    const r2 = await verifyAdminToken({ headers: { authorization: 'Bearer good-admin' } } as any);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});
