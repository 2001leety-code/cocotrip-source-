// NOTE: These tests mock both the Firebase Admin SDK (getAuth) and the app resolver.
// They verify only app-selection and wrapper wiring logic (which app instance is passed
// to the SDK and that the same auth object is returned).
// They do NOT prove real ID-token verification or correct runtime configuration
// (credentials, project IDs, env vars) in preview or production.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => {
  const fakeAuth = { kind: 'fake-auth' };
  return {
    fakeAuth,
    sdkGetAuth: vi.fn((...args: unknown[]) => {
      void args;
      return fakeAuth;
    }),
    getPreviewFirebaseApp: vi.fn((): unknown => ({ name: 'fake-preview-app' })),
  };
});

vi.mock('firebase-admin/auth', () => ({ getAuth: mocks.sdkGetAuth }));
vi.mock('../../api/_shared/preview-firebase-app.js', () => ({
  getPreviewFirebaseApp: mocks.getPreviewFirebaseApp,
}));

const WRAPPER = '../../api/_shared/firebase-auth-app.js';
const originalEnv = process.env.VERCEL_ENV;
const originalFetch = globalThis.fetch;

function setEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = value;
  }
}

async function loadWrapper(): Promise<{ getAuth: () => unknown }> {
  return (await import(WRAPPER)) as { getAuth: () => unknown };
}

beforeEach(() => {
  vi.resetModules();
  mocks.sdkGetAuth.mockClear();
  mocks.getPreviewFirebaseApp.mockReset();
  mocks.getPreviewFirebaseApp.mockImplementation(() => ({ name: 'fake-preview-app' }));
  globalThis.fetch = (() => {
    throw new Error('network access is not allowed in this test');
  }) as typeof fetch;
});

afterEach(() => {
  setEnv(originalEnv);
  globalThis.fetch = originalFetch;
});

describe('firebase-auth-app wrapper', () => {
  it('import is lazy: no SDK getter or resolver calls', async () => {
    setEnv('preview');
    await loadWrapper();
    expect(mocks.sdkGetAuth).toHaveBeenCalledTimes(0);
    expect(mocks.getPreviewFirebaseApp).toHaveBeenCalledTimes(0);
  });

  it('preview passes the exact resolved app identity', async () => {
    setEnv('preview');
    const fakeApp = { name: 'fake-verified-app' };
    mocks.getPreviewFirebaseApp.mockImplementation(() => fakeApp);
    const { getAuth } = await loadWrapper();
    const result = getAuth();
    expect(mocks.getPreviewFirebaseApp).toHaveBeenCalledTimes(1);
    expect(mocks.sdkGetAuth).toHaveBeenCalledTimes(1);
    expect(mocks.sdkGetAuth.mock.calls[0]).toHaveLength(1);
    expect(mocks.sdkGetAuth.mock.calls[0][0]).toBe(fakeApp);
    expect(result).toBe(mocks.fakeAuth);
  });

  it('preview resolver failure propagates and SDK getter is not called', async () => {
    setEnv('preview');
    mocks.getPreviewFirebaseApp.mockImplementation(() => {
      throw new Error('FAKE_FIXED_RESOLVER_ERROR');
    });
    const { getAuth } = await loadWrapper();
    expect(() => getAuth()).toThrow('FAKE_FIXED_RESOLVER_ERROR');
    expect(mocks.sdkGetAuth).toHaveBeenCalledTimes(0);
  });

  for (const env of ['production', 'development', undefined]) {
    it(`non-preview (${String(env)}) preserves zero-arg sdkGetAuth()`, async () => {
      setEnv(env);
      const { getAuth } = await loadWrapper();
      const result = getAuth();
      expect(mocks.sdkGetAuth).toHaveBeenCalledTimes(1);
      expect(mocks.sdkGetAuth.mock.calls[0]).toHaveLength(0);
      expect(mocks.getPreviewFirebaseApp).toHaveBeenCalledTimes(0);
      expect(result).toBe(mocks.fakeAuth);
    });
  }

  it('reads current env on each invocation', async () => {
    setEnv('production');
    const { getAuth } = await loadWrapper();
    getAuth();
    setEnv('preview');
    getAuth();
    setEnv(undefined);
    getAuth();
    expect(mocks.sdkGetAuth.mock.calls[0]).toHaveLength(0);
    expect(mocks.sdkGetAuth.mock.calls[1]).toHaveLength(1);
    expect(mocks.sdkGetAuth.mock.calls[2]).toHaveLength(0);
    expect(mocks.getPreviewFirebaseApp).toHaveBeenCalledTimes(1);
  });
});

describe('source contract (text only, no route imports)', () => {
  const root = resolve(__dirname, '../..');
  const cases: Array<[string, string, number]> = [
    ['api/_shared/ai-entitlement.js', "await import('./firebase-auth-app.js')", 1],
    ['api/_shared/payment-fulfillment-recovery.js', "await import('./firebase-auth-app.js')", 1],
    ['api/log-revision-reason.js', "await import('./_shared/firebase-auth-app.js')", 1],
    ['api/manual-payment-request.js', "await import('./_shared/firebase-auth-app.js')", 1],
    ['api/capturePaypalOrder.js', "await import('./_shared/firebase-auth-app.js')", 2],
    ['api/pdf/generate.js', "await import('../_shared/firebase-auth-app.js')", 1],
  ];
  for (const [file, needle, count] of cases) {
    it(`${file} uses wrapper import x${count} and no firebase-admin/auth`, () => {
      const src = readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
      expect(src.split(needle).length - 1).toBe(count);
      expect(src.includes('firebase-admin/auth')).toBe(false);
    });
  }
});
