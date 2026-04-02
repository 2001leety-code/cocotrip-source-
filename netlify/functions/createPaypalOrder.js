import { Buffer } from 'buffer';

// sandbox: https://api-m.sandbox.paypal.com
// live:    https://api-m.paypal.com
const PAYPAL_BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const PRODUCT_PRICES = {
  // ?Ä?Ä ?ºÏùº ?ÑÏÑ∏ ?¨Ïñ¥ (CharterBanner + CharterPage daily) ?Ä?Ä
  charter_seoul_city:            291200,
  charter_seoul_suburb:          343200,
  charter_dmz:                   343200,
  charter_gangwon:               436800,
  charter_ski:                   416000,
  charter_gyeongju:              468000,
  charter_busan:                 572000,
  // ?Ä?Ä Í≥µÌï≠ ?ΩÏóÖ/?åÎî© (CharterPage ??airport_{destination}) ?Ä?Ä
  airport_seoul_central:         124800,
  airport_seoul_gangnam:         145600,
  airport_suwon_yongin:          150000,
  airport_gapyeong_nami:         208000,
  airport_chuncheon:             220000,
  airport_pyeongchang_yongpyong: 332800,
  airport_gangneung_sokcho:      364000,
  airport_busan:                 600000,
  kpop_shuttle_oneway:           35000,
  kpop_shuttle_roundtrip:        65000,
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function getPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret   = process.env.PAYPAL_CLIENT_SECRET;
  const mode     = process.env.PAYPAL_MODE || 'sandbox';
  const baseUrl  = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

  console.log('[PayPal] Mode:', mode);
  console.log('[PayPal] ClientID ????', clientId?.substring(0,8));
  console.log('[PayPal] secret length:',   secret?.length);
  console.log('[PayPal] baseUrl:',         baseUrl);

  const credentials = Buffer.from(clientId + ':' + secret).toString('base64');
  console.log('[PayPal] credentials length:', credentials.length);

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Accept':          'application/json',
      'Accept-Language': 'en_US',
      'Authorization':   'Basic ' + credentials,
      'Content-Type':    'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await res.text();
  console.log('[PayPal] token status:', res.status);
  console.log('[PayPal] token body:',   text);

  if (!res.ok) throw new Error(`401: ${text}`);
  return JSON.parse(text).access_token;
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

  const { productType, passengers = 1, dateStart = '', dateEnd = '', language = 'en', promoCode } = body;
  console.log('[createPaypalOrder] ?îÏ≤≠ ?òÏã†:', { productType, passengers, dateStart, dateEnd, language, promoCode });

  if (!productType) return respond(400, { error: 'productType is required' });

  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  console.log('[createPaypalOrder] ?òÍ≤ΩÎ≥Ä???ïÏù∏:', {
    PAYPAL_CLIENT_ID:     clientId     ? '?§Ï†ï??(' + clientId.slice(0, 8) + '...)' : '??ÎØ∏ÏÑ§??,
    PAYPAL_CLIENT_SECRET: clientSecret ? '?§Ï†ï?? : '??ÎØ∏ÏÑ§??,
  });

  // ?Ä?Ä 1. KRW Í∏àÏï° Í≥ÑÏÇ∞ ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  let krwAmount;
  if (productType === 'kpop_shuttle_oneway' || productType === 'kpop_shuttle_roundtrip' || productType === 'kpop_shuttle') {
    const unitPrice = PRODUCT_PRICES[productType] || 35000;
    krwAmount = (passengers || 1) * unitPrice;
  } else {
    krwAmount = PRODUCT_PRICES[productType];
    if (!krwAmount) return respond(400, { error: `Unknown productType: ${productType}` });
  }

  // Apply promo
  if (promoCode === 'EARLY50') {
    krwAmount = Math.round(krwAmount * 0.8);
    console.log('[createPaypalOrder] ?ÑÎ°úÎ™?Ïπ¥Ïö¥???†Ïù∏ ?ÅÏö©:', krwAmount);
  } else {
    console.log('[createPaypalOrder] 1. KRW Í∏àÏï° Í≥ÑÏÇ∞:', krwAmount);
  }

  // ?Ä?Ä 2. ?§ÏãúÍ∞??òÏú® Ï°∞Ìöå ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  console.log('[createPaypalOrder] 2. ?òÏú® Ï°∞Ìöå ?úÏûë');
  let usdToKrw = 1350;
  try {
    const rateRes  = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
    const rateData = await rateRes.json();
    usdToKrw = rateData.rates.KRW;
    console.log('[createPaypalOrder] ?òÏú® Ï°∞Ìöå ?±Í≥µ:', usdToKrw);
  } catch (rateErr) {
    console.warn('[createPaypalOrder] ?òÏú® Ï°∞Ìöå ?§Ìå® (fallback 1350):', rateErr.message);
  }
  const usdAmount = (krwAmount / usdToKrw).toFixed(2);
  console.log('[createPaypalOrder] USD Î≥Ä??', usdAmount);

  // ?Ä?Ä 3. PayPal Access Token ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  console.log('[createPaypalOrder] 3. PayPal ?†ÌÅ∞ Î∞úÍ∏â ?úÏûë');
  let accessToken;
  try {
    accessToken = await getPayPalToken();
    console.log('[createPaypalOrder] PayPal ?†ÌÅ∞ Î∞úÍ∏â ?±Í≥µ');
  } catch (err) {
    console.error('[createPaypalOrder] PayPal ?†ÌÅ∞ Î∞úÍ∏â ?§Ìå®:', err.message);
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ?Ä?Ä 4. PayPal Order ?ùÏÑ± ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  console.log('[createPaypalOrder] 4. Ï£ºÎ¨∏ ?ùÏÑ± ?úÏûë:', { usdAmount });
  let order;
  try {
    const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
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
          description: `CocoTrip | ${productType} | ${dateStart}~${dateEnd} | ${passengers}Î™?,
        }],
      }),
    });
    order = await orderRes.json();
    console.log('[createPaypalOrder] Ï£ºÎ¨∏ ?ëÎãµ:', JSON.stringify({ id: order.id, status: order.status, message: order.message }));
    if (!order.id) throw new Error(order.message ?? 'Order creation failed');
  } catch (err) {
    console.error('[createPaypalOrder] Ï£ºÎ¨∏ ?ùÏÑ± ?§Ìå®:', err.message);
    return respond(500, { error: `PayPal order creation failed: ${err.message}` });
  }

  // ?Ä?Ä 5. Î∞òÌôò ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  console.log('[createPaypalOrder] Í≤∞Í≥º:', JSON.stringify({ orderID: order.id, usdAmount, krwAmount }));
  return respond(200, {
    orderID:     order.id,
    usdAmount,
    krwAmount,
    currentRate: Math.round(usdToKrw),
    displayKRW:  krwAmount.toLocaleString('ko-KR') + '??,
    displayUSD:  '$' + usdAmount + ' USD',
  });
};
