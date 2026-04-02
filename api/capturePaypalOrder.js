/**
 * CocoTripKR — PayPal 결제 캡처 + 자동화 트리거
 * POST /api/capturePaypalOrder
 *
 * 실행 순서:
 *  1. PayPal Access Token 발급
 *  2. Order Capture (결제 확정)
 *  3. booking-processor 호출 (비동기 — 고객 대기 없음)
 *  4. 성공 반환
 *
 * CONTEXT: CocoTripKR 결제 처리 (sandbox → production 시 URL 변경 필요)
 * ENV: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, URL (Netlify 자동 설정)
 */

import { Buffer } from 'buffer';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// TODO: 프로덕션 배포 시 sandbox → live URL로 변경
// sandbox: https://api-m.sandbox.paypal.com
// live:    https://api-m.paypal.com
const PAYPAL_BASE_URL = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function getPaypalAccessToken() {
  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PayPal credentials not configured');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
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

const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    orderID,
    // 예약 상세 정보 (프론트에서 함께 전달)
    product,
    tourDate,
    pickupLocation,
    dropoffLocation,
    paxCount,
    vehicleType,
    customerPhone,
    couponApplied,
    memo,
    itineraryData,
  } = body;

  console.log('[capturePaypalOrder] 요청 수신:', { orderID, hasItinerary: !!itineraryData });
  if (!orderID) return respond(400, { error: 'orderID is required' });

  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  console.log('[capturePaypalOrder] 환경변수 확인:', {
    PAYPAL_CLIENT_ID:     clientId     ? '설정됨 (' + clientId.slice(0, 8) + '...)' : '❌ 미설정',
    PAYPAL_CLIENT_SECRET: clientSecret ? '설정됨' : '❌ 미설정',
    PAYPAL_MODE:          process.env.PAYPAL_MODE || 'sandbox',
  });

  // ── 1. Access Token 발급 ───────────────────────────────────────────
  console.log('[capturePaypalOrder] 1. PayPal 토큰 발급 시작');
  let accessToken;
  try {
    accessToken = await getPaypalAccessToken();
    console.log('[capturePaypalOrder] PayPal 토큰 발급 성공');
  } catch (err) {
    console.error('[capturePaypalOrder] PayPal 토큰 발급 실패:', err.message);
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ── 2. Order Capture ──────────────────────────────────────────────────
  console.log('[capturePaypalOrder] 2. Order Capture 시작:', orderID);
  let capture;
  try {
    const res = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    capture = await res.json();
    console.log('[capturePaypalOrder] Capture 응답:', JSON.stringify({ status: capture.status, id: capture.id }));
    if (capture.status !== 'COMPLETED') {
      throw new Error(`Capture status: ${capture.status ?? 'unknown'}`);
    }
  } catch (err) {
    console.error('[capturePaypalOrder] Capture 실패:', err.message);
    return respond(500, { success: false, error: err.message });
  }

  const payerEmail = capture.payer?.email_address ?? '';
  const payerName  = `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
  const amount     = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? '0';

  // ── 3. booking-processor 비동기 호출 (고객 응답 블로킹 없음) ─────────
  // waitUntil 대신 fetch로 self-invoke (Netlify Functions background 미사용 시)
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://cocotripkr.com';
  const processorPayload = {
    orderID,
    payerEmail,
    payerName,
    amount,
    // 예약 상세
    product,
    tourDate,
    pickupLocation,
    dropoffLocation,
    paxCount,
    vehicleType,
    customerPhone,
    couponApplied,
    memo,
    itineraryData,
  };

  // 비동기 실행 (결과를 기다리지 않음 — 고객은 즉시 성공 응답 받음)
  fetch(`${siteUrl}/api/booking-processor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(processorPayload),
  }).then((res) => {
    console.log('[capturePaypalOrder] booking-processor 응답:', res.status);
  }).catch((err) => {
    console.error('[capturePaypalOrder] booking-processor 호출 실패:', err.message);
  });

  // ── 4. 고객에게 즉시 성공 반환 ────────────────────────────────────────
  console.log('[capturePaypalOrder] 4. 성공 반환 (자동화는 백그라운드 실행 중)');
  return respond(200, {
    success:    true,
    orderID,
    payerEmail,
    payerName,
    amount,
    currency:   'USD',
    message:    '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.',
  });
};

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  