import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { createServer } from 'vite';
import { devApiProxyBypass } from '../../scripts/lib/dev-api-proxy-bypass.mjs';

describe('development coupon recovery proxy block', () => {
  it.each([
    '/api/admin-coupon-fix', '/api/admin-coupon-fix?uid=fixture', '/api/admin-coupon-fix/',
    '/api/admin-issue-onboarding-coupons', '/api/admin-issue-onboarding-coupons?dryRun=true',
    '/api/admin-issue-onboarding-coupons/extra', '/api/%61dmin-coupon-fix', '/api/%2561dmin-coupon-fix',
    '/api//admin-coupon-fix', '/api/other/../admin-coupon-fix', '/api/ADMIN-COUPON-FIX',
    '/api/admin-coupon-fix%3Fuid=fixture', '/api/%invalid',
  ])('blocks %s locally', url => {
    expect(devApiProxyBypass({ url })).toBe(false);
  });
  it.each(['/api/_shared/test.js', '/api/_shared/test.js?t=123'])('preserves local module bypass for %s', url => {
    expect(devApiProxyBypass({ url })).toBe(url);
  });
  it.each(['/api/other', '/api/admin-coupon-fix-other', '/api/onboarding-coupons', ''])('does not alter unrelated path %s', url => {
    expect(devApiProxyBypass({ url })).toBeUndefined();
  });
  it('is wired into the actual Vite development proxy', () => {
    const source = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(source).toContain('import { devApiProxyBypass } from "./scripts/lib/dev-api-proxy-bypass.mjs"');
    expect(source).toContain('bypass: devApiProxyBypass');
  });
  it('the real Vite middleware returns 404 without opening a connection', async () => {
    const server = await createServer({ configFile: false, envDir: false, appType: 'custom',
      cacheDir: process.env.TEMP + '/cocotrip-proxy-test-cache',
      server: { middlewareMode: true, hmr: false, watch: null, proxy: {
        '/api': { target: 'https://never-contact.example.invalid', bypass: devApiProxyBypass },
      } }, optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      for (const url of ['/api/admin-coupon-fix', '/api/admin-issue-onboarding-coupons?dryRun=true']) {
        const req = Object.assign(new PassThrough(), { url, method: 'POST', headers: {} });
        const headers = new Map();
        const result = await new Promise<number>((resolve, reject) => {
          const res = { statusCode: 200, setHeader: (key: string, value: unknown) => headers.set(key, value),
            getHeader: (key: string) => headers.get(key), end: () => resolve(res.statusCode) };
          // No HTTP listener/request: invoke Connect's middleware directly with stream fixtures.
          server.middlewares(req as never, res as never, (err?: unknown) => reject(err || new Error('Proxy was not blocked')));
        });
        expect(result).toBe(404);
      }
    } finally { await server.close(); }
  });
});
