/**
 * internal-base-url — Vercel Deployment Protection 401 regression (2026-07-26).
 *
 * Root cause being pinned: server self-calls used `https://${VERCEL_URL}`.
 * VERCEL_URL is the deployment-GENERATED url (<project>-<hash>-<team>.vercel.app)
 * which sits behind Vercel Authentication (SSO) — server-to-server POSTs got
 * 401 on production. Measured live 2026-07-26: POST to the prod generated URL
 * → 401, while https://cocotripkr.com → 200. Every doc ever written to
 * `pending_processor_retries` carried lastFailureReason='http-401' and the
 * retry sweep could never succeed (0 docs with status='done').
 *
 * Contract: on VERCEL_ENV==='production' self-calls MUST go through the
 * public custom domain, never the generated URL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { internalApiBase, vercelBypassHeaders } from '../../api/_shared/internal-base-url.js';
import { buildUnsubscribeUrl } from '../../api/_shared/marketing-optout.js';

const SAVED = { ...process.env };

function resetEnv() {
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

beforeEach(resetEnv);
afterEach(() => {
  process.env = { ...SAVED };
});

describe('internalApiBase', () => {
  it('production ignores VERCEL_URL and returns the public domain (401 regression)', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'cocotrip-source2026-abc123-team.vercel.app';
    expect(internalApiBase()).toBe('https://cocotripkr.com');
  });

  it('preview keeps the deployment URL (bypass header handles the SSO wall)', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'cocotrip-source2026-git-branch-team.vercel.app';
    expect(internalApiBase()).toBe('https://cocotrip-source2026-git-branch-team.vercel.app');
  });

  it('no VERCEL_URL (local dev) falls back to the public domain', () => {
    expect(internalApiBase()).toBe('https://cocotripkr.com');
  });
});

describe('vercelBypassHeaders', () => {
  it('emits x-vercel-protection-bypass only when the secret exists', () => {
    expect(vercelBypassHeaders()).toEqual({});
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = ' s3cret ';
    expect(vercelBypassHeaders()).toEqual({ 'x-vercel-protection-bypass': 's3cret' });
  });
});

describe('buildUnsubscribeUrl base (customer-facing link)', () => {
  it('production embeds the public domain even when VERCEL_URL is set', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'cocotrip-source2026-abc123-team.vercel.app';
    process.env.MARKETING_UNSUBSCRIBE_SECRET = 'test-secret-for-hmac';
    const url = buildUnsubscribeUrl('customer@example.com');
    expect(url.startsWith('https://cocotripkr.com/api/marketing-unsubscribe?')).toBe(true);
    delete process.env.MARKETING_UNSUBSCRIBE_SECRET;
  });
});
