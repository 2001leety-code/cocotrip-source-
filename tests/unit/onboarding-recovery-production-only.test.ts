// Real route and shared modules, mocked SDK calls. No persistence model or write API.
// Production cases terminate at authentication/not-found/dryRun; the real issuer is never run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => {
  const state = { apps: [] as object[], claims: { uid: 'admin-fixture', email: 'admin@example.invalid', email_verified: true }, revoked: false };
  const verifyIdToken = vi.fn(async () => {
    if (state.revoked) throw Object.assign(new Error('Revoked fixture'), { code: 'auth/id-token-revoked' });
    return state.claims;
  });
  const missing = async () => { throw Object.assign(new Error('Missing fixture'), { code: 'auth/user-not-found' }); };
  const getUser = vi.fn(missing);
  const getUserByEmail = vi.fn(missing);
  const getAuth = vi.fn(() => ({ verifyIdToken, getUser, getUserByEmail }));
  const cert = vi.fn((value: object) => value);
  const getApps = vi.fn(() => state.apps);
  const initializeApp = vi.fn((options: object) => { const app = { options }; state.apps.push(app); return app; });
  const read = vi.fn(async () => ({ exists: false }));
  const doc = vi.fn(() => ({ get: read }));
  const collection = vi.fn(() => ({ doc }));
  const db = { settings: vi.fn(), collection }; // No transaction, set, update, or delete implementation.
  return { state, verifyIdToken, getUser, getUserByEmail, getAuth, cert, getApps, initializeApp,
    read, doc, collection, db, getFirestore: vi.fn(() => db) };
});
vi.mock('firebase-admin/app', () => ({ cert: h.cert, getApps: h.getApps, initializeApp: h.initializeApp }));
vi.mock('firebase-admin/auth', () => ({ getAuth: h.getAuth }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: h.getFirestore }));

