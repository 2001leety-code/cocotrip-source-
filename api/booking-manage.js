/**
 * POST /api/booking-manage (2026-10-23, 후속 ②a) — 게스트 예약 관리 페이지의 예약 조회.
 *
 * body: { manageToken } — 확인 메일 링크(`/booking/manage#t=<token>`)의 토큰. URL 쿼리로는 받지 않는다.
 * 인증 실패(형식·서명·만료·예약 없음·회원 예약·버전/환경/배포 불일치)는 전부 같은 401 AUTH_REQUIRED.
 * 응답은 화면에 필요한 필드만 — 전화번호·capture/결제 id 는 내보내지 않는다. 이메일은 마스킹.
 */
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { evaluateRefundPolicy } from './_refund-policy.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { AUTH_REQUIRED_MESSAGE, verifyGuestManageToken, matchGuestBooking } from './_shared/booking-access.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

const _err = (error, code) => ({ ok: false, error, code });

function send(res, status, payload) {
  res.writeHead(status, HEADERS);
  return res.end(JSON.stringify(payload));
}

function denyAuth(res) {
  return send(res, 401, _err(AUTH_REQUIRED_MESSAGE, 'AUTH_REQUIRED'));
}

/** ab…＠example.com — 전각 ＠ 로 메일 클라이언트 자동 링크를 피한다. */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return `${s.slice(0, Math.min(2, at))}…＠${s.slice(at + 1)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, _err('Method not allowed', 'METHOD_NOT_ALLOWED'));

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // 서명·형식·만료 먼저 — 통과 전에는 Firestore 를 읽지 않는다.
    const token = verifyGuestManageToken(body.manageToken);
    if (!token.ok) return denyAuth(res);

    const db = initAdminDb('booking-manage');
    if (!db) throw new Error('Firestore unavailable');
    const snap = await db.collection('bookings').doc(token.payload.oid).get();
    const booking = snap.exists ? (snap.data() || {}) : null;
    if (!matchGuestBooking(booking, token.payload).ok) return denyAuth(res);

    const productType = String(booking.productType || '');
    const policy = evaluateRefundPolicy({ tourDate: booking.tourDate, tourTime: booking.tourTime || undefined, tier: 'Bronze' });
    const canRefund = Boolean(policy.canRefund)
      && booking.status === 'CONFIRMED'
      && !booking.parentOrderID
      && !productType.startsWith('ai-planner')
      && booking.provider !== 'braintree'
      && Boolean(booking.captureID);
    // 날짜 변경(②b) — 24h 전까지, 확정 예약만. cart 자식·AI 플래너는 변경 대상이 아니다.
    const canModify = Boolean(policy.canModify)
      && booking.status === 'CONFIRMED'
      && !booking.parentOrderID
      && !productType.startsWith('ai-planner');

    return send(res, 200, {
      ok: true,
      data: {
        bookingID: token.payload.oid,
        bookingRef: booking.bookingRef || token.payload.oid,
        productType,
        label: productDisplayLabel(productType),
        tourDate: booking.tourDate || '',
        tourTime: booking.tourTime || '',
        paxCount: Number(booking.paxCount) || 0,
        pickupLocation: booking.pickupLocation || '',
        vehicleType: booking.vehicleType || '',
        amountUSD: booking.amountUSD || '',
        amountKRW: Number(booking.amountKRW) || 0,
        currency: booking.currency || 'USD',
        status: booking.status || '',
        canRefund,
        canModify,
        refundPercent: canRefund ? policy.refundPercent : 0,
        hoursUntilTour: policy.hoursUntilTour,
        maskedEmail: maskEmail(booking.payerEmail),
      },
    });
  } catch (err) {
    console.error('[booking-manage] error:', err && err.message);
    await captureError(err, { route: 'booking-manage', method: req.method });
    return send(res, 500, _err('Internal error', 'INTERNAL_ERROR'));
  }
}
