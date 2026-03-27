import { Buffer } from 'buffer';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const PRODUCT_PRICES = {
  charter_seoul_city:     291200,
  charter_seoul_suburb:   343200,
  charter_dmz:            343200,
  charter_gangwon:        436800,
  charter_ski:            416000,
  charter_gyeongju:       468000,
  charter_busan:          572000,
  airport_seoul_central:  124800,
  airport_seoul_gangnam:  145600,
  airport_gapyeong:       208000,
  airport_pyeongchang:    332800,
  airport_gangneung:      364000,
};

const KPOP_SHUTTLE_PRICE_PER_PERSON = 26000;

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

  const { productType, passengers = 1, dateStart = '', dateEnd = '', language = 'en' } = body;

  if (!productType) return respond(400, { error: 'productType is required' });

  // ── 1. KRW 금액 계산 ─────────────────────────────────────────────
  let krwAmount;
  if (productType === 'kpop_shuttle') {
    krwAmount = (passengers || 1) * KPOP_SHUTTLE_PRICE_PER_PERSON;
  } else {
    krwAmount = PRODUCT_PRICES[productType];
    if (!krwAmount) return respond(400, { error: `Unknown productType: ${productType}` });
  }

  // ── 2. 실시간 환율 조회 ─────────────────────────────────────────
  let usdToKrw = 1350;
  try {
    const rateRes  = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
    const rateData = await rateRes.json();
    usdToKrw = rateData.rates.KRW;
  } catch {
    // fallback: 1350
  }
  const usdAmount = (krwAmount / usdToKrw).toFixed(2);

  // ── 3. PayPal Access Token ───────────────────────────────────────
  let accessToken;
  try {
    accessToken = await getPaypalAccessToken();
  } catch (err) {
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ── 4. PayPal Order 생성 ─────────────────────────────────────────
  let order;
  try {
    const orderRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: usdAmount,
          },
          description: `CocoTrip | ${productType} | ${dateStart}~${dateEnd} | ${passengers}명`,
        }],
      }),
    });
    order = await orderRes.json();
    if (!order.id) throw new Error(order.message ?? 'Order creation failed');
  } catch (err) {
    return respond(500, { error: `PayPal order creation failed: ${err.message}` });
  }

  // ── 5. 반환 ────────────────────────────────────────────────────
  return respond(200, {
    orderID:     order.id,
    usdAmount,
    krwAmount,
    currentRate: Math.round(usdToKrw),
    displayKRW:  krwAmount.toLocaleString('ko-KR') + '원',
    displayUSD:  '$' + usdAmount + ' USD',
  });
};