const routes = [
  { name: 'single', file: '../../api/admin-coupon-fix.js', body: { uid: 'missing-fixture' } },
  { name: 'batch', file: '../../api/admin-issue-onboarding-coupons.js', body: { uid: 'missing-fixture', dryRun: false } },
];
async function call(route: typeof routes[number], method = 'POST', body: unknown = route.body, authorized = true) {
  const { default: handler } = await import(route.file);
  const result = { status: 0, body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  await handler({ method, body, headers: { origin: 'http://localhost:5173', ...(authorized ? { authorization: 'Bearer fixture-token' } : {}) } }, {
    writeHead: (status: number, headers: Record<string, string>) => { result.status = status; result.headers = headers; },
    end: (s?: string) => { result.body = s ? JSON.parse(s) : {}; },
  });
  return result;
}
function expectNoRuntimeActivity() {
  for (const fn of [h.cert, h.getApps, h.initializeApp, h.getFirestore, h.getAuth, h.verifyIdToken,
    h.getUser, h.getUserByEmail, h.collection, h.read]) expect(fn).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  h.state.apps = []; h.state.revoked = false;
  h.state.claims = { uid: 'admin-fixture', email: 'admin@example.invalid', email_verified: true };
  for (const [key, value] of Object.entries({ VERCEL_ENV: 'production', ADMIN_EMAIL: 'admin@example.invalid',
    VITE_ADMIN_EMAIL: '', FIREBASE_PROJECT_ID: 'production-fixture', FIREBASE_PRODUCTION_PROJECT_ID: 'production-fixture',
    FIREBASE_CLIENT_EMAIL: 'fixture@example.invalid', FIREBASE_PRIVATE_KEY: 'FAKE-NON-KEY',
    GOOGLE_SERVICE_ACCOUNT_KEY: '', SENTRY_DSN: '' })) vi.stubEnv(key, value);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(routes)('$name recovery production-only entry', route => {
  it.each(['preview', 'development', 'test', '', undefined, 'Production', 'production ', 'preview-production'])('denies %s before Firebase bootstrap and target access', async env => {
    vi.stubEnv('VERCEL_ENV', env);
    const result = await call(route);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, code: 'RECOVERY_PRODUCTION_ONLY' });
    expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expectNoRuntimeActivity();
  });
  it.each(['production', 'preview'])('importing the route alone in %s has no Firebase initialization', async env => {
    vi.stubEnv('VERCEL_ENV', env);
    await import(route.file);
    expectNoRuntimeActivity();
  });
  it.each([['OPTIONS', 200], ['GET', 405]])('preserves %s without initializing Firebase', async (method, status) => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await call(route, String(method))).status).toBe(status);
    expectNoRuntimeActivity();
  });
  it('keeps production missing-token rejection before reading a malformed body', async () => {
    expect((await call(route, 'POST', '{bad-json', false)).status).toBe(401);
    expect(h.verifyIdToken).not.toHaveBeenCalled();
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.collection).not.toHaveBeenCalled();
  });
  it('keeps production non-admin rejection ahead of request parsing', async () => {
    h.state.claims.email = 'other@example.invalid';
    expect((await call(route, 'POST', '{bad-json')).status).toBe(403);
    expect(h.verifyIdToken).toHaveBeenCalledWith('fixture-token', true);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.collection).not.toHaveBeenCalled();
  });
  it('keeps production email verification required', async () => {
    h.state.claims.email_verified = false;
    expect((await call(route)).status).toBe(403);
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('keeps production revoked tokens rejected', async () => {
    h.state.revoked = true;
    expect((await call(route)).status).toBe(401);
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('keeps production missing-admin configuration closed', async () => {
    vi.stubEnv('ADMIN_EMAIL', '');
    expect((await call(route)).status).toBe(500);
    expect(h.verifyIdToken).not.toHaveBeenCalled();
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('keeps production target-not-found closed before any document access', async () => {
    const result = await call(route);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ ok: false, code: 'USER_NOT_FOUND' });
    expect(h.getUser).toHaveBeenCalledWith('missing-fixture');
    expect(h.collection).not.toHaveBeenCalled();
    expect(h.initializeApp).toHaveBeenCalledOnce();
  });
  it('still denies Preview if a production request warmed the module cache', async () => {
    expect((await call(route)).status).toBe(404);
    vi.clearAllMocks();
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await call(route)).status).toBe(503);
    expectNoRuntimeActivity();
  });
  it('loads Firebase and the real issuer only dynamically behind the environment gate', () => {
    const src = readFileSync(new URL(route.file, import.meta.url), 'utf8');
    const guard = src.indexOf("process.env.VERCEL_ENV !== 'production'");
    expect(guard).toBeGreaterThan(-1);
    for (const spec of ['./_shared/admin-auth.js', './_shared/firebase-admin.js', './onboarding-coupons.js']) {
      expect(src).not.toMatch(new RegExp(`^import .+ from ['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'm'));
      expect(src.indexOf(`await import('${spec}')`)).toBeGreaterThan(guard);
    }
  });
});

it('keeps the production single-email lookup normalized and not-found closed', async () => {
  expect((await call(routes[0], 'POST', { email: ' MISSING@EXAMPLE.INVALID ' })).status).toBe(404);
  expect(h.getUserByEmail).toHaveBeenCalledWith('missing@example.invalid');
  expect(h.collection).not.toHaveBeenCalled();
});
it('keeps production UID dryRun read-only without target Auth lookup', async () => {
  const result = await call(routes[1], 'POST', { uid: 'missing-fixture', dryRun: true });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ ok: true, results: { dryRun: true, issued: 0, candidates: 0 } });
  expect(h.getUser).not.toHaveBeenCalled();
  expect(h.read).toHaveBeenCalledOnce();
});
it('denies Preview dryRun as well, before reading any document', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect((await call(routes[1], 'POST', { uid: 'missing-fixture', dryRun: true })).status).toBe(503);
  expectNoRuntimeActivity();
});
