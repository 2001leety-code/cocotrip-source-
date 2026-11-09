// tests/unit/preview-firebase-consumers-20261109.test.ts
//
// BOUNDED LEXICAL HARNESS. This is NOT a full consumer-module, HTTP, or E2E test.
// - It reads each consumer source file as text and extracts exactly one private
//   initializer: from its unique opening line up to the next '\n}\n'.
// - It evaluates that text with new Function, passing in fully mocked dependencies.
// - The shared resolver (getPreviewFirebaseApp / previewFirebaseErrorCode) is mocked
//   here. That resolver is tested independently elsewhere.
// - No network, no real Firebase, no business or auth-token logic is exercised.
// - The legacy synthetic-credential init pathway is intentionally omitted. This
//   harness does not assume the names of the legacy credential env keys.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';

type Kind = 'admin' | 'reviews' | 'daily' | 'db';

interface Spec {
  name: string;
  url: URL;
  sig: string;
  fnName: string;
  kind: Kind;
  importLine: string;
}

const SPECS: Spec[] = [
  {
    name: 'admin-auth',
    url: new URL('../../api/_shared/admin-auth.js', import.meta.url),
    sig: 'function bootstrapAdminAuth() {',
    fnName: 'bootstrapAdminAuth',
    kind: 'admin',
    importLine: "import { getPreviewFirebaseApp } from './preview-firebase-app.js';",
  },
  {
    name: 'reviews',
    url: new URL('../../api/reviews.js', import.meta.url),
    sig: 'async function getFirestore() {',
    fnName: 'getFirestore',
    kind: 'reviews',
    importLine:
      "import { getPreviewFirebaseApp, previewFirebaseErrorCode } from './_shared/preview-firebase-app.js';",
  },
  {
    name: 'daily-report',
    url: new URL('../../api/_crons/daily-report.js', import.meta.url),
    sig: 'async function getFirestoreAdmin() {',
    fnName: 'getFirestoreAdmin',
    kind: 'daily',
    importLine:
      "import { getPreviewFirebaseApp, previewFirebaseErrorCode } from '../_shared/preview-firebase-app.js';",
  },
  {
    name: 'refund-reminder',
    url: new URL('../../api/_crons/refund-reminder.js', import.meta.url),
    sig: 'async function getDb() {',
    fnName: 'getDb',
    kind: 'db',
    importLine:
      "import { getPreviewFirebaseApp, previewFirebaseErrorCode } from '../_shared/preview-firebase-app.js';",
  },
  {
    name: 'review-request',
    url: new URL('../../api/_crons/review-request.js', import.meta.url),
    sig: 'async function getDb() {',
    fnName: 'getDb',
    kind: 'db',
    importLine:
      "import { getPreviewFirebaseApp, previewFirebaseErrorCode } from '../_shared/preview-firebase-app.js';",
  },
];

const FIXED = 'PREVIEW_FIREBASE_INIT_FAILED';
const ALLOWED = new Set(['PREVIEW_FIREBASE_CONFIG_INVALID']);
const SECRET = 'SENTINEL-private_key-sk_live_DO_NOT_LEAK';
const PREVIEW_GUARD = "process.env.VERCEL_ENV === 'preview'";

function readSrc(spec: Spec): string {
  return readFileSync(spec.url, 'utf8').replace(/\r\n/g, '\n');
}

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

