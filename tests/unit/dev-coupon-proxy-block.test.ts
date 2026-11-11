import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createServer } from 'vite';
import { devApiProxyBypass } from '../../scripts/lib/dev-api-proxy-bypass.mjs';

// Positive pure-only selector: --testNamePattern '^local Vite coupon proxy pure policy '
// The middleware group below is deliberately outside this selector.
describe('local Vite coupon proxy pure policy', () => {
  const endpointCases = ['onboarding-coupons', 'admin-promo-config'].flatMap(endpoint => {
    const encodedInitial = `%${endpoint.charCodeAt(0).toString(16)}${endpoint.slice(1)}`;
    return [
      `/api/${endpoint}`, `/api/${endpoint}?fixture=true`, `/api/${endpoint}/`,
      `/api/${endpoint}/?fixture=true`, `/API/${endpoint.toUpperCase()}`,
      `/api//${endpoint}`, `/api/${endpoint}//`, `/api/other/../${endpoint}`,
      `/api/./${endpoint}`, `/api/${endpoint}/extra/..`, `/api\\${endpoint}`,
      `/api/${encodedInitial}`, `/api/${encodedInitial.replace('%', '%25')}`,
      `/api/${encodedInitial.replace('%', '%2525')}`,
      `%2Fapi%2F${endpoint}`, `%252Fapi%252F${endpoint}`, `%25252Fapi%25252F${endpoint}`,
      `/api/${endpoint}%3Ffixture=true`, `/api/${endpoint}%23fixture`,
      `/api/${endpoint}%253Ffixture=true`, `/api/${endpoint}%2523fixture`,
      `/api/${endpoint}%25253Ffixture=true`, `/api/${endpoint}%252523fixture`,
    ];
  });

  describe.each(['GET', 'POST', 'HEAD', 'OPTIONS'])('%s requests', method => {
    // Intentional LOCAL dev/preview contract change: normal onboarding no longer proxies through.
    it.each(endpointCases)('blocks exact coupon endpoint %s locally', url => {
      expect(devApiProxyBypass({ url, method })).toBe(false);
    });
    it.each([
      '/api/admin-coupon-fix', '/api/admin-coupon-fix?uid=fixture', '/api/admin-coupon-fix/',
      '/api/admin-coupon-fix/extra', '/api/admin-issue-onboarding-coupons',
      '/api/admin-issue-onboarding-coupons?dryRun=true', '/api/admin-issue-onboarding-coupons/',
      '/api/admin-issue-onboarding-coupons/extra', '/api/%61dmin-coupon-fix', '/api/%2561dmin-coupon-fix',
      '/api/%252561dmin-coupon-fix', '/api//admin-coupon-fix', '/api/other/../admin-coupon-fix',
      '/api/ADMIN-COUPON-FIX', '/api/admin-coupon-fix%3Fuid=fixture',
      '/api/admin-issue-onboarding-coupons%2Fextra',
      // r1 C6: any non-[A-Za-z0-9-] character after a blocked name is still that endpoint.
      '/api/admin-coupon-fix.js', '/api/admin-issue-onboarding-coupons.json', '/api/onboarding-coupons.',
      '/api/onboarding-coupons;x', '/api/onboarding-coupons.json', '/api/onboarding-coupons_x',
      '/api/onboarding-coupons/extra', '/api/onboarding-coupons//extra', '/API/ONBOARDING-COUPONS/EXTRA',
      '/api/onboarding-coupons%2Fextra', '/api/admin-promo-config.js', '/api/admin-promo-config?target=popup',
    ])('preserves recovery protection for %s', url => {
      expect(devApiProxyBypass({ url, method })).toBe(false);
    });
    it.each([
      '/api/%invalid', '/api/onboarding-coupons%', '/api/promo-config%2',
      '/api/onboarding-coupons%GG', '/api/promo-config%ED%A0%80',
      '/api/onboarding-coupons%25', '/api/%2525256fnboarding-coupons',
      '/api/%25252570romo-config', '/api/other%25252525', '/api/_shared/%invalid.js',
    ])('preserves fail-closed malformed or residual encoding for %s', url => {
      expect(devApiProxyBypass({ url, method })).toBe(false);
    });
    it.each([
      '/api/_shared/test.js', '/api/_shared/test.js?t=123',
      '/api/_shared/test.js?invalid=%', '/api/_shared/nested/test.js',
    ])('preserves raw local module bypass for %s', url => {
      expect(devApiProxyBypass({ url, method })).toBe(url);
    });
    it.each([
      '/api/other', '/api/other?invalid=%', '/api/other#invalid=%',
      '/api/admin-coupon-fix-other', '/api/admin-issue-onboarding-coupons-other',
      '/api/onboarding-coupons-other', '/api/promo-config-other', '/api/admin-promo-config-other',
      // r1 C6: read-only promo-config proxies again (local pages read it on every load).
      '/api/promo-config', '/api/promo-config?fixture=true', '/API/PROMO-CONFIG',
      '/api/promo-config.json', '/api/promo-config/extra', '/api/promo-config//extra',
      '/API/PROMO-CONFIG/EXTRA', '/api/promo-config%2Fextra',
      '/other/api/onboarding-coupons', '/other/api/promo-config', '/other/api/admin-promo-config',
      '/api/%5fshared/test.js', '/API/_shared/test.js', '/api//_shared/test.js',
      '/api/_shared/test.js#fragment', '/api/_shared/test.jsx',
    ])('preserves pass-through for unrelated paths and new endpoint descendants: %s', url => {
      expect(devApiProxyBypass({ url, method })).toBeUndefined();
    });
    it('preserves missing and empty URLs', () => {
      expect(devApiProxyBypass({ method })).toBeUndefined();
      expect(devApiProxyBypass({ url: undefined, method })).toBeUndefined();
      expect(devApiProxyBypass({ url: '', method })).toBeUndefined();
    });
  });
  it('is wired into the actual local Vite dev/preview proxy', () => {
    const source = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(source).toContain('import { devApiProxyBypass } from "./scripts/lib/dev-api-proxy-bypass.mjs"');
    expect(source).toContain('bypass: devApiProxyBypass');
  });
});

describe('local Vite coupon proxy middleware integration', () => {
  it('the real Vite middleware returns 404 without opening a connection', async () => {
    const server = await createServer({ configFile: false, envDir: false, appType: 'custom',
      cacheDir: join(tmpdir(), 'cocotrip-proxy-test-cache'),
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
