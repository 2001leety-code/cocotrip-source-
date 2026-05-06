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
      // 1. pending_bookings status 갱신
      await pendingRef.update({
        status: 'CONFIRMED',
        paypalTransactionId: paypalTransactionId || null,
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 2. bookings 정식 컬렉션에 mirror — 사용자 MyPage / 어드민 통합 view 와 호환
      const bookingId = paypalTransactionId || bookingRef;
      await adminDb.collection('bookings').doc(bookingId).set({
        captureID: bookingId,
        bookingRef,
        provider: 'paypal-manual',
        status: 'CONFIRMED',
        paymentStatus: 'manual_confirmed',
        amountKRW: pending.priceKRW,
        amountUSD: pending.priceUSD || null,
        userEmail: pending.customerEmail,
        customerPhone: pending.customerPhone || null,
        productType: pending.productType,
        tourDate: pending.dateStart || '',
        tourEndDate: pending.dateEnd || '',
        paxCount: pending.passengers || 1,
        pickupLocation: pending.pickupLocation || '',
        dropoffLocation: pending.dropoffLocation || '',
        vehicleType: pending.vehicleType || '',
        memo: pending.memo || '',
        airport: pending.airport || null,
        itineraryData: pending.itineraryData || null,
        paymentMethod: pending.paymentMethod || 'paypal-me-qr',
        paypalMeUrl: pending.paypalMeUrl || null,
        confirmedByAdminUid: adminUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // 3. AI 플래너 자동 트리거 / booking-processor 호출 (이메일·바우처·텔레그램)
      try {
        const isAiPlanner = String(pending.productType || '').startsWith('ai-planner');
        if (!isAiPlanner) {
          // 차터/투어 — booking-processor 가 이메일/PDF 바우처/텔레그램 driver 알림
          const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
          fetch(`${siteUrl}/api/booking-processor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderID: bookingId,
              payerEmail: pending.customerEmail,
              payerName: (pending.customerEmail || '').split('@')[0],
              amount: pending.priceUSD || (Number(pending.priceKRW) / 1380).toFixed(2),
              product: pending.productType,
              tourDate: pending.dateStart || '',
              pickupLocation: pending.pickupLocation || '',
              dropoffLocation: pending.dropoffLocation || '',
              paxCount: pending.passengers || 1,
              vehicleType: pending.vehicleType || '',
              memo: pending.memo || '',
              itineraryData: pending.itineraryData || null,
              airport: pending.airport || null,
            }),
          }).catch((e) => console.warn('[admin-booking-action] booking-processor failed:', e.message));
        }
        // AI 플래너의 경우: 별도 사용자 액션으로 ai-planner-full 호출 트리거 필요.
        // 현재 흐름에선 운영자가 이메일에 "다음 24시간 내 플랜 발송" 안내 후 수동 처리.
        // 향후: AI 플래너 itineraryData 활용해 server-side 자동 생성 가능 (별도 PR).
      } catch (procErr) {
        console.warn('[admin-booking-action] downstream effects failed:', procErr.message);
      }

      // 4. 텔레그램 booking #2 알림
      const telText = [
        '✅ <b>입금 확인 완료 (PayPal 매칭)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>상품:</b> ${pending.productType}`,
        `<b>금액:</b> ₩${pending.priceKRW.toLocaleString('ko-KR')}`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        paypalTransactionId ? `<b>PayPal TX:</b> <code>${paypalTransactionId}</code>` : null,
        '',
        '📩 <i>고객에게 결제 확정 안내 이메일 자동 발송 처리 중</i>',
      ].filter(Boolean).join('\n');
      notify('booking', telText).catch(() => {});

      // 5. 사용자 4-lang 이메일 발송 (booking-processor 가 영수증 발송하지만,
      //    AI 플래너 등 booking-processor 미경유 케이스 대비 명시적 confirm 메일).
      sendCustomerNotification('confirmed', pending).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: { bookingRef, status: 'CONFIRMED', bookingId } }));
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