function extract(spec: Spec): string {
  const src = readSrc(spec);
  expect(count(src, spec.sig)).toBe(1);
  const start = src.indexOf(spec.sig);
  const end = src.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  const text = src.slice(start, end + 2);
  // Swap dynamic import(...) for the injected mockImport, inside the extracted text only.
  return text.replace(/(?<![\w$.])import\s*\(/g, 'mockImport(');
}

function asRecord(v: unknown): Record<string, unknown> {
  expect(typeof v).toBe('object');
  expect(v).not.toBeNull();
  return v as Record<string, unknown>;
}

function makeStubs(env: Record<string, string | undefined>) {
  const order: string[] = [];
  const legacyApp = { kind: 'legacyApp' };
  const state: {
    previewApp: unknown;
    resolverError: Error | null;
    sdkError: Error | null;
    legacyApps: unknown[];
  } = { previewApp: { kind: 'previewApp', id: 1 }, resolverError: null, sdkError: null, legacyApps: [] };
  let n = 0;

  const resolver = vi.fn((): unknown => {
    order.push('resolver');
    if (state.resolverError) throw state.resolverError;
    return state.previewApp;
  });
  const errorCode = vi.fn((e: unknown): string =>
    e instanceof Error && ALLOWED.has(e.message) ? e.message : FIXED,
  );
  const getAuth = vi.fn((...args: unknown[]): unknown => {
    order.push('getAuth');
    if (state.sdkError) throw state.sdkError;
    return { kind: 'auth', app: args.length ? args[0] : legacyApp, n: ++n };
  });
  const getFirestore = vi.fn((...args: unknown[]): unknown => {
    order.push('getFirestore');
    if (state.sdkError) throw state.sdkError;
    return { kind: 'db', app: args.length ? args[0] : legacyApp, n: ++n };
  });
  const getApps = vi.fn((): unknown[] => {
    order.push('getApps');
    return state.legacyApps;
  });
  const cert = vi.fn((): unknown => ({ kind: 'cred' }));
  const initializeApp = vi.fn((): unknown => {
    order.push('initializeApp');
    return { kind: 'initApp' };
  });
  const FieldValue = { kind: 'FieldValue' };
  const appMod = { getApps, cert, initializeApp };
  const fsMod = { getFirestore, FieldValue };
  const mockImport = vi.fn(async (s: unknown): Promise<unknown> => {
    order.push(`import:${String(s)}`);
    if (s === 'firebase-admin/app') return appMod;
    if (s === 'firebase-admin/firestore') return fsMod;
    throw new Error('unexpected import');
  });
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return {
    env, order, state, legacyApp, resolver, errorCode, getAuth, getFirestore,
    getApps, cert, initializeApp, FieldValue, mockImport, console,
  };
}
type Stubs = ReturnType<typeof makeStubs>;

const PARAMS = [
  'process', 'getPreviewFirebaseApp', 'previewFirebaseErrorCode', 'getAuth',
  'getApps', 'cert', 'initializeApp', 'Buffer', 'console', 'mockImport',
];

function build(spec: Spec, s: Stubs): () => unknown {
  const prefix = spec.kind === 'admin' ? 'let _adminAuth = null;\nlet _bootstrapTried = false;\n' : '';
  const body = `${prefix}${extract(spec)}\nreturn ${spec.fnName};`;
  const factory = new Function(...PARAMS, body) as (...a: unknown[]) => unknown;
  const fn: unknown = factory(
    { env: s.env }, s.resolver, s.errorCode, s.getAuth, s.getApps, s.cert,
    s.initializeApp, Buffer, s.console, s.mockImport,
  );
  expect(typeof fn).toBe('function');
  return fn as () => unknown;
}

async function invoke(fn: () => unknown): Promise<unknown> {
  return await fn();
}

function lastResult(m: { mock: { results: Array<{ value: unknown }> } }): unknown {
  return m.mock.results[m.mock.results.length - 1]?.value;
}

function expectPreviewSuccess(spec: Spec, s: Stubs, result: unknown, app: unknown): void {
  if (spec.kind === 'admin') {
    const call = s.getAuth.mock.calls[s.getAuth.mock.calls.length - 1];
    expect(call).toHaveLength(1);
    expect(call?.[0]).toBe(app);
    expect(result).toBe(lastResult(s.getAuth));
    expect(asRecord(result).app).toBe(app);
    return;
  }
  const call = s.getFirestore.mock.calls[s.getFirestore.mock.calls.length - 1];
  expect(call).toHaveLength(1);
  expect(call?.[0]).toBe(app);
  const db = lastResult(s.getFirestore);
  if (spec.kind === 'daily') {
    expect(result).toBe(db);
    return;
  }
  const r = asRecord(result);
  expect(r.db).toBe(db);
  if (spec.kind === 'db') {
    expect(r.FieldValue).toBe(s.FieldValue);
    expect(Object.keys(r).sort()).toEqual(['FieldValue', 'db']);
  } else {
    expect(Object.keys(r)).toEqual(['db']);
  }
}

function expectNoLegacy(s: Stubs): void {
  expect(s.getApps).not.toHaveBeenCalled();
  expect(s.cert).not.toHaveBeenCalled();
  expect(s.initializeApp).not.toHaveBeenCalled();
}

function expectNoLogs(s: Stubs): void {
  for (const f of Object.values(s.console)) expect(f).not.toHaveBeenCalled();
}

describe.each(SPECS)('preview firebase consumer: $name', (spec) => {
  it('statically imports the resolver once from the correct relative file and guards once', () => {
    const src = readSrc(spec);
    expect(count(src, spec.importLine)).toBe(1);
    expect(count(src, 'preview-firebase-app.js')).toBe(1);
    expect(count(extract(spec), PREVIEW_GUARD)).toBe(1);
  });

  it('preview success: returns the expected shape for the verified app; resolver runs first', async () => {
    const s = makeStubs({ VERCEL_ENV: 'preview' });
    const fn = build(spec, s);
    const result = await invoke(fn);
    expectPreviewSuccess(spec, s, result, s.state.previewApp);
    expect(s.order[0]).toBe('resolver');
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expectNoLegacy(s);
    expectNoLogs(s);
  });

  it('revalidates the app on every call; a different second app is not stale', async () => {
    const s = makeStubs({ VERCEL_ENV: 'preview' });
    const fn = build(spec, s);
    const app1 = { kind: 'previewApp', id: 1 };
    const app2 = { kind: 'previewApp', id: 2 };
    s.state.previewApp = app1;
    const r1 = await invoke(fn);
    expectPreviewSuccess(spec, s, r1, app1);
    s.state.previewApp = app2;
    const r2 = await invoke(fn);
    expectPreviewSuccess(spec, s, r2, app2);
    expect(r2).not.toBe(r1);
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expectNoLegacy(s);
  });

  it('resolver throws: no getters/imports/legacy; fixed code or null', async () => {
    const s = makeStubs({ VERCEL_ENV: 'preview' });
    s.state.resolverError = new Error('PREVIEW_FIREBASE_CONFIG_INVALID');
    const fn = build(spec, s);
    if (spec.kind === 'admin') {
      expect(await invoke(fn)).toBeNull();
    } else {
      await expect(invoke(fn)).rejects.toThrow(/^PREVIEW_FIREBASE_CONFIG_INVALID$/);
      expect(s.errorCode).toHaveBeenCalledWith(s.state.resolverError);
    }
    expect(s.mockImport).not.toHaveBeenCalled();
    expect(s.getAuth).not.toHaveBeenCalled();
    expect(s.getFirestore).not.toHaveBeenCalled();
    expectNoLegacy(s);
    expectNoLogs(s);
  });

  it('SDK getter throws a secret-ish error: null or fixed code, no leak, no logging, no fallback', async () => {
    const s = makeStubs({ VERCEL_ENV: 'preview' });
    s.state.sdkError = new Error(SECRET);
    const fn = build(spec, s);
    if (spec.kind === 'admin') {
      expect(await invoke(fn)).toBeNull();
    } else {
      const err: unknown = await invoke(fn).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toBe(FIXED);
      expect(msg).not.toContain(SECRET);
    }
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expectNoLegacy(s);
    expectNoLogs(s);
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['production', { VERCEL_ENV: 'production' }],
    ['development', { VERCEL_ENV: 'development' }],
    ['undefined', {}],
    ['Preview (case)', { VERCEL_ENV: 'Preview' }],
    ['preview with space', { VERCEL_ENV: 'preview ' }],
  ])('non-preview env %s uses the legacy body with an existing app and never calls the resolver', async (_l, env) => {
    const s = makeStubs({ ...env });
    s.state.legacyApps = [s.legacyApp];
    const fn = build(spec, s);
    const result = await invoke(fn);
    expect(s.resolver).not.toHaveBeenCalled();
    expect(s.errorCode).not.toHaveBeenCalled();
    if (spec.kind === 'admin') {
      expect(asRecord(result).app).toBe(s.legacyApp);
      for (const c of s.getAuth.mock.calls) expect(c).not.toContain(s.state.previewApp);
      return;
    }
    expect(s.getFirestore.mock.calls.some((c) => c.length === 0)).toBe(true);
    for (const c of s.getFirestore.mock.calls) expect(c).not.toContain(s.state.previewApp);
    const db = lastResult(s.getFirestore);
    if (spec.kind === 'daily') {
      expect(result).toBe(db);
    } else {
      const r = asRecord(result);
      expect(r.db).toBe(db);
      if (spec.kind === 'db') expect(r.FieldValue).toBe(s.FieldValue);
    }
  });

  it('legacy with no credentials: null for admin/daily; throws a legacy (non-preview) error otherwise', async () => {
    const s = makeStubs({ VERCEL_ENV: 'production' });
    s.state.legacyApps = [];
    const fn = build(spec, s);
    if (spec.kind === 'admin' || spec.kind === 'daily') {
      expect(await invoke(fn)).toBeNull();
    } else {
      const err: unknown = await invoke(fn).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toBe(FIXED);
    }
    expect(s.resolver).not.toHaveBeenCalled();
  });
});

describe('admin-auth cache transitions (same lexical closure)', () => {
  const spec = SPECS[0];

  it('production cache is never returned to preview, and is unpolluted by preview', async () => {
    const s = makeStubs({ VERCEL_ENV: 'production' });
    s.state.legacyApps = [s.legacyApp];
    const fn = build(spec, s);
    const prod1 = await invoke(fn);
    expect(asRecord(prod1).app).toBe(s.legacyApp);

    s.env.VERCEL_ENV = 'preview';
    s.state.resolverError = new Error('PREVIEW_FIREBASE_CONFIG_INVALID');
    expect(await invoke(fn)).toBeNull();

    s.state.resolverError = null;
    const prev = await invoke(fn);
    expect(asRecord(prev).app).toBe(s.state.previewApp);
    expect(prev).not.toBe(prod1);

    const prev2 = await invoke(fn);
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(prev2).not.toBe(prev);

    s.env.VERCEL_ENV = 'production';
    const prod2 = await invoke(fn);
    expect(prod2).toBe(prod1);
    expect(s.resolver).toHaveBeenCalledTimes(3);
  });

  it('cold preview then production yields the production app, not the preview auth', async () => {
    const s = makeStubs({ VERCEL_ENV: 'preview' });
    s.state.legacyApps = [s.legacyApp];
    const fn = build(spec, s);
    const prev = await invoke(fn);
    expect(asRecord(prev).app).toBe(s.state.previewApp);
    s.env.VERCEL_ENV = 'production';
    const prod = await invoke(fn);
    expect(prod).not.toBe(prev);
    expect(asRecord(prod).app).toBe(s.legacyApp);
    expect(s.resolver).toHaveBeenCalledTimes(1);
  });
});
