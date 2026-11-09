import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Cred = { projectId: string };
type App = { name: string; options: { credential?: Cred; projectId?: string } };

const h = vi.hoisted(() => {
  const state = {
    apps: [] as unknown[],
    throwPrimary: false,
    overrideProject: '',
  };
  const cert = vi.fn((o: Record<string, string>) => {
    if (state.throwPrimary && 'privateKey' in o) throw new Error('bad pem FAKEKEY-zz9');
    const projectId = state.overrideProject || o.projectId || o.project_id;
    return { projectId };
  });
  const getApps = vi.fn(() => state.apps);
  const initializeApp = vi.fn((options: Record<string, unknown>) => {
    const app = { name: '[DEFAULT]', options };
    state.apps.push(app);
    return app;
  });
  const settings = vi.fn();
  const getFirestore = vi.fn(() => ({ settings }));
  const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn(), log: vi.fn() };
  return { state, cert, getApps, initializeApp, settings, getFirestore, logger };
});

vi.mock('firebase-admin/app', () => ({ cert: h.cert, getApps: h.getApps, initializeApp: h.initializeApp }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: h.getFirestore }));
vi.mock('../../api/_shared/log.js', () => ({ logger: h.logger }));

const PROV = '../../api/_shared/firebase-admin-provenance.js';
const CENTRAL = '../../api/_shared/firebase-admin.js';
const KEY = 'FAKEKEY-zz9';
const EMAIL = 'fake-sa@fake.test';
const PREV = 'prev-proj';
const PROD = 'prod-proj';
const fetchTrap = vi.fn(() => { throw new Error('network forbidden'); });

const saKey = (project_id: string) =>
  Buffer.from(JSON.stringify({ project_id, client_email: EMAIL, private_key: KEY })).toString('base64');

function setEnv(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    VERCEL_ENV: 'preview', NODE_ENV: 'test', FIREBASE_PROJECT_ID: PREV,
    FIREBASE_PRODUCTION_PROJECT_ID: PROD, FIREBASE_CLIENT_EMAIL: EMAIL, FIREBASE_PRIVATE_KEY: KEY,
    GOOGLE_SERVICE_ACCOUNT_KEY: '', FIREBASE_ENV_GUARD: 'warn', GOOGLE_CLOUD_PROJECT: '', GCLOUD_PROJECT: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) vi.stubEnv(k, v);
}

async function load() {
  const prov = await import(PROV);
  const central = await import(CENTRAL);
  return { prov, db: central.initAdminDb() };
}

function expectRejected(db: unknown) {
  expect(db).toBeNull();
  expect(h.getFirestore).not.toHaveBeenCalled();
  expect(h.settings).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.state.apps = [];
  h.state.throwPrimary = false;
  h.state.overrideProject = '';
  vi.stubGlobal('fetch', fetchTrap);
});

