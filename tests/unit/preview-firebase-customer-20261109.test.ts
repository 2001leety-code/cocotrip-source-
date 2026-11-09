// Focused offline tests for the exact-Preview Firebase initialization changes.
// - firebase-admin/app is mocked with in-memory fakes. There is no network, no real credentials and no token calls.
// - The real resolver and provenance modules are used. vi.resetModules() runs before each case.
// EXTRACTION LIMITATIONS (documented on purpose):
// - user-auth getAuthInstance, plan-status bootstrap and recalc-transit bootstrap/guard are
//   extracted as bounded source text and evaluated with new Function and injected fakes.
// - Each extracted snippet is anchored on its exact markers, after normalizing CRLF/CR to LF.
// - Full route modules are NOT imported, so module-level imports, rate limits, other
//   handlers and business logic are out of scope.
// - In recalc, only the handler prefix up to the 503 guard is evaluated. A sentinel return
//   stands in for the rest of the handler.
// - Dynamic imports in getAuthInstance are rewritten to an injected loader. The real resolver
//   is injected through a wrapper that passes an explicit env.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Rec = Record<string, unknown>;
interface FakeApp { name: string; options: Rec }
interface ResolverMod {
  getPreviewFirebaseApp: (env?: Rec) => FakeApp;
  previewFirebaseErrorCode: (e: unknown) => string;
  PREVIEW_FIREBASE_ERRORS: Record<string, string>;
}
interface CodedErr { code?: string; message: string; stack?: string }

const SENTINEL = 'FAKE_SECRET_SENTINEL_9f3';
const h = vi.hoisted(() => {
  const state = {
    apps: [] as { name: string; options: Record<string, unknown> }[],
    certThrow: (o: Record<string, unknown>): boolean => !o,
    getAppsThrow: null as Error | null,
  };
  const cert = vi.fn((o: Record<string, unknown>) => {
    if (state.certThrow(o)) throw new Error('cert failed FAKE_SECRET_SENTINEL_9f3');
    return { kind: 'fake-cred', projectId: (o.projectId !== null && o.projectId !== undefined ? o.projectId : o.project_id) as unknown };
  });
  const getApps = vi.fn(() => {
    if (state.getAppsThrow) throw state.getAppsThrow;
    return [...state.apps];
  });
  const initializeApp = vi.fn((opts?: Record<string, unknown>) => {
    const app = { name: '[DEFAULT]', options: { ...(opts !== null && opts !== undefined ? opts : {}) } };
    state.apps.push(app);
    return app;
  });
  return { state, cert, getApps, initializeApp };
});
vi.mock('firebase-admin/app', () => ({ cert: h.cert, getApps: h.getApps, initializeApp: h.initializeApp }));

const E = {
  NOT_PREVIEW: 'PREVIEW_FIREBASE_NOT_PREVIEW',
  CONFIG_INVALID: 'PREVIEW_FIREBASE_CONFIG_INVALID',
  CREDENTIAL_MISSING: 'PREVIEW_FIREBASE_CREDENTIAL_MISSING',
  CREDENTIAL_INVALID: 'PREVIEW_FIREBASE_CREDENTIAL_INVALID',
  CREDENTIAL_PROVENANCE: 'PREVIEW_FIREBASE_CREDENTIAL_PROVENANCE',
  APP_REJECTED: 'PREVIEW_FIREBASE_APP_REJECTED',
  INIT_FAILED: 'PREVIEW_FIREBASE_INIT_FAILED',
};
const base = (): Rec => ({
  VERCEL_ENV: 'preview',
  FIREBASE_PROJECT_ID: 'demo-preview',
  FIREBASE_PRODUCTION_PROJECT_ID: 'demo-prod',
  FIREBASE_CLIENT_EMAIL: 'sa@demo-preview.test',
  FIREBASE_PRIVATE_KEY: `KEY_${SENTINEL}`,
});
const noPrimary = (): Rec => { const e = base(); delete e.FIREBASE_CLIENT_EMAIL; delete e.FIREBASE_PRIVATE_KEY; return e; };
const b64 = (o: Rec): string => Buffer.from(JSON.stringify(o)).toString('base64');
const sa = (project: string): Rec => ({ project_id: project, client_email: 'fb@x.test', private_key: SENTINEL });

