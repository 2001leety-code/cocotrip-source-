// Centralized PayPal credentials + access token fetch.
// Sandbox vs live selected via isSandbox flag (caller decides — usually
// from TEST_ACCOUNTS membership). Throws on missing creds or non-2xx token
// fetch so callers get a consistent error contract.

export function getPaypalCredentials(isSandbox) {
  const clientId = (isSandbox
    ? process.env.PAYPAL_SANDBOX_CLIENT_ID
    : process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (isSandbox
    ? process.env.PAYPAL_SANDBOX_SECRET
    : process.env.PAYPAL_CLIENT_SECRET || '').trim();
  const baseUrl = isSandbox
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
  return { clientId, secret, baseUrl };
}

export async function getPaypalAccessToken(isSandbox) {
  const { clientId, secret, baseUrl } = getPaypalCredentials(isSandbox);
  if (!clientId || !secret) {
    throw new Error('PayPal credentials not configured');
  }
  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PayPal auth ${res.status}${body ? `: ${body}` : ''}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get PayPal access token');
  }
  return { accessToken: data.access_token, baseUrl };
}
