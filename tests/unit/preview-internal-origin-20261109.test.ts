import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolvePreviewInternalOrigin,
  internalApiBase,
  internalMoneyApiBase,
} from '../../api/_shared/internal-base-url.js';

// NOTE: These tests only verify the pure guard logic against synthetic env input.
// They CANNOT prove real Vercel project ownership, that Vercel system env vars are
// not overridden, or that runtime configuration (PREVIEW_INTERNAL_PROJECT_ID) is
// set correctly in the actual deployment. The guard is conditional defense only.

type Env = Record<string, string | undefined>;

const VALID: Readonly<Record<string, string>> = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_TARGET_ENV: 'preview',
  VERCEL_DEPLOYMENT_ID: 'dpl_fake123',
  PREVIEW_INTERNAL_PROJECT_ID: 'prj_fake123',
  VERCEL_PROJECT_ID: 'prj_fake123',
  VERCEL_URL: 'fake-app-abc123-team.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'cocotripkr.com',
};
const FIELDS = Object.keys(VALID);
const WIRED_KEYS = [...FIELDS, 'VERCEL_BRANCH_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET'];
const EXPECTED = 'https://fake-app-abc123-team.vercel.app';

function env(over: Env = {}): Env {
  return { ...VALID, ...over };
}
function without(key: string): Env {
  const e: Env = { ...VALID };
  delete e[key];
  return e;
}

