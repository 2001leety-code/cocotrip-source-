/**
 * api/_shared/admin-auth.js — Preview branch + stand-alone init paths.
 *
 * Since PR #1496 admin-auth.js imports ./firebase-admin.js, whose import-time
 * bootstrap creates the (mocked) app first, so the older suites only reach the
 * "reuse existing app" path. Here ./firebase-admin.js is a stub (no bootstrap),
 * so admin-auth.js runs its own Preview branch and its own cert()/initializeApp().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { verifyAdminToken, __resetAdminAuthCacheForTests } from '../../api/_shared/admin-auth.js';

type FakeApp = { name: string; options?: unknown };

const h = vi.hoisted(() => ({
  apps: [] as FakeApp[],
  previewApp: null as FakeApp | null,
  initAdminApp: vi.fn(),
  getApps: vi.fn(),
  cert: vi.fn(),
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminApp: h.initAdminApp }));
vi.mock('firebase-admin/app', () => ({ getApps: h.getApps, cert: h.cert, initializeApp: h.initializeApp }));
vi.mock('firebase-admin/auth', () => ({ getAuth: h.getAuth }));

const ADMIN = 'admin@example.com';
const DECODED = { email: ADMIN, email_verified: true, uid: 'uid-admin' };
const OK = { ok: true, email: ADMIN, uid: 'uid-admin', claims: { admin: false, roles: [] }, roles: [] };
const INIT_FAILED = {
  ok: false,
  status: 500,
  error: expect.stringMatching(/^firebase-admin init failed\b.*FIREBASE_PROJECT_ID.*GOOGLE_SERVICE_ACCOUNT_KEY/),
};
const PROJECT = 'standalone-project';
const CLIENT_EMAIL = `svc@${PROJECT}.iam.gserviceaccount.com`;
// Vercel keeps the PEM with literal backslash-n sequences; cert() must get real newlines.
const PEM_ESCAPED = '-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n';
const PEM = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n';
const SERVICE_ACCOUNT = { project_id: 'sa-project', client_email: 'svc@sa-project.iam.gserviceaccount.com', private_key: PEM };

const req = (token = 'admin-token') => ({ headers: { authorization: `Bearer ${token}` } });
const setTripleEnv = () => {
  vi.stubEnv('FIREBASE_PROJECT_ID', PROJECT);
  vi.stubEnv('FIREBASE_CLIENT_EMAIL', CLIENT_EMAIL);
  vi.stubEnv('FIREBASE_PRIVATE_KEY', PEM_ESCAPED);
};
const setServiceAccountKeyEnv = () =>
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', Buffer.from(JSON.stringify(SERVICE_ACCOUNT)).toString('base64'));

// Same rule as node_modules/firebase-admin/lib/app/lifecycle.js: initializeApp() with a
// credential only succeeds while no [DEFAULT] app exists; otherwise the SDK throws.
function sdkInitializeApp(options: unknown): FakeApp {
  if (h.apps.some((app) => app.name === '[DEFAULT]')) {
    throw Object.assign(
      new Error('Firebase app named "[DEFAULT]" already exists and initializeApp was invoked with an optional Credential.'),
      { code: 'app/invalid-app-options' },
    );
  }
  const app = { name: '[DEFAULT]', options };
  h.apps.push(app);
  return app;
}

let warn: MockInstance;
let error: MockInstance;

beforeEach(() => {
  for (const key of ['VERCEL_ENV', 'VITE_ADMIN_EMAIL', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY']) {
    vi.stubEnv(key, '');
  }
  vi.stubEnv('ADMIN_EMAIL', ADMIN);
  h.apps = [];
  h.previewApp = null;
  h.initAdminApp.mockReset().mockImplementation(() => h.previewApp);
  h.getApps.mockReset().mockImplementation(() => [...h.apps]);
  h.cert.mockReset().mockImplementation((serviceAccount: unknown) => ({ certFor: serviceAccount }));
  h.initializeApp.mockReset().mockImplementation(sdkInitializeApp);
  h.getAuth.mockReset().mockImplementation(() => ({ verifyIdToken: h.verifyIdToken }));
  h.verifyIdToken.mockReset().mockResolvedValue(DECODED);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  __resetAdminAuthCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('admin-auth Preview branch — only the shared Preview app may authenticate', () => {
  it('1. no shared app -> 500 even with FIREBASE_* and GOOGLE_SERVICE_ACCOUNT_KEY set; no own init, no token check', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    setTripleEnv();
    setServiceAccountKeyEnv();
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(h.initAdminApp).toHaveBeenCalledTimes(1);
    for (const fn of [h.cert, h.initializeApp, h.getApps, h.getAuth, h.verifyIdToken]) {
      expect(fn).toHaveBeenCalledTimes(0);
    }
  });

  it('2. shared app -> getAuth(that exact app), verifyIdToken(token, true), ok:true with claims, no initializeApp', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const shared = { name: '[DEFAULT]' };
    h.previewApp = shared;
    h.verifyIdToken.mockResolvedValue({ ...DECODED, admin: true, roles: ['super-admin'] });
    await expect(verifyAdminToken(req('preview-admin-token'))).resolves.toEqual({
      ...OK,
      claims: { admin: true, roles: ['super-admin'] },
      roles: ['super-admin'],
    });
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.getAuth.mock.calls[0][0]).toBe(shared);
    expect(h.verifyIdToken).toHaveBeenCalledTimes(1);
    expect(h.verifyIdToken).toHaveBeenCalledWith('preview-admin-token', true);
    for (const fn of [h.initializeApp, h.cert, h.getApps]) expect(fn).toHaveBeenCalledTimes(0);
  });

  it('3. shared app but getAuth throws -> 500 without throwing; no fall-through to own cert/initializeApp', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    setTripleEnv();
    const shared = { name: '[DEFAULT]' };
    h.previewApp = shared;
    h.getAuth.mockImplementation(() => {
      throw new Error('auth service unavailable');
    });
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.getAuth.mock.calls[0][0]).toBe(shared);
    for (const fn of [h.getApps, h.cert, h.initializeApp, h.verifyIdToken]) expect(fn).toHaveBeenCalledTimes(0);
  });

  it('4. without a shared app the cached production auth is not used', async () => {
    h.apps = [{ name: '[DEFAULT]' }];
    await expect(verifyAdminToken(req())).resolves.toEqual(OK); // non-Preview: fills the _adminAuth cache
    expect(h.getAuth).toHaveBeenCalledTimes(1);

    vi.stubEnv('VERCEL_ENV', 'preview'); // cache deliberately NOT reset; initAdminApp() stays null
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(h.initAdminApp).toHaveBeenCalledTimes(1);
    expect(h.verifyIdToken).toHaveBeenCalledTimes(1);

    // The cache really was filled the whole time: production requests still use it without re-bootstrap.
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.verifyIdToken).toHaveBeenCalledTimes(2);
  });
});

describe('admin-auth stand-alone init (no app created by firebase-admin.js)', () => {
  it('5. FIREBASE_* triple wins over a valid GOOGLE_SERVICE_ACCOUNT_KEY (key not consulted) -> cert with real newlines -> one initializeApp -> ok:true; repeat call is served from cache', async () => {
    // Both valid on purpose: the key is only a fallback, so cert() must run exactly once.
    setTripleEnv();
    setServiceAccountKeyEnv();
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(h.cert).toHaveBeenCalledTimes(1);
    expect(h.cert).toHaveBeenCalledWith({ projectId: PROJECT, clientEmail: CLIENT_EMAIL, privateKey: PEM });
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0][0]).toEqual({ credential: h.cert.mock.results[0].value });
    expect(h.initializeApp.mock.calls[0][0].credential).toBe(h.cert.mock.results[0].value);
    expect(h.getAuth.mock.calls[0][0]).toBe(h.initializeApp.mock.results[0].value);

    const counts = () => [h.getApps, h.getAuth, h.initializeApp, h.cert].map((fn) => fn.mock.calls.length);
    const before = counts();
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(counts()).toEqual(before);
    expect(h.verifyIdToken).toHaveBeenCalledTimes(2);
  });

  it('6. only GOOGLE_SERVICE_ACCOUNT_KEY (base64 JSON) -> cert gets the decoded object -> initializeApp -> ok:true', async () => {
    setServiceAccountKeyEnv();
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(h.cert).toHaveBeenCalledTimes(1);
    expect(h.cert.mock.calls[0][0]).toStrictEqual(SERVICE_ACCOUNT);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0][0].credential).toBe(h.cert.mock.results[0].value);
  });

  it('7. cert() rejects the FIREBASE_* triple -> one warning, GOOGLE_SERVICE_ACCOUNT_KEY fallback succeeds', async () => {
    setTripleEnv();
    setServiceAccountKeyEnv();
    h.cert.mockImplementationOnce(() => {
      throw new Error('Invalid PEM formatted message.');
    });
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[admin-auth] cert() with FIREBASE_* failed:', 'Invalid PEM formatted message.');
    expect(h.cert).toHaveBeenCalledTimes(2);
    expect(h.cert.mock.calls[1][0]).toStrictEqual(SERVICE_ACCOUNT);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0][0].credential).toBe(h.cert.mock.results[1].value);
  });

  it('8. GOOGLE_SERVICE_ACCOUNT_KEY is not base64 JSON and nothing else is set -> actionable 500, nothing thrown', async () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', '{"project_id":"raw-json-instead-of-base64"}');
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[admin-auth] GOOGLE_SERVICE_ACCOUNT_KEY parse failed:');
    for (const fn of [h.cert, h.initializeApp, h.verifyIdToken]) expect(fn).toHaveBeenCalledTimes(0);
  });

  it('9. initializeApp throws -> exactly 500, nothing thrown, token never verified', async () => {
    setTripleEnv();
    h.initializeApp.mockImplementation(() => {
      throw new Error('initializeApp exploded');
    });
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[admin-auth] initializeApp failed:', 'initializeApp exploded');
    expect(h.getAuth).toHaveBeenCalledTimes(0);
    expect(h.verifyIdToken).toHaveBeenCalledTimes(0);
  });

  it('10a. getAuth fails on an existing NAMED app -> warning, own [DEFAULT] init succeeds -> ok:true', async () => {
    setTripleEnv();
    const named = { name: 'secondary' };
    h.apps = [named];
    h.getAuth.mockImplementationOnce(() => {
      throw new Error('named app auth broken');
    });
    await expect(verifyAdminToken(req())).resolves.toEqual(OK);
    expect(warn).toHaveBeenCalledWith('[admin-auth] getAuth on existing app failed:', 'named app auth broken');
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    const created = h.initializeApp.mock.results[0].value;
    expect(h.getAuth).toHaveBeenCalledTimes(2);
    expect(h.getAuth.mock.calls[0][0]).toBe(named);
    expect(h.getAuth.mock.calls[1][0]).toBe(created);
  });

  it('10b. getAuth fails on the existing [DEFAULT] app -> SDK refuses a second [DEFAULT] -> 500, nothing thrown', async () => {
    setTripleEnv();
    const existing = { name: '[DEFAULT]' };
    h.apps = [existing];
    h.getAuth.mockImplementationOnce(() => {
      throw new Error('default app auth broken');
    });
    await expect(verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    expect(warn).toHaveBeenCalledWith('[admin-auth] getAuth on existing app failed:', 'default app auth broken');
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.getAuth.mock.calls[0][0]).toBe(existing);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[admin-auth] initializeApp failed:', expect.stringContaining('already exists'));
    expect(h.verifyIdToken).toHaveBeenCalledTimes(0);
  });
});