afterEach(() => {
  const logged = Object.values(h.logger).flatMap((f) => f.mock.calls.flat()).map(String).join('|');
  expect(logged).not.toContain(KEY);
  expect(logged).not.toContain(EMAIL);
  expect(fetchTrap).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('provenance registry', () => {
  beforeEach(() => setEnv());

  it('registers idempotently and rejects re-binding', async () => {
    const prov = await import(PROV);
    const c: Cred = { projectId: 'p' };
    prov.registerCertCredential(c, { projectId: 'p', source: 's' });
    expect(() => prov.registerCertCredential(c, { projectId: 'p', source: 's' })).not.toThrow();
    expect(() => prov.registerCertCredential(c, { projectId: 'q' })).toThrow();
    const app: App = { name: 'a', options: { credential: c, projectId: 'p' } };
    prov.registerCreatedApp(app, { credential: c, projectId: 'p' });
    expect(() => prov.registerCreatedApp(app, { credential: c, projectId: 'p' })).not.toThrow();
    expect(prov.verifyPreviewApp(app, 'p')).toEqual({ ok: true });
    expect(prov.verifyPreviewApp(app, 'q').ok).toBe(false);
  });

  it('detects tampered credential project, options, identity', async () => {
    const prov = await import(PROV);
    const mk = () => {
      const c: Cred = { projectId: 'p' };
      prov.registerCertCredential(c, { projectId: 'p' });
      const app: App = { name: 'a', options: { credential: c, projectId: 'p' } };
      prov.registerCreatedApp(app, { credential: c, projectId: 'p' });
      return { c, app };
    };
    const a = mk(); a.c.projectId = 'evil';
    expect(prov.verifyPreviewApp(a.app, 'p').reason).toBe('credential-live-project-mismatch');
    const b = mk(); b.app.options.projectId = 'evil';
    expect(prov.verifyPreviewApp(b.app, 'p').reason).toBe('app-options-project-mismatch');
    const d = mk(); d.app.options.credential = { projectId: 'p' };
    expect(prov.verifyPreviewApp(d.app, 'p').reason).toBe('app-credential-changed');
    const clone: App = { name: 'a', options: { ...mk().app.options } };
    expect(prov.verifyPreviewApp(clone, 'p').reason).toBe('app-unregistered');
  });

  it('rejects unregistered ADC app with cached expected project and unknown apps', async () => {
    const prov = await import(PROV);
    const adc: App = { name: 'adc', options: { credential: { projectId: 'p' }, projectId: 'p' } };
    expect(() => prov.registerCreatedApp(adc, { credential: adc.options.credential, projectId: 'p' })).toThrow();
    expect(prov.verifyPreviewApp(adc, 'p').reason).toBe('app-unregistered');
    expect(prov.verifyPreviewApp({}, 'p').reason).toBe('app-unregistered');
    expect(prov.verifyPreviewApp(null, 'p').reason).toBe('app-invalid');
  });
});

describe('central preview bootstrap', () => {
  it('safe primary creates new verified app', async () => {
    setEnv();
    const { db } = await load();
    expect(db).not.toBeNull();
    expect(h.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: PREV }));
    expect(h.settings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
  });

  it('safe fallback used when primary cert throws', async () => {
    setEnv({ GOOGLE_SERVICE_ACCOUNT_KEY: saKey(PREV) });
    h.state.throwPrimary = true;
    const { db } = await load();
    expect(db).not.toBeNull();
    expect(h.cert).toHaveBeenCalledTimes(2);
  });

  it('foreign fallback rejected before init', async () => {
    setEnv({ FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '', GOOGLE_SERVICE_ACCOUNT_KEY: saKey(PROD) });
    const { db } = await load();
    expectRejected(db);
    expect(h.cert).not.toHaveBeenCalled();
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it('selected primary with mismatched project rejects without fallback', async () => {
    setEnv({ GOOGLE_SERVICE_ACCOUNT_KEY: saKey(PREV) });
    h.state.overrideProject = PROD;
    const { db } = await load();
    expectRejected(db);
    expect(h.cert).toHaveBeenCalledTimes(1);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });

  it.each([
    ['missing project', { FIREBASE_PROJECT_ID: '' }],
    ['missing production project', { FIREBASE_PRODUCTION_PROJECT_ID: '' }],
    ['equal projects', { FIREBASE_PROJECT_ID: PROD }],
  ])('rejects config: %s', async (_n, over) => {
    setEnv(over);
    const { db } = await load();
    expectRejected(db);
    expect(h.cert).not.toHaveBeenCalled();
  });

  it('missing credential with existing app rejects', async () => {
    setEnv({ FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '' });
    h.state.apps = [{ name: 'x', options: { projectId: PREV } }];
    const { db } = await load();
    expectRejected(db);
  });

  it('reuses registered named app from same registry', async () => {
    setEnv();
    const prov = await import(PROV);
    const c: Cred = { projectId: PREV };
    prov.registerCertCredential(c, { projectId: PREV, source: 'test' });
    const app: App = { name: 'named', options: { credential: c, projectId: PREV } };
    prov.registerCreatedApp(app, { credential: c, projectId: PREV });
    h.state.apps = [app];
    const central = await import(CENTRAL);
    expect(central.initAdminDb()).not.toBeNull();
    expect(h.initializeApp).not.toHaveBeenCalled();
    expect(h.getFirestore).toHaveBeenCalledWith(app);
  });

  it('denies unregistered matching app', async () => {
    setEnv();
    h.state.apps = [{ name: 'x', options: { credential: { projectId: PREV }, projectId: PREV } }];
    const { db } = await load();
    expectRejected(db);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });
});

describe('legacy path preserved', () => {
  it.each([
    ['production', { VERCEL_ENV: 'production', NODE_ENV: 'production', FIREBASE_PROJECT_ID: PROD }],
    ['development', { VERCEL_ENV: 'development', NODE_ENV: 'development', FIREBASE_PROJECT_ID: PROD }],
    ['Preview casing', { VERCEL_ENV: 'Preview', FIREBASE_PROJECT_ID: PROD }],
    ['NODE_ENV preview', { VERCEL_ENV: '', NODE_ENV: 'preview', FIREBASE_PROJECT_ID: PROD }],
  ])('%s uses legacy init', async (_n, over) => {
    setEnv(over);
    const { db } = await load();
    expect(db).not.toBeNull();
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    const opts = h.initializeApp.mock.calls[0][0];
    expect(Object.keys(opts)).toEqual(['credential']);
    expect(h.cert).toHaveBeenCalledWith({ projectId: PROD, clientEmail: EMAIL, privateKey: KEY });
    expect(h.logger.warn.mock.calls.flat().map(String).join('|')).not.toContain('[preview]');
  });
});

