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
import { captureError } from './_shared/sentry.js';
import { evaluateRefundPolicy } from './_refund-policy.js';
import { getPaypalAccessToken } from './_shared/paypal.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { notifyOperator } from './_shared/operator-alerts.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { buildManualPaymentEmail } from './_shared/manual-payment-emails.js';
import { sendEmail } from './_send-email.js';

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

// 2026-05-04: 2-채널 분리. 환불 영수증은 booking 채널 (cocotrip bot), 배차 취소는
// dispatch 채널 (driver bot) — 사용자 정책 ("정보는 driver, 결제내역은 cocotrip").
async function sendRefundTelegram({ bookingRef, productType, paxCount, tourDate, userEmail, refundUSD, refundPercent, reason, airport, pickupLocation, dropoffLocation }) {
  // (1) booking 채널 — 환불 재무 영수증
  const refundMsg =
    `🔴 [예약 취소·환불 처리]\n` +
    `${bookingRef}\n` +
    `상품: ${productType} · ${paxCount}명 · ${tourDate}\n` +
    `고객: ${userEmail}\n` +
    `환불액: $${refundUSD} (${refundPercent}%)\n` +
    `사유: ${reason || '-'}`;
  // (2) dispatch 채널 — 배차에서 빼라는 알림 (운행 정보 포함)
  const route = [pickupLocation, dropoffLocation].filter(Boolean).join(' → ') || '-';
  const dispatchMsg =
    `❌ [배차 취소]\n` +
    `${bookingRef}\n` +
    `상품: ${productType} · ${paxCount}명\n` +
    `날짜: ${tourDate}\n` +
    `경로: ${route}\n` +
    `사유: ${reason || '-'}` +
    airportPlainLine(airport);

  // (3) operator A 채널 — admin 본인 즉시 가시성 (PR-G). booking 봇 분리 운영 중에도 메인 봇으로
  // 환불은 무조건 들어와야 함 (사용자 정책).
  const operatorMsg =
    `💸 환불 처리 — <code>${bookingRef}</code>\n` +
    `${userEmail}\n` +
    `$${refundUSD} (${refundPercent}%)\n` +
    `사유: ${reason || '-'}\n` +
    `→ /admin/refunds 에서 확인`;

  await Promise.allSettled([
    notify('booking',  refundMsg,  { parseMode: undefined }),
    notify('dispatch', dispatchMsg, { parseMode: undefined }),
    notifyOperator('refund', operatorMsg).catch((err) =>
      console.error('[cancelBooking] notifyOperator failed (silent fail 방지):', err.message)
    ),
  ]);
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

    // 2026-05-03: TEST 계정도 실제 결제는 LIVE PayPal로 진행되므로 (createPaypalOrder
    // 변경) refund도 항상 LIVE. sandbox PayPal 환불 호출 케이스 자체가 없음.
    const isSandbox = false;
    void TEST_ACCOUNTS;
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

    // 2026-05-03: AI 플래너 ($9.90)는 디지털 상품 — 결제 즉시 itinerary + PDF
    // 다운로드 가능 (캡쳐 가능). 환불해주면 사업자만 손해. 명시적 거부.
    // 차터/투어/공항픽업은 시간 기반 환불 정책 적용 (evaluateRefundPolicy).
    if ((booking.productType || '').toString().startsWith('ai-planner')) {
      res.writeHead(403, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'AI Plans are digital products delivered immediately and are non-refundable.',
        'NO_REFUND_DIGITAL',
      )));
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

    // 3. PayPal Refund (2026-05-07: Braintree 통합 제거 — PayPal 단일).
    // 잔여 booking 중 provider='braintree' 인 레거시 도큐먼트는 captureID 가
    // Braintree transaction id 형식이라 PayPal /captures/{id}/refund 가 404 가 남.
    // 운영자가 admin-payments UI 에서 manual refund 처리해야 함.
    if (booking.provider === 'braintree') {
      res.writeHead(409, JSON_CORS);
      return res.end(JSON.stringify(_err(
        'Legacy Braintree booking — manual refund required via admin-payments console.',
        'LEGACY_BRAINTREE_BOOKING',
      )));
    }
    let refundData;
    {
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
      refundData = await refundRes.json();
      if (refundData.status !== 'COMPLETED' && refundData.status !== 'PENDING') {
        res.writeHead(502, JSON_CORS);
        return res.end(JSON.stringify(_err(`PayPal refund ${refundData.status}: ${refundData.message || ''}`, 'REFUND_FAILED')));
      }
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
    // 2026-05-04: 어드민 텔레그램에는 친화적 라벨로 표시 (charter_custom_estimate →
    // "Custom Charter (Estimate — pending reconciliation)"). 어드민 검색은 booking 의
    // raw productType 필드로 가능.
    sendRefundTelegram({
      bookingRef: booking.bookingRef || bookingID,
      productType: productDisplayLabel(booking.productType),
      paxCount: booking.paxCount,
      tourDate: booking.tourDate,
      userEmail,
      refundUSD,
      refundPercent: policy.refundPercent,
      reason,
      airport: booking.airport,
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
    });

    // 6. 사용자 환불 안내 이메일 (4-lang, best-effort).
    // Launch P1-4 (2026-05-10): 사용자 자가 취소 시에도 환불 영수증 이메일 발송.
    // 기존 누락: admin-booking-action 의 mark-refunded 만 메일 보내고 사용자 자가
    // 취소 (cancelBooking endpoint) 는 사용자 알림 누락 → 운영자 매뉴얼 발송 부담.
    (async () => {
      try {
        const { subject, html, text } = buildManualPaymentEmail('refunded', {
          bookingRef: booking.bookingRef || bookingID,
          refundedKRW: refundKRW,
          refundReason: reason || null,
          language: booking.language || 'en',
        });
        await sendEmail({ to: userEmail, subject, html, text });
        console.log('[cancelBooking] refund email sent:', userEmail);
      } catch (e) {
        console.error('[cancelBooking] refund email failed (non-fatal):', e.message);
      }
    })();

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
    await captureError(err, {
      route: '/api/cancelBooking',
      method: req.method,
    });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