async function load(): Promise<ResolverMod> {
  return (await import('../../api/_shared/preview-firebase-app.js')) as unknown as ResolverMod;
}
function errOf(fn: () => unknown): CodedErr {
  try { fn(); } catch (e) { return e as CodedErr; }
  throw new Error('expected throw');
}
const src = (f: string): string => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\r\n?/g, '\n');
function between(s: string, start: string, endIncl: string): string {
  const i = s.indexOf(start);
  expect(i, `start marker ${start}`).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(endIncl, i);
  expect(j, `end marker ${endIncl}`).toBeGreaterThan(i);
  return s.slice(i, j + endIncl.length);
}
const fakeConsole = () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() });

let envSnap: NodeJS.ProcessEnv;
let fetchTrap: ReturnType<typeof vi.fn>;
beforeEach(() => {
  envSnap = { ...process.env };
  vi.resetModules();
  vi.clearAllMocks();
  fetchTrap = vi.fn(() => { throw new Error('network forbidden'); });
  vi.stubGlobal('fetch', fetchTrap);
  h.state.apps.length = 0;
  h.state.certThrow = () => false;
  h.state.getAppsThrow = null;
});
afterEach(() => {
  expect(fetchTrap).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.env = envSnap;
});

describe('preview-firebase-app resolver', () => {
  it('import is lazy', async () => {
    await load();
    expect(h.cert).not.toHaveBeenCalled();
    expect(h.getApps).not.toHaveBeenCalled();
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('requires exact preview', async () => {
    const m = await load();
    for (const v of ['production', 'Preview', ' preview', 'development', undefined]) {
      expect(errOf(() => m.getPreviewFirebaseApp({ ...base(), VERCEL_ENV: v })).code).toBe(E.NOT_PREVIEW);
    }
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('rejects missing or equal project configs', async () => {
    const m = await load();
    const cases: Rec[] = [
      { ...base(), FIREBASE_PROJECT_ID: '' },
      { ...base(), FIREBASE_PRODUCTION_PROJECT_ID: undefined },
      { ...base(), FIREBASE_PRODUCTION_PROJECT_ID: ' demo-preview ' },
    ];
    for (const env of cases) expect(errOf(() => m.getPreviewFirebaseApp(env)).code).toBe(E.CONFIG_INVALID);
    expect(h.cert).not.toHaveBeenCalled();
  });

  it('canonical FIREBASE_* cert succeeds', async () => {
    const m = await load();
    const app = m.getPreviewFirebaseApp(base());
    expect(h.cert).toHaveBeenCalledWith({ projectId: 'demo-preview', clientEmail: 'sa@demo-preview.test', privateKey: `KEY_${SENTINEL}` });
    expect(h.initializeApp).toHaveBeenCalledWith({ credential: app.options.credential, projectId: 'demo-preview' });
  });

  it('fallback used when primary absent', async () => {
    const m = await load();
    const app = m.getPreviewFirebaseApp({ ...noPrimary(), GOOGLE_SERVICE_ACCOUNT_KEY: b64(sa('demo-preview')) });
    expect(h.cert).toHaveBeenCalledTimes(1);
    expect(h.cert.mock.calls[0][0]).toMatchObject({ project_id: 'demo-preview' });
    expect(app.options.projectId).toBe('demo-preview');
  });

  it('fallback used when primary cert throws', async () => {
    h.state.certThrow = (o) => 'clientEmail' in o;
    const m = await load();
    const app = m.getPreviewFirebaseApp({ ...base(), GOOGLE_SERVICE_ACCOUNT_KEY: b64(sa('demo-preview')) });
    expect(h.cert).toHaveBeenCalledTimes(2);
    expect(app.options.projectId).toBe('demo-preview');
  });

  it('fallback ignored when primary is valid', async () => {
    const m = await load();
    m.getPreviewFirebaseApp({ ...base(), GOOGLE_SERVICE_ACCOUNT_KEY: b64(sa('demo-prod')) });
    expect(h.cert).toHaveBeenCalledTimes(1);
  });

  it('foreign fallback rejected before cert', async () => {
    const m = await load();
    const e = errOf(() => m.getPreviewFirebaseApp({ ...noPrimary(), GOOGLE_SERVICE_ACCOUNT_KEY: b64(sa('demo-prod')) }));
    expect(e.code).toBe(E.CREDENTIAL_INVALID);
    expect(h.cert).not.toHaveBeenCalled();
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('selected credentials missing rejects even with existing app', async () => {
    const m = await load();
    m.getPreviewFirebaseApp(base());
    expect(errOf(() => m.getPreviewFirebaseApp(noPrimary())).code).toBe(E.CREDENTIAL_MISSING);
  });

  it('unknown existing app rejected, never adopted', async () => {
    h.state.apps.push({ name: '[DEFAULT]', options: { projectId: 'demo-preview' } });
    const m = await load();
    expect(errOf(() => m.getPreviewFirebaseApp(base())).code).toBe(E.APP_REJECTED);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('repeated calls return same app, one initialize', async () => {
    const m = await load();
    const a = m.getPreviewFirebaseApp(base());
    expect(m.getPreviewFirebaseApp(base())).toBe(a);
    expect(m.getPreviewFirebaseApp(base())).toBe(a);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.cert).toHaveBeenCalledTimes(1);
  });

  it('mutated cached credential project rejects', async () => {
    const m = await load();
    const app = m.getPreviewFirebaseApp(base());
    (app.options.credential as Rec).projectId = 'demo-prod';
    expect(errOf(() => m.getPreviewFirebaseApp(base())).code).toBe(E.CREDENTIAL_PROVENANCE);
  });

  it('mutated separately cached credential rejects on hit while app A exists (primary + fallback)', async () => {
    const m = await load();
    const fb = b64(sa('demo-preview'));
    const a = m.getPreviewFirebaseApp(base());
    const envB = { ...base(), FIREBASE_CLIENT_EMAIL: 'other@demo-preview.test' };
    expect(m.getPreviewFirebaseApp(envB)).toBe(a);
    const envC = { ...noPrimary(), GOOGLE_SERVICE_ACCOUNT_KEY: fb };
    expect(m.getPreviewFirebaseApp(envC)).toBe(a);
    expect(h.cert).toHaveBeenCalledTimes(3);
    const credB = h.cert.mock.results[1].value as Rec;
    const credC = h.cert.mock.results[2].value as Rec;
    expect(credB).not.toBe(a.options.credential);
    credB.projectId = 'demo-prod';
    credC.projectId = 'demo-prod';
    for (let i = 0; i < 2; i++) {
      expect(errOf(() => m.getPreviewFirebaseApp(envB)).code).toBe(E.CREDENTIAL_PROVENANCE);
      expect(errOf(() => m.getPreviewFirebaseApp({ ...envB, GOOGLE_SERVICE_ACCOUNT_KEY: fb })).code).toBe(E.CREDENTIAL_PROVENANCE);
      expect(errOf(() => m.getPreviewFirebaseApp(envC)).code).toBe(E.CREDENTIAL_PROVENANCE);
    }
    expect(h.cert).toHaveBeenCalledTimes(3);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(m.getPreviewFirebaseApp(base())).toBe(a);
  });

  it('mutated app options reject', async () => {
    const m = await load();
    const app = m.getPreviewFirebaseApp(base());
    app.options.projectId = 'demo-prod';
    expect(errOf(() => m.getPreviewFirebaseApp(base())).code).toBe(E.APP_REJECTED);
    app.options.projectId = 'demo-preview';
    app.options.credential = { projectId: 'demo-preview' };
    expect(errOf(() => m.getPreviewFirebaseApp(base())).code).toBe(E.APP_REJECTED);
  });

  it('errors are sanitized', async () => {
    h.state.getAppsThrow = new Error(`boom ${SENTINEL}`);
    const m = await load();
    const e = errOf(() => m.getPreviewFirebaseApp(base()));
    expect(e.code).toBe(E.INIT_FAILED);
    expect(e.message).toBe(E.INIT_FAILED);
    expect(String(e.stack !== null && e.stack !== undefined ? e.stack : '')).not.toContain(SENTINEL);
    expect(JSON.stringify(e)).not.toContain(SENTINEL);
    expect(m.previewFirebaseErrorCode(new Error(SENTINEL))).toBe(E.INIT_FAILED);
    expect(m.previewFirebaseErrorCode(e)).toBe(E.INIT_FAILED);
  });
});

describe('user-auth getAuthInstance (bounded extraction)', () => {
  function build(previewEnv: Rec, m: ResolverMod, getAuth: (...a: unknown[]) => unknown, env: Rec) {
    const s = src('api/_shared/user-auth.js');
    const start = s.indexOf('async function getAuthInstance() {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = s.slice(start + 1);
    const next = rest.search(/\n(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s/);
    const fn = next < 0 ? s.slice(start) : s.slice(start, start + 1 + next);
    expect(fn).toContain("if (process.env.VERCEL_ENV === 'preview')");
    const body = fn.replace(/await import\((['"])([^'"]+)\1\)/g, (_m, _q, spec: string) => `await __imp(${JSON.stringify(spec)})`);
    expect(body).not.toMatch(/\bimport\(/);
    const imp = async (spec: string): Promise<unknown> => {
      if (spec === 'firebase-admin/app') return { getApps: h.getApps, initializeApp: h.initializeApp, cert: h.cert };
      if (spec === 'firebase-admin/auth') return { getAuth };
      if (spec === './preview-firebase-app.js') return { getPreviewFirebaseApp: () => m.getPreviewFirebaseApp(previewEnv) };
      throw new Error(`unexpected import ${spec}`);
    };
    const factory = new Function('__imp', 'process', 'Buffer', `${body}\nreturn getAuthInstance;`) as (...a: unknown[]) => () => Promise<unknown>;
    return factory(imp, { env }, Buffer);
  }

  it('preview passes resolved app to getAuth', async () => {
    const m = await load();
    const getAuth = vi.fn((...a: unknown[]) => ({ auth: true, argc: a.length }));
    const fn = build(base(), m, getAuth, { VERCEL_ENV: 'preview' });
    await fn();
    expect(getAuth).toHaveBeenCalledTimes(1);
    const app = getAuth.mock.calls[0][0] as FakeApp;
    expect(app.options.projectId).toBe('demo-preview');
    expect(h.state.apps[0]).toBe(app);
  });

  it('preview failure propagates sanitized code, no getAuth', async () => {
    const m = await load();
    const getAuth = vi.fn();
    const fn = build(noPrimary(), m, getAuth, { VERCEL_ENV: 'preview' });
    await expect(fn()).rejects.toMatchObject({ code: E.CREDENTIAL_MISSING });
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('non-preview keeps legacy getAuth()', async () => {
    h.state.apps.push({ name: '[DEFAULT]', options: {} });
    const m = await load();
    const getAuth = vi.fn((...a: unknown[]) => ({ argc: a.length }));
    const fn = build(base(), m, getAuth, { VERCEL_ENV: 'production' });
    await fn();
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getAuth.mock.calls[0]).toHaveLength(0);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('development keeps legacy getAuth()', async () => {
    h.state.apps.push({ name: '[DEFAULT]', options: {} });
    const m = await load();
    const getAuth = vi.fn((...a: unknown[]) => ({ argc: a.length }));
    const fn = build(base(), m, getAuth, { VERCEL_ENV: 'development' });
    await fn();
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getAuth.mock.calls[0]).toHaveLength(0);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });
});

describe('plan-status bootstrap (bounded extraction)', () => {
  const snippet = (): string => between(src('api/plan-status.js'), 'let adminDb = null;\n// [preview-firebase:plan-status]',
    "} catch (e) { console.warn('[plan-status] Firebase init error:', e.message); }\n}\n");
  async function run(env: Rec) {
    const m = await load();
    const getAdminFirestore = vi.fn((app: unknown) => ({ db: true, app }));
    const con = fakeConsole();
    const f = new Function('getApps', 'initializeApp', 'cert', 'getAdminFirestore', 'getPreviewFirebaseApp', 'previewFirebaseErrorCode', 'process', 'console',
      `${snippet()}\nreturn adminDb;`) as (...a: unknown[]) => unknown;
    const db = f(h.getApps, h.initializeApp, h.cert, getAdminFirestore, () => m.getPreviewFirebaseApp(env), m.previewFirebaseErrorCode, { env }, con);
    return { db, getAdminFirestore, con };
  }

  it('exact preview failure -> null, no ADC, code-only warn', async () => {
    const r = await run({ ...base(), FIREBASE_PRODUCTION_PROJECT_ID: 'demo-preview' });
    expect(r.db).toBeNull();
    expect(h.initializeApp).not.toHaveBeenCalled();
    expect(r.getAdminFirestore).not.toHaveBeenCalled();
    expect(r.con.warn).toHaveBeenCalledWith('[plan-status] preview Firebase init rejected:', E.CONFIG_INVALID);
  });

  it('exact preview success uses resolver app', async () => {
    const r = await run(base());
    expect(r.getAdminFirestore).toHaveBeenCalledWith(h.state.apps[0]);
    expect(r.db).not.toBeNull();
  });

  it('other env preserves legacy init', async () => {
    const r = await run({ ...base(), VERCEL_ENV: 'production' });
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0][0]).toHaveProperty('credential');
    expect(h.initializeApp.mock.calls[0][0]).not.toHaveProperty('projectId');
    expect(r.db).not.toBeNull();
  });

  it('development preserves legacy init', async () => {
    const r = await run({ ...base(), VERCEL_ENV: 'development' });
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0][0]).toHaveProperty('credential');
    expect(h.initializeApp.mock.calls[0][0]).not.toHaveProperty('projectId');
    expect(r.db).not.toBeNull();
  });
});

describe('recalc-transit bootstrap + 503 guard (bounded extraction)', () => {
  function code(): string {
    const s = src('api/recalc-transit.js');
    const boot = between(s, '// [preview-firebase:recalc-transit] Exact Preview', 'db = getFirestore();\n}\n');
    const guard = between(s, 'export default async function handler(req, res) {',
      "return res.status(503).json({ error: 'firebase_unavailable' });\n  }").replace('export default async function', 'async function');
    return `${boot}\n${guard}\n  return 'PAST_GUARD';\n}\nreturn { db, handler };`;
  }
  async function run(env: Rec) {
    const m = await load();
    const getFirestore = vi.fn((app?: unknown) => ({ db: true, app }));
    const f = new Function('getApps', 'initializeApp', 'cert', 'getFirestore', 'getPreviewFirebaseApp', 'previewFirebaseErrorCode', 'process', 'console', code()) as
      (...a: unknown[]) => { db: unknown; handler: (req: unknown, res: unknown) => Promise<unknown> };
    const out = f(h.getApps, h.initializeApp, h.cert, getFirestore, () => m.getPreviewFirebaseApp(env), m.previewFirebaseErrorCode, { env }, fakeConsole());
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return { ...out, getFirestore, res };
  }

  it('exact preview failure -> db null, no ADC, 503 before other work', async () => {
    const r = await run(noPrimary());
    expect(r.db).toBeNull();
    expect(h.initializeApp).not.toHaveBeenCalled();
    expect(r.getFirestore).not.toHaveBeenCalled();
    const out = await r.handler({}, r.res);
    expect(out).not.toBe('PAST_GUARD');
    expect(r.res.status).toHaveBeenCalledWith(503);
    expect(r.res.json).toHaveBeenCalledWith({ error: 'firebase_unavailable' });
  });

  it('exact preview success passes guard', async () => {
    const r = await run(base());
    expect(r.getFirestore).toHaveBeenCalledWith(h.state.apps[0]);
    expect(await r.handler({}, r.res)).toBe('PAST_GUARD');
  });

  it('other env preserves legacy initializeApp()', async () => {
    const r = await run({ VERCEL_ENV: 'production' });
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0]).toHaveLength(0);
    expect(r.getFirestore.mock.calls[0]).toHaveLength(0);
    expect(await r.handler({}, r.res)).toBe('PAST_GUARD');
  });

  it('development preserves legacy initializeApp()', async () => {
    const r = await run({ VERCEL_ENV: 'development' });
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp.mock.calls[0]).toHaveLength(0);
    expect(r.getFirestore.mock.calls[0]).toHaveLength(0);
    expect(await r.handler({}, r.res)).toBe('PAST_GUARD');
  });
});
