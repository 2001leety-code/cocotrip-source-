/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { Buffer } from 'buffer';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TEST_ACCOUNTS = ['2001leety@gmail.com'];

async function getPaypalAccessToken(isSandbox = false) {
  const clientId     = (isSandbox ? process.env.PAYPAL_SANDBOX_CLIENT_ID  : process.env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = (isSandbox ? process.env.PAYPAL_SANDBOX_SECRET      : process.env.PAYPAL_CLIENT_SECRET || '').trim();
  const baseUrl      = isSandbox ? 'https://api-m.sandbox.paypal.com'    : 'https://api-m.paypal.com';
  if (!clientId || !clientSecret) throw new Error('PayPal credentials not configured');
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get PayPal access token');
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Method not allowed' })); }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { orderID, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, userEmail = '', couponDocId, couponUserId } = body;
    if (!orderID) { res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'orderID is required' })); }

    const isSandbox = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());
    const PAYPAL_BASE_URL = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    console.log('[capturePaypalOrder] mode:', isSandbox ? 'SANDBOX' : 'LIVE', '| email:', userEmail);

    // 1. Access Token
    const accessToken = await getPaypalAccessToken(isSandbox);

    // 1.5 Duplicate orderID guard — used_paypal_orders 중복 방지
    {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      if (!getApps().length) {
        const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8'));
        initializeApp({ credential: cert(sa) });
      }
      const db = getFirestore();
      const existing = await db.collection('used_paypal_orders').doc(orderID).get();
      if (existing.exists) {
        console.warn('[capturePaypalOrder] duplicate orderID blocked:', orderID);
        res.writeHead(409, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Order already processed' }));
      }
      // 선점 기록 (결제 캡처 전)
      await db.collection('used_paypal_orders').doc(orderID).set({
        createdAt: new Date().toISOString(),
        userEmail,
        product: product || 'unknown',
      });
    }

    // 2. Capture
    const captureRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    const capture = await captureRes.json();
    if (capture.status !== 'COMPLETED') throw new Error(`Capture status: ${capture.status ?? 'unknown'}`);

    const payerEmail = capture.payer?.email_address ?? '';
    const payerName = `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
    const amount = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? '0';

    // 2.5 쿠폰 소진 처리 (Bug #2 fix — 결제 성공 후 isUsed 마킹)
    if (couponDocId && couponUserId) {
      try {
        const { initializeApp, cert, getApps } = await import('firebase-admin/app');
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        if (!getApps().length) {
          const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8'));
          initializeApp({ credential: cert(sa) });
        }
        await getFirestore().collection('users').doc(couponUserId)
          .collection('coupons').doc(couponDocId)
          .update({ isUsed: true, usedAt: FieldValue.serverTimestamp(), usedOrderID: orderID });
        console.log('[capturePaypalOrder] coupon marked used:', couponDocId);
      } catch (couponErr) {
        // 쿠폰 소진 실패해도 결제는 성공 처리 (사용자 경험 우선)
        console.error('[capturePaypalOrder] coupon update failed:', couponErr.message);
      }
    }

    // 3. Fire-and-forget booking-processor
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    fetch(`${siteUrl}/api/booking-processor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID, payerEmail, payerName, amount, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData }),
    }).catch(err => console.error('[capturePaypalOrder] booking-processor call failed:', err.message));

    // 4. Respond immediately
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, orderID, payerEmail, payerName, amount, currency: 'USD', message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.' }));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}