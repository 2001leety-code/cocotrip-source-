import { Buffer } from 'buffer';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function getPaypalAccessToken() {
  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PayPal credentials not configured');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get PayPal access token');
  return data.access_token;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { orderID } = body;
  if (!orderID) return respond(400, { error: 'orderID is required' });

  // ── 1. Access Token 발급 ─────────────────────────────────────────
  let accessToken;
  try {
    accessToken = await getPaypalAccessToken();
  } catch (err) {
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ── 2. Order Capture ─────────────────────────────────────────────
  let capture;
  try {
    const res = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderID}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    capture = await res.json();
    if (capture.status !== 'COMPLETED') {
      throw new Error(`Capture status: ${capture.status ?? 'unknown'}`);
    }
  } catch (err) {
    return respond(500, { success: false, error: err.message });
  }

  // ── 3. 성공 반환 ─────────────────────────────────────────────────
  return respond(200, {
    success:    true,
    orderID,
    payerEmail: capture.payer?.email_address ?? '',
    payerName:  capture.payer?.name?.given_name ?? '',
    amount:     capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? '0',
    currency:   'USD',
  });
};
