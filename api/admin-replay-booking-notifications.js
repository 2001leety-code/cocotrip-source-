/**
 * Vercel API Route: Admin Replay Booking Notifications
 * POST /api/admin-replay-booking-notifications
 * Headers: Authorization: Bearer <Firebase-ID-token>
 * Body:    { bookingId: string }
 *
 * 2026-05-04: braintreeCheckout 의 booking-processor 호출이 ReferenceError (tourDate
 * undefined) 로 죽으면서 Firestore 에는 booking 이 저장됐지만 텔레그램·이메일·Sheets·
 * PDF·Wallet 알림이 누락된 booking 들을 사후 복구하기 위한 admin 엔드포인트.
 *
 * 동작:
 *   1. ADMIN_EMAIL 인증
 *   2. Firestore bookings/{bookingId} 조회
 *   3. booking-processor 에 동일 페이로드 POST → 텔레그램·이메일·Sheets·PDF 일괄 재전송
 *   4. 결과 반환 (steps 별 ok/error)
 *
 * 멱등성 주의: booking-processor 는 Sheets append 를 새 row 로 추가 + 텔레그램 메시지를
 * 그냥 발송. 같은 bookingId 로 두 번 호출하면 중복 알림 발생. 의도적 사용만 권장.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { bookingId } = body;
  if (!bookingId) {
    return json(res, 400, _err('bookingId required in body', 'MISSING_FIELDS'));
  }

  try {
    const db = initAdminDb('admin-replay-booking-notifications');
    if (!db) {
      return json(res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    const ref = db.collection('bookings').doc(bookingId);
    const doc = await ref.get();
    if (!doc.exists) {
      return json(res, 404, _err(`Booking not found: ${bookingId}`, 'NOT_FOUND'));
    }
    const booking = doc.data();

    // booking-processor 가 기대하는 페이로드 형태로 재구성
    // (braintreeCheckout 의 fetch body 와 동일 키)
    const payload = {
      orderID: booking.captureID || bookingId,
      payerEmail: booking.userEmail || '',
      payerName: booking.payerName || (booking.userEmail || '').split('@')[0],
      amount: String(booking.amountUSD || '0'),
      product: productDisplayLabel(booking.productType),
      tourDate: booking.tourDate || '',
      pickupLocation: booking.pickupLocation || '',
      dropoffLocation: booking.dropoffLocation || '',
      paxCount: booking.paxCount || 1,
      vehicleType: booking.vehicleType || '',
      customerPhone: booking.customerPhone || undefined,
      couponApplied: !!booking.couponDocId,
      memo: booking.memo || '',
      itineraryData: booking.itineraryData || null,
      airport: booking.airport || null,
      userEmail: booking.userEmail || '',
      bookingRef: booking.bookingRef || undefined,
    };

    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    const procRes = await fetch(`${siteUrl}/api/booking-processor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const procJson = await procRes.json().catch(() => null);

    return json(res, 200, _ok({
      bookingId,
      bookingRef: booking.bookingRef,
      product: payload.product,
      amountUSD: payload.amount,
      replayed: procRes.ok,
      processorStatus: procRes.status,
      processorResult: procJson,
    }));
  } catch (err) {
    console.error('[admin-replay-booking-notifications]', err);
    await captureError(err, { route: '/api/admin-replay-booking-notifications', method: req.method });
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
