import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPaypalAccessToken, getPaypalCredentials, resolveIsSandbox } from '../../api/_shared/paypal.js';

describe('Preview PayPal runtime isolation', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    vi.stubEnv('PAYPAL_CLIENT_ID', 'live-id-fixture');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'live-secret-fixture');
    vi.stubEnv('PAYPAL_SANDBOX_CLIENT_ID', 'sandbox-id-fixture');
    vi.stubEnv('PAYPAL_SANDBOX_SECRET', 'sandbox-secret-fixture');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(['', 'live', 'production', 'sandbx'])('blocks misconfigured Preview mode %j before network', async (mode) => {
    vi.stubEnv('PAYPAL_ENV', mode);
    expect(() => resolveIsSandbox()).toThrow('PREVIEW_PAYPAL_SANDBOX_REQUIRED');
    expect(() => getPaypalCredentials(true)).toThrow('PREVIEW_PAYPAL_SANDBOX_REQUIRED');
    await expect(getPaypalAccessToken(true)).rejects.toThrow('PREVIEW_PAYPAL_SANDBOX_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, undefined, null, 1, 'true'])('blocks direct non-boolean sandbox override %j', async (flag) => {
    expect(() => getPaypalCredentials(flag)).toThrow('PREVIEW_PAYPAL_SANDBOX_REQUIRED');
    await expect(getPaypalAccessToken(flag)).rejects.toThrow('PREVIEW_PAYPAL_SANDBOX_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the sandbox endpoint and sandbox credentials for explicit Preview sandbox', async () => {
    vi.stubEnv('PAYPAL_ENV', ' SANDBOX ');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'sandbox-token-fixture' }) });
    expect(resolveIsSandbox()).toBe(true);
    expect(getPaypalCredentials(true)).toEqual({
      clientId: 'sandbox-id-fixture', secret: 'sandbox-secret-fixture', baseUrl: 'https://api-m.sandbox.paypal.com',
    });
    await expect(getPaypalAccessToken(true)).resolves.toEqual({ accessToken: 'sandbox-token-fixture', baseUrl: 'https://api-m.sandbox.paypal.com' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://api-m.sandbox.paypal.com/v1/oauth2/token', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('sandbox-id-fixture:sandbox-secret-fixture').toString('base64')}` }),
    }));
  });

  it.each(['', 'live', 'sandbox', 'SANDBOX'])('preserves production live resolution for PAYPAL_ENV=%j', (mode) => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PAYPAL_ENV', mode);
    expect(resolveIsSandbox()).toBe(false);
    expect(getPaypalCredentials(false).baseUrl).toBe('https://api-m.paypal.com');
  });

  it('preserves local development live default and explicit sandbox', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('PAYPAL_ENV', '');
    expect(resolveIsSandbox()).toBe(false);
    expect(getPaypalCredentials(false).baseUrl).toBe('https://api-m.paypal.com');
    vi.stubEnv('PAYPAL_ENV', 'sandbox');
    expect(resolveIsSandbox()).toBe(true);
    expect(getPaypalCredentials(true).baseUrl).toBe('https://api-m.sandbox.paypal.com');
  });
});
