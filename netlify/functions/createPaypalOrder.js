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
  // ── 일일 전세 투어 (CharterBanner + CharterPage daily) ──
  charter_seoul_city:            291200,
  charter_seoul_suburb:          343200,
  charter_dmz:                   343200,
  charter_gangwon:               436800,
  charter_ski:                   416000,
  charter_gyeongju:              468000,
  charter_busan:                 572000,
  // ── 공항 픽업/샌딩 (CharterPage → airport_{destination}) ──
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
  console.log('[PayPal] ClientID 앞8자:', clientId?.substring(0,8));
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
  console.log('[createPaypalOrder] 요청 수신:', { productType, passengers, dateStart, dateEnd, language, promoCode });

  if (!productType) return respond(400, { error: 'productType is required' });

  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  console.log('[createPaypalOrder] 환경변수 확인:', {
    PAYPAL_CLIENT_ID:     clientId     ? '설정됨 (' + clientId.slice(0, 8) + '...)' : '❌ 미설정',
    PAYPAL_CLIENT_SECRET: clientSecret ? '설정됨' : '❌ 미설정',
  });

  // ── 1. KRW 금액 계산 ─────────────────────────────────────────────
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
    console.log('[createPaypalOrder] 프로모 카운터 할인 적용:', krwAmount);
  } else {
    console.log('[createPaypalOrder] 1. KRW 금액 계산:', krwAmount);
  }

  // ── 2. 실시간 환율 조회 ─────────────────────────────────────────
  console.log('[createPaypalOrder] 2. 환율 조회 시작');
  let usdToKrw = 1350;
  try {
    const rateRes  = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
    const rateData = await rateRes.json();
    usdToKrw = rateData.rates.KRW;
    console.log('[createPaypalOrder] 환율 조회 성공:', usdToKrw);
  } catch (rateErr) {
    console.warn('[createPaypalOrder] 환율 조회 실패 (fallback 1350):', rateErr.message);
  }
  const usdAmount = (krwAmount / usdToKrw).toFixed(2);
  console.log('[createPaypalOrder] USD 변환:', usdAmount);

  // ── 3. PayPal Access Token ───────────────────────────────────────
  console.log('[createPaypalOrder] 3. PayPal 토큰 발급 시작');
  let accessToken;
  try {
    accessToken = await getPayPalToken();
    console.log('[createPaypalOrder] PayPal 토큰 발급 성공');
  } catch (err) {
    console.error('[createPaypalOrder] PayPal 토큰 발급 실패:', err.message);
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ── 4. PayPal Order 생성 ─────────────────────────────────────────
  console.log('[createPaypalOrder] 4. 주문 생성 시작:', { usdAmount });
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
          description: `CocoTrip | ${productType} | ${dateStart}~${dateEnd} | ${passengers}명`,
        }],
      }),
    });
    order = await orderRes.json();
    console.log('[createPaypalOrder] 주문 응답:', JSON.stringify({ id: order.id, status: order.status, message: order.message }));
    if (!order.id) throw new Error(order.message ?? 'Order creation failed');
  } catch (err) {
    console.error('[createPaypalOrder] 주문 생성 실패:', err.message);
    return respond(500, { error: `PayPal order creation failed: ${err.message}` });
  }

  // ── 5. 반환 ────────────────────────────────────────────
  console.log('[createPaypalOrder] 결과:', JSON.stringify({ orderID: order.id, usdAmount, krwAmount }));
  return respond(200, {
    orderID:     order.id,
    usdAmount,
    krwAmount,
    currentRate: Math.round(usdToKrw),
    displayKRW:  krwAmount.toLocaleString('ko-KR') + '원',
    displayUSD:  '$' + usdAmount + ' USD',
  });
};
