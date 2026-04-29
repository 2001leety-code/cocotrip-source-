/**
 * Vercel API Route: Cancel Booking + PayPal Refund
 * POST /api/cancelBooking
 * body: { bookingID, userEmail, reason?, tier? }
 *
 * 플로우:
 *   1. bookings/{bookingID} 조회 + 소유자 검증
 *   2. evaluateRefundPolicy() 로 환불율 결정
 *   3. PayPal /v2/payments/captures/{captureID}/refund 호출
 *   4. bookings doc 업데이트 (status=CANCELED, refundID, refundedAmount, canceledReason)
 *   5. Google Sheets 상태 업데이트 (best-effort)
 *   6. Telegram 알림 (태연님)
 */
import { evaluateRefundPolicy } from './_refund-policy.js';
import { getPaypalAccessToken } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
const TEST_ACCOUNTS = [];

function getDb() {
  const db = initAdminDb('cancelBooking');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

// PayPal token + baseUrl resolution moved to api/_shared/paypal.js
// (shared with capturePaypalOrder.js + createPaypalOrder.js).

function airportPlainLine(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const lugTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const parts = [];
  if (terminal) parts.push(`터미널 ${terminal}`);
  if (flightNumber) parts.push(`편명 ${flightNumber}`);
  if (lugTotal > 0) parts.push(`수하물 ${lugTotal}개(S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`);
  return parts.length ? `\n공항: ${parts.join(' · ')}` : '';
}

async function sendRefundTelegram({ bookingRef, productType, paxCount, tourDate, userEmail, refundUSD, refundPercent, reason, airport }) {
  try {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const msg =
      `🔴 [예약 취소·환불 처리]\n` +
      `${bookingRef}\n` +
      `상품: ${productType} · ${paxCount}명 · ${tourDate}\n` +
      `고객: ${userEmail}\n` +
      `환불액: $${refundUSD} (${refundPercent}%)\n` +
      `사유: ${reason || '-'}` +
      airportPlainLine(airport);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch (err) {
    console.error('[cancelBooking] telegram skipped:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingID, userEmail = '', reason = '', tier = 'Bronze' } = body;
    if (!bookingID || !userEmail) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('bookingID and userEmail required', 'MISSING_FIELDS')));
    }

    const isSandbox = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());
    const db = getDb();

    // 1. 예약 조회 + 소유자 검증
    const ref = db.collection('bookings').doc(bookingID);
    const doc = await ref.get();
    if (!doc.exists) {
      res.writeHead(404, JSON_CORS);
      return res.end(JSON.stringify(_err('Booking not found', 'NOT_FOUND')));
    }
    const booking = doc.data();
    if ((booking.userEmail || '').toLowerCase() !== userEmail.toLowerCase()) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err('Not your booking', 'FORBIDDEN')));
    }
    if (booking.status !== 'CONFIRMED') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(`Cannot cancel: status=${booking.status}`, 'INVALID_STATE')));
    }
    if (!booking.captureID) {
      res.writeHead(500, JSON_CORS);
      return res.end(JSON.stringify(_err('captureID missing — PayPal refund impossible', 'NO_CAPTURE_ID')));
    }

    // 2. 환불 정책 평가
    const policy = evaluateRefundPolicy({ tourDate: booking.tourDate, tier });
    if (!policy.canRefund) {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err('Cancellation window closed — no refund available', 'NO_REFUND')));
    }

    const originalUSD = parseFloat(booking.amountUSD || '0');
    const refundUSD = (originalUSD * policy.refundRatio).toFixed(2);
    const refundKRW = Math.round((booking.amountKRW || 0) * policy.refundRatio);

    // 3. PayPal Refund 호출
    const { accessToken: token, baseUrl } = await getPaypalAccessToken(isSandbox);
    const refundRes = await fetch(`${baseUrl}/v2/payments/captures/${booking.captureID}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(policy.refundRatio < 1.0 ? {
        amount: { value: refundUSD, currency_code: 'USD' },
        note_to_payer: `CocoTrip cancellation: ${policy.refundPercent}% refund`,
      } : {
        note_to_payer: 'CocoTrip cancellation: full refund',
      }),
    });
    const refundData = await refundRes.json();
    if (refundData.status !== 'COMPLETED' && refundData.status !== 'PENDING') {
      res.writeHead(502, JSON_CORS);
      return res.end(JSON.stringify(_err(`PayPal refund ${refundData.status}: ${refundData.message || ''}`, 'REFUND_FAILED')));
    }

    // 4. Firestore 업데이트
    await ref.update({
      status: 'CANCELED',
      canceledAt: FieldValue.serverTimestamp(),
      canceledReason: reason,
      refundID: refundData.id,
      refundedAmount: refundKRW,
      refundedUSD: refundUSD,
      refundPercent: policy.refundPercent,
      refundStatus: refundData.status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 5. Telegram 알림 (best-effort)
    sendRefundTelegram({
      bookingRef: booking.bookingRef || bookingID,
      productType: booking.productType,
      paxCount: booking.paxCount,
      tourDate: booking.tourDate,
      userEmail,
      refundUSD,
      refundPercent: policy.refundPercent,
      reason,
      airport: booking.airport,
    });

    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({
      bookingID,
      status: 'CANCELED',
      refundID: refundData.id,
      refundPercent: policy.refundPercent,
      refundedKRW: refundKRW,
      refundedUSD: refundUSD,
      hoursUntilTour: policy.hoursUntilTour,
    })));
  } catch (err) {
    console.error('[cancelBooking] Error:', err);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
