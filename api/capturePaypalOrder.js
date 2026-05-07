/**
 * Vercel API Route: Capture PayPal Order + trigger booking-processor
 * POST /api/capturePaypalOrder
 */
import { getPaypalAccessToken } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// PayPal token + baseUrl resolution moved to api/_shared/paypal.js
// (shared with cancelBooking.js + createPaypalOrder.js).
// Launch (2026-04-30) 이후 live only — sandbox 분기 제거 (dead code 정리).

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, JSON_CORS); return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED'))); }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { orderID, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, userEmail = '', couponDocId, couponUserId, airport } = body;
    if (!orderID) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('orderID is required', 'MISSING_FIELDS'))); }

    console.log('[capturePaypalOrder] LIVE mode | email:', userEmail);

    // 1. Access Token + baseUrl from shared helper (live only)
    const { accessToken, baseUrl: PAYPAL_BASE_URL } = await getPaypalAccessToken(false);

    // 1.5 Duplicate orderID guard — used_paypal_orders 중복 방지
    {
      const db = initAdminDb('capturePaypalOrder');
      if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
      const existing = await db.collection('used_paypal_orders').doc(orderID).get();
      if (existing.exists) {
        console.warn('[capturePaypalOrder] duplicate orderID blocked:', orderID);
        res.writeHead(409, JSON_CORS);
        return res.end(JSON.stringify(_err('Order already processed', 'DUPLICATE_ORDER')));
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

    // 필드 추출 + 누락 시 명시 로그 (LIVE 응답 누락이 admin 로그 미노출의 첫 번째 원인 후보).
    const captureNode = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const payerEmail = capture.payer?.email_address ?? '';
    const payerName = `${capture.payer?.name?.given_name ?? ''} ${capture.payer?.name?.surname ?? ''}`.trim();
    const amount = captureNode?.amount?.value ?? '';
    const captureID = captureNode?.id ?? '';
    const hasPayer = !!payerEmail;
    const hasCapture = !!captureID;
    const hasAmount = !!amount;
    if (!hasPayer || !hasCapture || !hasAmount) {
      console.error('[capturePaypalOrder] field missing:', { hasPayer, hasCapture, hasAmount, orderID });
    }

    // PayPal capture 응답에서 민감정보 없는 필드만 추려서 Firestore에 보존 (디버깅 + 운영자 매칭용).
    const rawCapturePayload = {
      payer: { email_address: payerEmail },
      amount: captureNode?.amount ?? null,
      captureID,
      status: capture.status ?? '',
      create_time: captureNode?.create_time ?? capture.create_time ?? '',
    };

    // 2.4 bookings/{orderID} 정식 레코드 생성 — cancel/modify/my-bookings API가 조회.
    // captureID는 취소 시 PayPal Refund 호출에 필수.
    try {
      const db = initAdminDb('capturePaypalOrder');
      if (!db) throw new Error('Firestore unavailable');
      await db.collection('bookings').doc(orderID).set({
        bookingRef: orderID,
        orderID,
        captureID,
        userEmail: (userEmail || '').toLowerCase(),
        payerEmail,
        payerName,
        status: 'CONFIRMED',
        productType: product || '',
        tourDate: tourDate || '',
        pickupLocation: pickupLocation || '',
        dropoffLocation: dropoffLocation || '',
        paxCount: paxCount || 0,
        vehicleType: vehicleType || '',
        customerPhone: customerPhone || '',
        couponApplied: !!couponApplied,
        memo: memo || '',
        airport: airport || null,
        amountUSD: amount,
        currency: 'USD',
        rawCapturePayload,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (bookingErr) {
      // 예약 레코드 저장 실패해도 결제는 통과 (booking-processor가 sheets에 기록)
      console.error('[capturePaypalOrder] bookings doc write failed:', bookingErr.message);
    }

    // 2.5 쿠폰 소진 처리 (Bug #2 fix — 결제 성공 후 isUsed 마킹)
    if (couponDocId && couponUserId) {
      try {
        const db = initAdminDb('capturePaypalOrder');
        if (!db) throw new Error('Firestore unavailable');
        await db.collection('users').doc(couponUserId)
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
      body: JSON.stringify({ orderID, payerEmail, payerName, amount, product, tourDate, pickupLocation, dropoffLocation, paxCount, vehicleType, customerPhone, couponApplied, memo, itineraryData, airport }),
    }).catch(err => console.error('[capturePaypalOrder] booking-processor call failed:', err.message));

    // 4. Respond immediately
    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ orderID, payerEmail, payerName, amount, currency: 'USD', message: '예약이 확정되었습니다. 확인 이메일을 발송 중입니다.' })));
  } catch (err) {
    console.error('[capturePaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}