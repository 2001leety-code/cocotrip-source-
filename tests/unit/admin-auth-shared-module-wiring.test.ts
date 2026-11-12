/**
 * Wiring between the REAL api/_shared/firebase-admin.js bootstrap and admin-auth.js.
 *
 * preview-firebase-runtime-isolation.test.ts covers the shared bootstrap itself; this
 * file checks what admin auth does with that bootstrap's result. Only the firebase-admin
 * SDK is mocked. vi.resetModules() + dynamic import re-runs the bootstrap per case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type FakeApp = { name: string; options: unknown };

const h = vi.hoisted(() => ({
  apps: [] as FakeApp[],
  getApps: vi.fn(),
  cert: vi.fn(),
  initializeApp: vi.fn(),
  getFirestore: vi.fn(),
  getAuth: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({ getApps: h.getApps, cert: h.cert, initializeApp: h.initializeApp }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: h.getFirestore }));
vi.mock('firebase-admin/auth', () => ({ getAuth: h.getAuth }));

const PREVIEW = 'cocotrip-preview-2026';
const PROD = 'cocotrip-prod-for-tests';
const ADMIN = 'admin@example.com';
const OK = { ok: true, email: ADMIN, uid: 'uid-admin', claims: { admin: false, roles: [] }, roles: [] };
const INIT_FAILED = {
  ok: false,
  status: 500,
  error: expect.stringMatching(/^firebase-admin init failed\b.*FIREBASE_PROJECT_ID.*GOOGLE_SERVICE_ACCOUNT_KEY/),
};
const req = (token = 'admin-token') => ({ headers: { authorization: `Bearer ${token}` } });
const setFirebaseEnv = (projectId: string, clientEmail: string) => {
  vi.stubEnv('FIREBASE_PROJECT_ID', projectId);
  vi.stubEnv('FIREBASE_CLIENT_EMAIL', clientEmail);
  vi.stubEnv('FIREBASE_PRIVATE_KEY', 'FAKE-KEY');
};

// Same rule as node_modules/firebase-admin/lib/app/lifecycle.js: the app is registered
// (visible to getApps) as soon as initializeApp returns, and a credential-bearing
// initializeApp() for an existing [DEFAULT] app throws.
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

// admin-auth.js imports firebase-admin.js, so the shared bootstrap has already run when
// the first import resolves; the second import returns that same module instance.
async function load() {
  const auth = await import('../../api/_shared/admin-auth.js');
  const shared = await import('../../api/_shared/firebase-admin.js');
  return { auth, shared };
}

beforeEach(() => {
  vi.resetModules();
  const blank = [
    'VERCEL_ENV', 'VITE_ADMIN_EMAIL', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'GOOGLE_SERVICE_ACCOUNT_KEY', 'FIREBASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
  ];
  for (const key of blank) vi.stubEnv(key, '');
  vi.stubEnv('ADMIN_EMAIL', ADMIN);
  vi.stubEnv('FIREBASE_PRODUCTION_PROJECT_ID', PROD);
  vi.stubEnv('FIREBASE_ENV_GUARD', 'warn');
  // vi.resetModules() does not touch this state, so reset it here.
  h.apps = [];
  h.getApps.mockReset().mockImplementation(() => [...h.apps]);
  // The SDK credential exposes projectId/clientEmail, which the Preview guard re-checks.
  h.cert.mockReset().mockImplementation((serviceAccount: object) => ({ ...serviceAccount }));
  h.initializeApp.mockReset().mockImplementation(sdkInitializeApp);
  h.getFirestore.mockReset().mockImplementation(() => ({ projectId: PREVIEW, settings: vi.fn() }));
  h.getAuth.mockReset().mockImplementation(() => ({ verifyIdToken: h.verifyIdToken }));
  h.verifyIdToken.mockReset().mockResolvedValue({ email: ADMIN, email_verified: true, uid: 'uid-admin' });
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('admin-auth <- real firebase-admin.js bootstrap', () => {
  it('11. Preview pointed at a production-like project: shared module refuses, admin auth answers 500 and does not self-init', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const prodEmail = `firebase-adminsdk@${PROD}.iam.gserviceaccount.com`;
    setFirebaseEnv(PROD, prodEmail);
    vi.stubEnv(
      'GOOGLE_SERVICE_ACCOUNT_KEY',
      Buffer.from(JSON.stringify({ project_id: PROD, client_email: prodEmail, private_key: 'FAKE-KEY' })).toString('base64'),
    );
    const { auth, shared } = await load();
    expect(shared.initAdminApp()).toBeNull();
    expect(shared.previewFirebaseState()).toEqual({ isolated: false, projectId: null });

    await expect(auth.verifyAdminToken(req())).resolves.toEqual(INIT_FAILED);
    for (const fn of [h.cert, h.initializeApp, h.getApps, h.getAuth, h.verifyIdToken]) {
      expect(fn).toHaveBeenCalledTimes(0);
    }
  });

  it('12. Preview with the correct Preview target: getAuth gets the app the shared module created -> ok:true', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    setFirebaseEnv(PREVIEW, `test@${PREVIEW}.iam.gserviceaccount.com`);
    const { auth, shared } = await load();
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    const created = h.initializeApp.mock.results[0].value;
    expect(shared.initAdminApp()).toBe(created);

    await expect(auth.verifyAdminToken(req('preview-admin-token'))).resolves.toEqual(OK);
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.getAuth.mock.calls[0][0]).toBe(created);
    expect(h.verifyIdToken).toHaveBeenCalledWith('preview-admin-token', true);
    // Only the shared module initialised Firebase; admin auth added no cert/initializeApp of its own.
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.cert).toHaveBeenCalledTimes(1);
  });

  it('13. Production, shared bootstrap fails after initializeApp (getFirestore throws): admin auth reuses the registered [DEFAULT] app', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    setFirebaseEnv(PROD, `firebase-adminsdk@${PROD}.iam.gserviceaccount.com`);
    h.getFirestore.mockImplementation(() => {
      throw new Error('firestore unavailable');
    });
    const { auth, shared } = await load();
    expect(shared.initAdminApp()).toBeNull();
    expect(shared.initAdminDb()).toBeNull();
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    const registered = h.initializeApp.mock.results[0].value;

    await expect(auth.verifyAdminToken(req())).resolves.toEqual(OK);
    // Path taken: the "reuse existing app" branch, getAuth(getApps()[0]), not admin auth's own init.
    expect(h.getAuth).toHaveBeenCalledTimes(1);
    expect(h.getAuth.mock.calls[0][0]).toBe(registered);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.cert).toHaveBeenCalledTimes(1);
  });
});
