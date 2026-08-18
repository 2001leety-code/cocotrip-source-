import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import metaOAuthCallback from '../../api/meta-oauth-callback.js';
import threadsOAuthCallback from '../../api/threads-oauth-callback.js';
import tiktokOAuthCallback from '../../api/tiktok-oauth-callback.js';
import {
  SOCIAL_OAUTH_LOCAL_CALLBACKS,
  validateOAuthCallbackQuery,
} from '../../api/_shared/social-oauth-callback.js';

function makeResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    body: undefined as string | undefined,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(body?: string) {
      this.body = body;
    },
    header(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

const handlers = [
  ['Meta', metaOAuthCallback, 'code', 'http://127.0.0.1:8765/oauth/meta/callback'],
  ['Threads', threadsOAuthCallback, 'code', 'http://127.0.0.1:8765/oauth/threads/callback'],
  ['TikTok', tiktokOAuthCallback, 'auth_code', 'http://127.0.0.1:8765/oauth/tiktok/callback'],
] as const;

describe('social OAuth callback validation', () => {
  it('uses fixed provider-specific loopback destinations', () => {
    expect(SOCIAL_OAUTH_LOCAL_CALLBACKS).toEqual({
      meta: 'http://127.0.0.1:8765/oauth/meta/callback',
      threads: 'http://127.0.0.1:8765/oauth/threads/callback',
      tiktok: 'http://127.0.0.1:8765/oauth/tiktok/callback',
    });

    const result = validateOAuthCallbackQuery('meta', {
      code: 'provider-code',
      state: 'csrf-state',
      next: 'https://evil.example/steal',
      redirect_uri: 'https://evil.example/steal',
      host: 'evil.example',
      port: '9999',
      scopes: 'user.info.basic',
    });

    expect(result.kind).toBe('redirect');
    if (result.kind !== 'redirect') throw new Error('expected redirect');

    const location = new URL(result.location);
    expect(location.origin).toBe('http://127.0.0.1:8765');
    expect(location.pathname).toBe('/oauth/meta/callback');
    expect([...location.searchParams.keys()]).toEqual(['code', 'state']);
    expect(location.searchParams.get('code')).toBe('provider-code');
    expect(location.searchParams.get('state')).toBe('csrf-state');
  });

  it('accepts the TikTok Accounts auth_code contract and rejects code', () => {
    const result = validateOAuthCallbackQuery('tiktok', {
      auth_code: 'business-accounts-code',
      state: 'csrf-state',
    });

    expect(result.kind).toBe('redirect');
    if (result.kind !== 'redirect') throw new Error('expected redirect');

    const location = new URL(result.location);
    expect(location.pathname).toBe('/oauth/tiktok/callback');
    expect([...location.searchParams.keys()]).toEqual(['auth_code', 'state']);
    expect(location.searchParams.get('auth_code')).toBe('business-accounts-code');
    expect(location.searchParams.has('code')).toBe(false);

    expect(validateOAuthCallbackQuery('tiktok', {
      auth_code: 'business-accounts-code',
      code: 'wrong-product-code',
      state: 'csrf-state',
    })).toEqual({ kind: 'invalid' });

    expect(validateOAuthCallbackQuery('meta', {
      auth_code: 'wrong-product-code',
      state: 'csrf-state',
    })).toEqual({ kind: 'invalid' });

    expect(validateOAuthCallbackQuery('threads', {
      auth_code: 'wrong-product-code',
      state: 'csrf-state',
    })).toEqual({ kind: 'invalid' });

    expect(validateOAuthCallbackQuery('tiktok', {
      error: 'undocumented-error',
      state: 'csrf-state',
    })).toEqual({ kind: 'invalid' });

    expect(validateOAuthCallbackQuery('tiktok', {
      auth_code: 'business-accounts-code',
      error: 'ambiguous-error',
      state: 'csrf-state',
    })).toEqual({ kind: 'invalid' });
  });

  it('accepts the code field TikTok actually returns', () => {
    // 2026-08-17 실사고: TikTok 계정 소유자 인증은 `auth_code`가 아니라 `code`로
    // 돌려주는데 `code`가 금지 목록에 있어 콜백이 400으로 끊겼다. 연결 자체가 불가능했다.
    const result = validateOAuthCallbackQuery('tiktok', {
      code: 'tiktok-v2-code',
      scopes: 'video.publish,video.upload',
      state: 'csrf-state',
    });

    expect(result.kind).toBe('redirect');
    if (result.kind !== 'redirect') throw new Error('expected redirect');
    const location = new URL(result.location);
    expect(location.origin + location.pathname).toBe(
      'http://127.0.0.1:8765/oauth/tiktok/callback',
    );
    expect(location.searchParams.get('code')).toBe('tiktok-v2-code');
    expect(location.searchParams.get('state')).toBe('csrf-state');
    // 사업자가 덧붙이는 안내값은 그대로 흘려보내지 않는다.
    expect(location.searchParams.has('scopes')).toBe(false);
  });

  it('forwards a provider error and state without extra descriptions', () => {
    const result = validateOAuthCallbackQuery('meta', {
      error: 'access_denied',
      state: 'csrf-state',
      error_description: 'sensitive provider detail',
      error_reason: 'user_denied',
    });

    expect(result.kind).toBe('redirect');
    if (result.kind !== 'redirect') throw new Error('expected redirect');
    const location = new URL(result.location);
    expect([...location.searchParams.keys()]).toEqual(['state', 'error']);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.has('error_description')).toBe(false);
  });

  it('returns ready only when no callback values are present', () => {
    expect(validateOAuthCallbackQuery('meta', {})).toEqual({ kind: 'ready' });
    expect(validateOAuthCallbackQuery('meta', { state: 'orphan-state' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('tiktok', { error: 'undocumented-error' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('unknown', {})).toEqual({ kind: 'invalid' });
  });

  it('fails closed for ambiguous, repeated, controlled, or oversized values', () => {
    expect(validateOAuthCallbackQuery('meta', { code: 'a', error: 'denied' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('meta', { code: 'missing-state' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('meta', { error: 'missing_state' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('meta', { code: ['a', 'b'] }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('meta', { code: 'safe\r\nLocation: https://evil.example' }))
      .toEqual({ kind: 'invalid' });
    expect(validateOAuthCallbackQuery('meta', { code: 'x'.repeat(4097) }))
      .toEqual({ kind: 'invalid' });
  });
});

describe.each(handlers)(
  '%s OAuth callback handler',
  (_provider, handler, successField, localCallbackUrl) => {
  it('returns a non-secret 200 readiness response with hardened headers', () => {
    const res = makeResponse();
    handler({ method: 'GET', query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OAuth callback is ready.');
    expect(res.header('cache-control')).toBe('no-store, max-age=0');
    expect(res.header('referrer-policy')).toBe('no-referrer');
    expect(res.header('content-security-policy')).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    expect(res.header('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(res.header('x-content-type-options')).toBe('nosniff');
  });

  it('redirects a valid callback with 302 and never writes the code to the body or logs', () => {
    const secretCode = 'secret-oauth-code';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = makeResponse();

    handler(
      {
        method: 'GET',
        query: {
          [successField]: secretCode,
          state: 'csrf-state',
          next: 'https://evil.example',
          port: '65535',
        },
      },
      res,
    );

    expect(res.statusCode).toBe(302);
    expect(res.header('location')).toBe(
      `${localCallbackUrl}?${successField}=secret-oauth-code&state=csrf-state`,
    );
    expect(res.body || '').not.toContain(secretCode);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
  });

  it('uses generic non-reflective bodies for invalid requests and methods', () => {
    const invalidRes = makeResponse();
    handler({ method: 'GET', query: { code: 'secret', error: 'denied' } }, invalidRes);
    expect(invalidRes.statusCode).toBe(400);
    expect(invalidRes.body).toBe('Invalid OAuth callback.');
    expect(invalidRes.body).not.toContain('secret');

    const methodRes = makeResponse();
    handler({ method: 'POST', query: { code: 'secret' } }, methodRes);
    expect(methodRes.statusCode).toBe(405);
    expect(methodRes.header('allow')).toBe('GET');
    expect(methodRes.body).toBe('Method not allowed.');
  });
  },
);

describe('Vercel OAuth callback routing', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));

  it.each([
    ['/api/meta-oauth-callback/', '/api/meta-oauth-callback'],
    ['/api/threads-oauth-callback/', '/api/threads-oauth-callback'],
    ['/api/tiktok-oauth-callback/', '/api/tiktok-oauth-callback'],
  ])('keeps the exact trailing-slash public route %s', (source, destination) => {
    const rewrite = vercel.rewrites.find((entry: { source: string }) => entry.source === source);
    expect(rewrite).toEqual({ source, destination });
  });

  it('preserves existing SPA, blog image, planstest, and 404 routing', () => {
    expect(vercel.rewrites).toEqual(expect.arrayContaining([
      { source: '/planstest', destination: '/api/planstest' },
      {
        source: '/blog-images/:year/:name',
        destination: '/api/blog-image?year=:year&name=:name',
      },
      { source: '/', destination: '/index.html' },
      { source: '/((?!api/).*)', destination: '/api/not-found' },
    ]));

    const catchAllIndex = vercel.rewrites.findIndex(
      (entry: { source: string }) => entry.source === '/((?!api/).*)',
    );
    const callbackIndexes = vercel.rewrites
      .map((entry: { source: string }, index: number) => (
        entry.source.endsWith('-oauth-callback/') ? index : -1
      ))
      .filter((index: number) => index >= 0);

    expect(callbackIndexes).toHaveLength(3);
    expect(callbackIndexes.every((index: number) => index < catchAllIndex)).toBe(true);
  });
});
