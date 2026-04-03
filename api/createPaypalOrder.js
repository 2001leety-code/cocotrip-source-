/**
 * Vercel API Route: Create PayPal Order
 * POST /api/createPaypalOrder
 */
import { Buffer } from 'buffer';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRODUCT_PRICES = {
  charter_seoul_city: 291200, charter_seoul_suburb: 343200, charter_dmz: 343200,
  charter_gangwon: 436800, charter_ski: 416000, charter_gyeongju: 468000, charter_busan: 572000,
  airport_seoul_central: 124800, airport_seoul_gangnam: 145600, airport_suwon_yongin: 150000,
  airport_gapyeong_nami: 208000, airport_chuncheon: 220000, airport_pyeongchang_yongpyong: 332800,
  airport_gangneung_sokcho: 364000, airport_busan: 600000,
  kpop_shuttle_oneway: 35000, kpop_shuttle_roundtrip: 65000,
};

async function getPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = process.env.PAYPAL_MODE || 'sandbox';
  const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const credentials = Buffer.from(clientId + ':' + secret).toString('base64');
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`PayPal auth ${res.status}: ${t}`); }
  return (await res.json()).access_token;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Method not allowed' })); }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { productType, passengers = 1, dateStart = '', dateEnd = '', language = 'en', promoCode } = body;
    if (!productType) { res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'productType is required' })); }

    let krwAmount;
    if (productType.startsWith('kpop_shuttle')) {
      krwAmount = (passengers || 1) * (PRODUCT_PRICES[productType] || 35000);
    } else {
      krwAmount = PRODUCT_PRICES[productType];
      if (!krwAmount) { res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `Unknown productType: ${productType}` })); }
    }

    if (promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);

    let usdToKrw = 1350;
    try { const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW'); usdToKrw = (await r.json()).rates.KRW; } catch { /* fallback */ }
    const usdAmount = (krwAmount / usdToKrw).toFixed(2);

    const accessToken = await getPayPalToken();
    const baseUrl = (process.env.PAYPAL_MODE === 'live') ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: usdAmount }, description: `CocoTrip | ${productType} | ${dateStart}~${dateEnd} | ${passengers}명` }],
      }),
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(order.message ?? 'Order creation failed');

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ orderID: order.id, usdAmount, krwAmount, currentRate: Math.round(usdToKrw), displayKRW: krwAmount.toLocaleString('ko-KR') + '원', displayUSD: '$' + usdAmount + ' USD' }));
  } catch (err) {
    console.error('[createPaypalOrder] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}