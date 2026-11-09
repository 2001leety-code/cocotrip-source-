import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  vercelBypassHeaders,
  resolvePreviewInternalOrigin,
} from '../../api/_shared/internal-base-url.js';

// LIMITATION: caller checks below are source contracts only (text anchors),
// not route integration tests. No route modules are imported; no network.

const VALID_ENV: Record<string, string> = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_TARGET_ENV: 'preview',
  VERCEL_DEPLOYMENT_ID: 'dpl_fake123',
  PREVIEW_INTERNAL_PROJECT_ID: 'prj_fake123',
  VERCEL_PROJECT_ID: 'prj_fake123',
  VERCEL_URL: 'fake-app-abc123-team.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'cocotripkr.com',
};
const FAKE_SECRET = 'fake-bypass-secret-for-tests';
const MANAGED_KEYS = [...Object.keys(VALID_ENV), 'VERCEL_AUTOMATION_BYPASS_SECRET'];
const FIXED = 'PREVIEW_INTERNAL_TARGET_INVALID';

let saved: Record<string, string | undefined> = {};

function applyEnv(values: Record<string, string>): void {
  for (const k of MANAGED_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}

function validOrigin(): string {
  const o: unknown = resolvePreviewInternalOrigin(process.env);
  if (typeof o !== 'string' || o === '') throw new Error('test setup: no resolved origin');
  return o;
}

beforeEach(() => {
  saved = {};
  for (const k of MANAGED_KEYS) saved[k] = process.env[k];
  vi.stubGlobal('fetch', () => {
    throw new Error('network forbidden in tests');
  });
});

afterEach(() => {
  for (const k of MANAGED_KEYS) {
    const v = saved[k];
    if (typeof v === 'string') process.env[k] = v;
    else delete process.env[k];
  }
  vi.unstubAllGlobals();
});

describe('vercelBypassHeaders preview target binding', () => {
  it('returns bypass header for exact resolved origin', () => {
    applyEnv({ ...VALID_ENV, VERCEL_AUTOMATION_BYPASS_SECRET: FAKE_SECRET });
    expect(vercelBypassHeaders(validOrigin())).toEqual({ 'x-vercel-protection-bypass': FAKE_SECRET });
  });

  it('rejects mismatched targets with fixed error', () => {
    applyEnv({ ...VALID_ENV, VERCEL_AUTOMATION_BYPASS_SECRET: FAKE_SECRET });
    const o = validOrigin();
    const bad: unknown[] = [
      undefined,
      '',
      'not a url',
      `${o}/`,
      `${o}?x=1`,
      o.replace('://', '://user:pass@'),
      'https://cocotripkr.com',
      o.toUpperCase(),
    ];
    for (const t of bad) {
      expect(() => vercelBypassHeaders(t as string)).toThrow(FIXED);
    }
  });

  it('rejects when preview env does not resolve', () => {
    applyEnv({ ...VALID_ENV, VERCEL_AUTOMATION_BYPASS_SECRET: FAKE_SECRET });
    const o = validOrigin();
    applyEnv({ VERCEL_ENV: 'preview', VERCEL_AUTOMATION_BYPASS_SECRET: FAKE_SECRET });
    expect(() => vercelBypassHeaders(o)).toThrow(FIXED);
  });

  it('validates even without secret', () => {
    applyEnv({ ...VALID_ENV });
    const o = validOrigin();
    expect(vercelBypassHeaders(o)).toEqual({});
    expect(() => vercelBypassHeaders(`${o}/`)).toThrow(FIXED);
  });

  it('validation precedes secret read (source order)', () => {
    const src = readFileSync(resolve(__dirname, '../../api/_shared/internal-base-url.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('export function vercelBypassHeaders(targetOrigin) {');
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start);
    const check = body.indexOf('resolvePreviewInternalOrigin(process.env)');
    const thr = body.indexOf(`throw new Error('${FIXED}')`);
    const secret = body.indexOf('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(check).toBeGreaterThan(0);
    expect(thr).toBeGreaterThan(check);
    expect(secret).toBeGreaterThan(thr);
  });

  for (const envName of ['production', 'development', undefined]) {
    it(`non-preview (${String(envName)}) keeps old behavior, ignores target`, () => {
      applyEnv(envName ? { VERCEL_ENV: envName } : {});
      expect(vercelBypassHeaders('https://anything.example/?q')).toEqual({});
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = `  ${FAKE_SECRET}  `;
      expect(vercelBypassHeaders(undefined as unknown as string)).toEqual({ 'x-vercel-protection-bypass': FAKE_SECRET });
    });
  }
});

const REDIRECT = "...(process.env.VERCEL_ENV === 'preview' ? { redirect: 'error' } : {}),";
const CALLERS: { file: string; fetchLine: string; indent: string; bypass: string }[] = [
  { file: 'api/_shared/ai-planner-trigger.js', fetchLine: '    const r = await fetch(`${siteUrl}/api/ai-planner-full`, {', indent: '      ', bypass: '...vercelBypassHeaders(siteUrl)' },
  { file: 'api/_shared/booking-processor-trigger.js', fetchLine: '    const r = await fetch(`${siteUrl}/api/booking-processor`, {', indent: '      ', bypass: '...vercelBypassHeaders(siteUrl),' },
  { file: 'api/admin-replay-booking-notifications.js', fetchLine: '    const procRes = await fetch(`${siteUrl}/api/booking-processor`, {', indent: '      ', bypass: '...vercelBypassHeaders(siteUrl),' },
  { file: 'api/admin-scan-suspect-bookings.js', fetchLine: '        const procRes = await fetch(`${siteUrl}/api/booking-processor`, {', indent: '          ', bypass: '...vercelBypassHeaders(siteUrl),' },
  { file: 'api/booking-processor.js', fetchLine: '        const loyaltyRes = await fetch(`${moneyBase}/api/loyalty`, {', indent: '          ', bypass: '...vercelBypassHeaders(moneyBase),' },
];

describe('caller source contracts (not route integration)', () => {
  for (const c of CALLERS) {
    it(`${c.file}: fetch opening followed by preview redirect guard, bound bypass arg`, () => {
      const src = readFileSync(resolve(__dirname, '../..', c.file), 'utf8').replace(/\r\n/g, '\n');
      expect(src).toContain(`${c.fetchLine}\n${c.indent}${REDIRECT}\n`);
      const after = src.slice(src.indexOf(c.fetchLine));
      const nextFetch = after.indexOf('fetch(', c.fetchLine.length);
      const block = nextFetch > 0 ? after.slice(0, nextFetch) : after;
      expect(block).toContain(c.bypass);
    });
  }
});
