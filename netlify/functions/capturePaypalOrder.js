/**
 * CocoTripKR ??PayPal ê²°ì œ ìº¡ì²˜ + ?ë™???¸ë¦¬ê±? * POST /.netlify/functions/capturePaypalOrder
 *
 * ?¤í–‰ ?œì„œ:
 *  1. PayPal Access Token ë°œê¸‰
 *  2. Order Capture (ê²°ì œ ?•ì •)
 *  3. booking-processor ?¸ì¶œ (ë¹„ë™ê¸???ê³ ê° ?€ê¸??†ìŒ)
 *  4. ?±ê³µ ë°˜í™˜
 *
 * CONTEXT: CocoTripKR ê²°ì œ ì²˜ë¦¬ (sandbox ??production ??URL ë³€ê²??„ìš”)
 * ENV: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, URL (Netlify ?ë™ ?¤ì •)
 */

import { Buffer } from 'buffer';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// TODO: ?„ë¡œ?•ì…˜ ë°°í¬ ??sandbox ??live URLë¡?ë³€ê²?// sandbox: https://api-m.sandbox.paypal.com
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

export const handler = async (event) => {
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
    // ?ˆì•½ ?ì„¸ ?•ë³´ (?„ë¡ ?¸ì—???¨ê»˜ ?„ë‹¬)
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

  console.log('[capturePaypalOrder] ?”ì²­ ?˜ì‹ :', { orderID, hasItinerary: !!itineraryData });
  if (!orderID) return respond(400, { error: 'orderID is required' });

  const clientId     = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  console.log('[capturePaypalOrder] ?˜ê²½ë³€???•ì¸:', {
    PAYPAL_CLIENT_ID:     clientId     ? '?¤ì •??(' + clientId.slice(0, 8) + '...)' : '??ë¯¸ì„¤??,
    PAYPAL_CLIENT_SECRET: clientSecret ? '?¤ì •?? : '??ë¯¸ì„¤??,
    PAYPAL_MODE:          process.env.PAYPAL_MODE || 'sandbox',
  });

  // ?€?€ 1. Access Token ë°œê¸‰ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  console.log('[capturePaypalOrder] 1. PayPal ? í° ë°œê¸‰ ?œì‘');
  let accessToken;
  try {
    accessToken = await getPaypalAccessToken();
    console.log('[capturePaypalOrder] PayPal ? í° ë°œê¸‰ ?±ê³µ');
  } catch (err) {
    console.error('[capturePaypalOrder] PayPal ? í° ë°œê¸‰ ?¤íŒ¨:', err.message);
    return respond(500, { error: `PayPal auth failed: ${err.message}` });
  }

  // ?€?€ 2. Order Capture ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  console.log('[capturePaypalOrder] 2. Order Capture ?œì‘:', orderID);
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
    console.log('[capturePaypalOrder] Capture ?‘ë‹µ:', JSON.stringify({ status: capture.status, id: capture.id }));
    if (capture.status !== 'COMPLETED') {
      throw new Error(`Capture status: ${capture.status ?? 'unknown'}`);
    }
  } catch (err) {
    console.error('[capturePaypalOrder] Capture ?¤íŒ¨:', err.message);
    return respond(500, { success: false, error: err.message });
  }

  const payerEmail = capture.payer?.email_address ?? '';
  const payerName  = `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
  const amount     = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? '0';

  // ?€?€ 3. booking-processor ë¹„ë™ê¸??¸ì¶œ (ê³ ê° ?‘ë‹µ ë¸”ë¡œ???†ìŒ) ?€?€?€?€?€?€?€?€?€
  // waitUntil ?€??fetchë¡?self-invoke (Netlify Functions background ë¯¸ì‚¬????
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://cocotripkr.com';
  const processorPayload = {
    orderID,
    payerEmail,
    payerName,
    amount,
    // ?ˆì•½ ?ì„¸
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

  // ë¹„ë™ê¸??¤í–‰ (ê²°ê³¼ë¥?ê¸°ë‹¤ë¦¬ì? ?ŠìŒ ??ê³ ê°?€ ì¦‰ì‹œ ?±ê³µ ?‘ë‹µ ë°›ìŒ)
  fetch(`${siteUrl}/.netlify/functions/booking-processor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(processorPayload),
  }).then((res) => {
    console.log('[capturePaypalOrder] booking-processor ?‘ë‹µ:', res.status);
  }).catch((err) => {
    console.error('[capturePaypalOrder] booking-processor ?¸ì¶œ ?¤íŒ¨:', err.message);
  });

  // ?€?€ 4. ê³ ê°?ê²Œ ì¦‰ì‹œ ?±ê³µ ë°˜í™˜ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  console.log('[capturePaypalOrder] 4. ?±ê³µ ë°˜í™˜ (?ë™?”ëŠ” ë°±ê·¸?¼ìš´???¤í–‰ ì¤?');
  return respond(200, {
    success:    true,
    orderID,
    payerEmail,
    payerName,
    amount,
    currency:   'USD',
    message:    '?ˆì•½???•ì •?˜ì—ˆ?µë‹ˆ?? ?•ì¸ ?´ë©”?¼ì„ ë°œì†¡ ì¤‘ì…?ˆë‹¤.',
  });
};
