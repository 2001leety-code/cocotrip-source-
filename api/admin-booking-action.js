/**
 * POST /api/admin-booking-action
 *
 * 운영자가 PayPal 거래내역 확인 후 admin UI 에서 클릭하는 동기화 endpoint.
 *
 * Actions:
 *   1. 'mark-paid'        — pending_bookings 의 결제 신고 → 통장/PayPal 입금 확인됨
 *                            → status='CONFIRMED' + booking 정식 doc 생성
 *                            + AI 플래너 trigger / 영수증 메일 (booking-processor 호출)
 *                            + 텔레그램 booking 채널 #2 "✅ 매칭 완료" 알림
 *
 *   2. 'mark-refunded'    — PayPal 에서 운영자 수동 환불 후 admin 클릭 → bookings 의
 *                            기존 doc 에 status='REFUNDED' + refundedKRW + reason
 *                            + 사용자에게 환불 안내 이메일
 *                            + 텔레그램 booking #3 "💸 환불 완료"
 *
 *   3. 'mark-canceled'    — 사용자 요청으로 결제 전 취소 / 노쇼
 *                            → status='CANCELED' + reason
 *                            + 텔레그램 booking #4 "❌ 취소"
 *
 * Auth: Firebase Admin token (verifyAdminToken — ADMIN_EMAIL 매칭).
 *
 * Body:
 *   {
 *     bookingRef,           // 'CT-YYYYMMDD-XXX' (pending_bookings doc ID)
 *     action,               // 'mark-paid' | 'mark-refunded' | 'mark-canceled'
 *     paypalTransactionId,  // (mark-paid) PayPal 거래 ID — 운영자가 PayPal 에서 복사
 *     refundedKRW,          // (mark-refunded) 환불 금액 (KRW). 미지정 시 전액
 *     reason,               // 모든 action 공통 옵션 — 사유 텍스트
 *   }
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { buildManualPaymentEmail } from './_shared/manual-payment-emails.js';
import { sendEmail } from './_send-email.js';
import { confirmBookingAsPaid } from './_shared/booking-confirm.js';

// 이메일 발송 헬퍼 — 실패해도 admin action 자체는 성공해야 (booking 상태 갱신은
// 이미 끝났고, 이메일 누락은 admin 이 수동 재발송 가능).
async function sendCustomerNotification(kind, booking) {
  try {
    if (!booking?.customerEmail) {
      console.warn('[admin-booking-action] no customerEmail — skip email');
      return;
    }
    const { subject, html, text } = buildManualPaymentEmail(kind, booking);
    await sendEmail({ to: booking.customerEmail, subject, html, text });
    console.log(`[admin-booking-action] customer email sent (${kind}):`, booking.customerEmail);
  } catch (e) {
    console.error(`[admin-booking-action] customer email (${kind}) failed:`, e.message);
  }
}

export const config = { runtime: 'nodejs' };
export const maxDuration = 30;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_ACTIONS = new Set(['mark-paid', 'mark-refunded', 'mark-canceled']);

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  // Admin 인증
  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    res.writeHead(tokenAuth.status || 401, JSON_HEADERS);
    return res.end(JSON.stringify(_err(tokenAuth.error || 'auth required', 'AUTH_FAILED')));
  }
  const adminUid = tokenAuth.uid;
  const adminEmail = tokenAuth.email;

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { bookingRef, action, paypalTransactionId, refundedKRW, reason } = body;

    if (!bookingRef) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('bookingRef required', 'MISSING_BOOKING_REF')));
    }
    if (!VALID_ACTIONS.has(action)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`Invalid action. Allowed: ${[...VALID_ACTIONS].join(', ')}`, 'INVALID_ACTION')));
    }

    const adminDb = initAdminDb('admin-booking-action');
    if (!adminDb) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    const pendingRef = adminDb.collection('pending_bookings').doc(bookingRef);
    const pendingSnap = await pendingRef.get();

    if (!pendingSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`pending_bookings/${bookingRef} not found`, 'NOT_FOUND')));
    }
    const pending = pendingSnap.data();

    // Audit log — 모든 action 공통
    const auditEntry = {
      adminUid, adminEmail,
      bookingRef,
      action,
      reason: reason || null,
      previousStatus: pending.status,
      paypalTransactionId: paypalTransactionId || null,
      refundedKRW: refundedKRW != null ? Number(refundedKRW) : null,
      at: FieldValue.serverTimestamp(),
    };
    await adminDb.collection('admin_actions').add(auditEntry);

    // ──────── Action 1: mark-paid ────────────────────────────────────
    if (action === 'mark-paid') {
      // 공통 confirm 로직은 _shared/booking-confirm.js 로 추출 (paypal-webhook 과 공유)
      const result = await confirmBookingAsPaid({
        db: adminDb,
        bookingRef,
        paypalTransactionId,
        source: 'admin',
        adminUid,
        adminEmail,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        res.writeHead(status, JSON_HEADERS);
        return res.end(JSON.stringify(_err(result.error, result.code)));
      }
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          bookingRef,
          status: 'CONFIRMED',
          bookingId: result.bookingId,
          ...(result.alreadyConfirmed ? { alreadyConfirmed: true } : {}),
        },
      }));
    }

    // ──────── Action 2: mark-refunded ────────────────────────────────
    if (action === 'mark-refunded') {
      // 환불은 confirmed booking 에만 가능
      if (pending.status !== 'CONFIRMED') {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`Cannot refund — current status: ${pending.status}`, 'INVALID_STATUS')));
      }
      const refundKrw = refundedKRW != null ? Number(refundedKRW) : pending.priceKRW;

      await pendingRef.update({
        status: 'REFUNDED',
        refundedKRW: refundKrw,
        refundReason: reason || null,
        refundedAt: FieldValue.serverTimestamp(),
        refundedByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // bookings doc 도 동시 업데이트
      const bookingId = pending.paypalTransactionId || bookingRef;
      await adminDb.collection('bookings').doc(bookingId).set({
        status: 'REFUNDED',
        refundedKRW: refundKrw,
        refundReason: reason || null,
        refundedAt: FieldValue.serverTimestamp(),
        refundedByAdminUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const telText = [
        '💸 <b>환불 완료 (PayPal 수동 처리)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>환불액:</b> ₩${refundKrw.toLocaleString('ko-KR')}`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        reason ? `<b>사유:</b> ${reason}` : null,
      ].filter(Boolean).join('\n');
      notify('booking', telText).catch(() => {});

      // 사용자 4-lang 환불 안내 이메일
      sendCustomerNotification('refunded', {
        ...pending,
        refundedKRW: refundKrw,
        refundReason: reason || null,
      }).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: { bookingRef, status: 'REFUNDED', refundedKRW: refundKrw } }));
    }

    // ──────── Action 3: mark-canceled ────────────────────────────────
    if (action === 'mark-canceled') {
      await pendingRef.update({
        status: 'CANCELED',
        cancelReason: reason || null,
        canceledAt: FieldValue.serverTimestamp(),
        canceledByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const telText = [
        '❌ <b>예약 취소</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        reason ? `<b>사유:</b> ${reason}` : null,
      ].filter(Boolean).join('\n');
      notify('booking', telText).catch(() => {});

      // 사용자 4-lang 취소 안내 이메일
      sendCustomerNotification('canceled', {
        ...pending,
        cancelReason: reason || null,
      }).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: { bookingRef, status: 'CANCELED' } }));
    }

    // unreachable
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err('unhandled action', 'UNHANDLED')));
  } catch (err) {
    console.error('[admin-booking-action] failed:', err.message);
    await captureError(err, { route: '/api/admin-booking-action', method: req.method, adminEmail });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