const saved: Env = {};
const realFetch = globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of WIRED_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  fetchSpy = vi.fn(() => {
    throw new Error('fetch must not be called');
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of WIRED_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('resolvePreviewInternalOrigin (pure)', () => {
  it('accepts complete valid metadata', () => {
    expect(resolvePreviewInternalOrigin(env())).toBe(EXPECTED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-object input', () => {
    expect(resolvePreviewInternalOrigin(null as unknown as Env)).toBeNull();
    expect(resolvePreviewInternalOrigin('x' as unknown as Env)).toBeNull();
  });

  it.each(FIELDS)('rejects missing %s', (k) => {
    expect(resolvePreviewInternalOrigin(without(k))).toBeNull();
  });

  it.each(FIELDS)('rejects empty %s', (k) => {
    expect(resolvePreviewInternalOrigin(env({ [k]: '' }))).toBeNull();
  });

  const ws = [' ', '\n', '\t', '\r\n'];
  it.each(FIELDS.flatMap((k) => ws.map((w) => [k, w])))('rejects %s with whitespace %j', (k, w) => {
    const v = VALID[k];
    expect(resolvePreviewInternalOrigin(env({ [k]: v + w }))).toBeNull(); // final LF ($ footgun)
    expect(resolvePreviewInternalOrigin(env({ [k]: w + v }))).toBeNull();
  });

  it.each([
    ['VERCEL', '0'], ['VERCEL', 'true'],
    ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'Preview'],
    ['VERCEL_TARGET_ENV', 'production'], ['VERCEL_TARGET_ENV', 'staging'],
  ])('rejects wrong env %s=%s', (k, v) => {
    expect(resolvePreviewInternalOrigin(env({ [k]: v }))).toBeNull();
  });

  it('rejects mismatched project IDs', () => {
    expect(resolvePreviewInternalOrigin(env({ VERCEL_PROJECT_ID: 'prj_other456' }))).toBeNull();
    expect(resolvePreviewInternalOrigin(env({ PREVIEW_INTERNAL_PROJECT_ID: 'prj_FAKE123' }))).toBeNull();
  });

  it('accepts 64-char IDs and rejects 65-char IDs', () => {
    const p64 = 'prj_' + 'a'.repeat(60);
    expect(resolvePreviewInternalOrigin(env({ PREVIEW_INTERNAL_PROJECT_ID: p64, VERCEL_PROJECT_ID: p64 }))).toBe(EXPECTED);
    expect(resolvePreviewInternalOrigin(env({ VERCEL_DEPLOYMENT_ID: 'dpl_' + 'a'.repeat(60) }))).toBe(EXPECTED);
    const p65 = 'prj_' + 'a'.repeat(61);
    expect(resolvePreviewInternalOrigin(env({ PREVIEW_INTERNAL_PROJECT_ID: p65, VERCEL_PROJECT_ID: p65 }))).toBeNull();
    expect(resolvePreviewInternalOrigin(env({ VERCEL_DEPLOYMENT_ID: 'dpl_' + 'a'.repeat(61) }))).toBeNull();
  });

  it.each(['VERCEL_DEPLOYMENT_ID', 'PREVIEW_INTERNAL_PROJECT_ID', 'VERCEL_PROJECT_ID'])('rejects malformed %s', (k) => {
    const bad = ['prj_', 'dpl_', 'fake123', 'xyz_fake123', 'prj_fa-ke', 'prj_fak\u00e9', 'prj_fa\u0000ke', 'prj_fake\u007f', 'prj_\uff46ake'];
    for (const b of bad) expect(resolvePreviewInternalOrigin(env({ [k]: b }))).toBeNull();
  });

  it('accepts 63-char label and rejects 64-char label', () => {
    expect(resolvePreviewInternalOrigin(env({ VERCEL_URL: 'a'.repeat(63) + '.vercel.app' }))).toBe('https://' + 'a'.repeat(63) + '.vercel.app');
    expect(resolvePreviewInternalOrigin(env({ VERCEL_URL: 'a'.repeat(64) + '.vercel.app' }))).toBeNull();
  });

  it.each([
    'https://fake-app-abc123-team.vercel.app',
    'user:pw@fake-app-abc123-team.vercel.app',
    'fake-app-abc123-team.vercel.app/path',
    'fake-app-abc123-team.vercel.app?q=1',
    'fake-app-abc123-team.vercel.app#h',
    'fake-app-abc123-team.vercel.app:443',
    'fake-app-abc123-team.vercel.app\\evil.com',
    'fake-app-abc123-team.vercel.app.',
    'Fake-App-abc123-team.vercel.app',
    '-fake.vercel.app',
    'fake..vercel.app',
    'fake\u0007.vercel.app',
    'f\u00e4ke.vercel.app',
    'vercel.app',
    '.vercel.app',
    'fake.vercel.app.evil.com',
    'fakevercel.app',
    'fake.vercel.appx',
    'fake.notvercel.app',
    'fake.vercel-app.com',
  ])('rejects VERCEL_URL %j', (u) => {
    expect(resolvePreviewInternalOrigin(env({ VERCEL_URL: u }))).toBeNull();
  });

  it('rejects production metadata equal/parent-of/malformed', () => {
    expect(resolvePreviewInternalOrigin(env({ VERCEL_PROJECT_PRODUCTION_URL: VALID.VERCEL_URL }))).toBeNull();
    expect(resolvePreviewInternalOrigin(env({ VERCEL_PROJECT_PRODUCTION_URL: 'vercel.app' }))).toBeNull();
    for (const p of ['https://cocotripkr.com', 'cocotripkr.com/', 'cocotripkr.com.', 'COCOTRIPKR.com', 'localhost', 'cocotripkr.com:443']) {
      expect(resolvePreviewInternalOrigin(env({ VERCEL_PROJECT_PRODUCTION_URL: p }))).toBeNull();
    }
  });

  it('does not fall back to other aliases', () => {
    expect(resolvePreviewInternalOrigin({ ...without('VERCEL_URL'), VERCEL_BRANCH_URL: 'fake-git-main-team.vercel.app' })).toBeNull();
  });
});

describe('wired helpers', () => {
  function setEnv(e: Env): void {
    for (const k of Object.keys(e)) {
      const v = e[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it('exact preview valid returns generated host', () => {
    setEnv(env());
    expect(internalApiBase()).toBe(EXPECTED);
    expect(internalMoneyApiBase()).toBe(EXPECTED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preview invalid throws fixed error and money returns null', () => {
    setEnv(env({ VERCEL_PROJECT_ID: 'prj_other456', VERCEL_BRANCH_URL: 'fake-git-main-team.vercel.app' }));
    expect(() => internalApiBase()).toThrow('PREVIEW_INTERNAL_ORIGIN_INVALID');
    expect(internalMoneyApiBase()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('production unchanged', () => {
    setEnv({ VERCEL_ENV: 'production', VERCEL_URL: 'whatever.vercel.app' });
    expect(internalApiBase()).toBe('https://cocotripkr.com');
    expect(internalMoneyApiBase()).toBe('https://cocotripkr.com');
  });

  it('development unchanged', () => {
    setEnv({ VERCEL_ENV: 'development', VERCEL_URL: 'localhost:3000' });
    expect(internalApiBase()).toBe('https://localhost:3000');
    expect(internalMoneyApiBase()).toBe('https://localhost:3000');
  });
});
