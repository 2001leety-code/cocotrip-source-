// Coverage for api/_shared/paypal.js (both functions).
// getPaypalAccessToken uses global fetch, mocked via vi.stubGlobal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('api/_shared/paypal — getPaypalCredentials', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
    delete process.env.PAYPAL_SANDBOX_SECRET;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns live credentials + live baseUrl when isSandbox=false', async () => {
    process.env.PAYPAL_CLIENT_ID = 'live-id';
    process.env.PAYPAL_CLIENT_SECRET = 'live-secret';
    const { getPaypalCredentials } = await import('../../api/_shared/paypal.js');

    const creds = getPaypalCredentials(false);
    expect(creds.clientId).toBe('live-id');
    expect(creds.secret).toBe('live-secret');
    expect(creds.baseUrl).toBe('https://api-m.paypal.com');
  });

  it('returns sandbox credentials + sandbox baseUrl when isSandbox=true', async () => {
    process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sandbox-id';
    process.env.PAYPAL_SANDBOX_SECRET = 'sandbox-secret';
    const { getPaypalCredentials } = await import('../../api/_shared/paypal.js');

    const creds = getPaypalCredentials(true);
    expect(creds.clientId).toBe('sandbox-id');
    expect(creds.secret).toBe('sandbox-secret');
    expect(creds.baseUrl).toBe('https://api-m.sandbox.paypal.com');
  });

  it('trims whitespace around env values', async () => {
    process.env.PAYPAL_CLIENT_ID = '  padded-id  ';
    process.env.PAYPAL_CLIENT_SECRET = '\n\tnoisy-secret\n';
    const { getPaypalCredentials } = await import('../../api/_shared/paypal.js');

    const creds = getPaypalCredentials(false);
    expect(creds.clientId).toBe('padded-id');
    expect(creds.secret).toBe('noisy-secret');
  });

  it('returns empty strings when env vars missing (caller validates)', async () => {
    const { getPaypalCredentials } = await import('../../api/_shared/paypal.js');
    const creds = getPaypalCredentials(false);
    expect(creds.clientId).toBe('');
    expect(creds.secret).toBe('');
    expect(creds.baseUrl).toBe('https://api-m.paypal.com');
  });
});

describe('api/_shared/paypal — getPaypalAccessToken', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
  });

  it('throws when credentials missing (no fetch attempted)', async () => {
    const { getPaypalAccessToken } = await import('../../api/_shared/paypal.js');
    await expect(getPaypalAccessToken(false)).rejects.toThrow(/credentials not configured/i);
  });

  it('returns {accessToken, baseUrl} on 200 response', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok-abc' }),
    })));

    const { getPaypalAccessToken } = await import('../../api/_shared/paypal.js');
    const result = await getPaypalAccessToken(false);
    expect(result.accessToken).toBe('tok-abc');
    expect(result.baseUrl).toBe('https://api-m.paypal.com');
  });

  it('uses sandbox baseUrl when isSandbox=true', async () => {
    process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sid';
    process.env.PAYPAL_SANDBOX_SECRET = 'ssecret';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'sandbox-tok' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { getPaypalAccessToken } = await import('../../api/_shared/paypal.js');
    const result = await getPaypalAccessToken(true);
    expect(result.baseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-2xx response with status + body', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid_client',
      json: async () => ({}),
    })));

    const { getPaypalAccessToken } = await import('../../api/_shared/paypal.js');
    await expect(getPaypalAccessToken(false)).rejects.toThrow(/PayPal auth 401.*invalid_client/);
  });

  it('throws when response body has no access_token', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ /* no access_token */ }),
    })));

    const { getPaypalAccessToken } = await import('../../api/_shared/paypal.js');
    await expect(getPaypalAccessToken(false)).rejects.toThrow(/Failed to get PayPal access token/);
  });
});
