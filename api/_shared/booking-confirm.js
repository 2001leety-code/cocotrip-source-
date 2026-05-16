/**
 * Shared booking confirmation logic.
 *
 * Used by both:
 *   - /api/admin-booking-action      (source='admin')   운영자 수동 [입금 확인]
 *   - /api/paypal-webhook            (source='webhook') PayPal IPN 자동 매칭
 *
 * 역할:
 *   1) pending_bookings/{bookingRef} 의 status='CONFIRMED' 전환 (멱등)
 *   2) bookings 정식 컬렉션 mirror (사용자 MyPage / 어드민 통합 view 호환)
 *   3) AI 플래너 / booking-processor fire-and-forget 트리거
 *   4) 텔레그램 booking #2 알림
 *   5) 사용자 4-lang 결제 확정 이메일
 *
 * 이미 CONFIRMED 상태면 부수효과 모두 스킵하고 alreadyConfirmed:true 반환.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './notify.js';
import { buildManualPaymentEmail } from './manual-payment-emails.js';
import { triggerBookingProcessor } from './booking-processor-trigger.js';
import { sendCustomerEmailWithAlert } from './customer-email-trigger.js';

async function sendCustomerConfirmEmail(db, booking) {
  if (!booking?.customerEmail) return { ok: true, skipped: 'no-email' };
  const { subject, html, text } = buildManualPaymentEmail('confirmed', booking);
  // PR #439 (Audit Z-H16): helper now writes to pending_email_retries +
  // fires operator Telegram alert on failure (was silent .catch(()=>{})).
  return sendCustomerEmailWithAlert({
    db,
    to: booking.customerEmail,
    subject, html, text,
    context: {
      bookingRef: booking.bookingRef || null,
      emailType: 'manual-payment-confirmed',
      language: booking.language || 'en',
      source: 'booking-confirm',
    },
  });
}

function triggerDownstreamEffects({ db, pending, bookingRef, bookingId }) {
  try {
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    const isAiPlanner = String(pending.productType || '').startsWith('ai-planner');

    if (isAiPlanner) {
      if (pending.itineraryData && pending.itineraryData.regions) {
        const aiPayload = {
          ...pending.itineraryData,
          paypalOrderId: `MANUAL-${bookingRef}`,
          email: pending.customerEmail,
          language: pending.language || 'en',
          uid: pending.userId || null,
        };
        console.log('[booking-confirm] triggering AI planner for', bookingRef);
        fetch(`${siteUrl}/api/ai-planner-full`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(aiPayload),
        }).catch((e) => console.warn('[booking-confirm] ai-planner-full failed:', e.message));
      } else {
        console.warn('[booking-confirm] AI planner requested but itineraryData missing — manual trigger required:', bookingRef);
      }
    } else {
      // PR #436 (Audit Y-H8 — 2026-05-16): replaced silent-failure fetch() with
      // triggerBookingProcessor helper — non-2xx + timeout now record a retry
      // doc + operator alert instead of being lost.
      const processorPayload = {
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
      };
      void triggerBookingProcessor({
        db,
        siteUrl,
        payload: processorPayload,
        source: 'booking-confirm',
        notify,
      });
    }
  } catch (procErr) {
    console.warn('[booking-confirm] downstream effects failed:', procErr.message);
  }
}

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.bookingRef            예: 'CT-20260506-001'
 * @param {string} [args.paypalTransactionId] PayPal capture id (admin 입력 또는 webhook resource.id)
 * @param {'admin'|'webhook'} args.source
 * @param {string} [args.adminUid]            source='admin' 일 때
 * @param {string} [args.adminEmail]
 * @returns {Promise<{ok:true, bookingId:string, alreadyConfirmed?:boolean}|{ok:false, code:string, error:string}>}
 */
export async function confirmBookingAsPaid({
  db,
  bookingRef,
  paypalTransactionId,
  source,
  adminUid = null,
  adminEmail = null,
}) {
  if (!db) return { ok: false, code: 'NO_DB', error: 'Firestore admin db required' };
  if (!bookingRef) return { ok: false, code: 'MISSING_BOOKING_REF', error: 'bookingRef required' };
  if (source !== 'admin' && source !== 'webhook') {
    return { ok: false, code: 'INVALID_SOURCE', error: `source must be 'admin' or 'webhook'` };
  }

  const pendingRef = db.collection('pending_bookings').doc(bookingRef);
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) {
    return { ok: false, code: 'NOT_FOUND', error: `pending_bookings/${bookingRef} not found` };
  }
  const pending = pendingSnap.data();

  // 멱등 — 이미 CONFIRMED 면 부수효과 스킵
  if (pending.status === 'CONFIRMED') {
    const existingId = pending.paypalTransactionId || bookingRef;
    return { ok: true, bookingId: existingId, alreadyConfirmed: true };
  }

  const bookingId = paypalTransactionId || bookingRef;

  // 1. pending_bookings 갱신
  const updatePayload = {
    status: 'CONFIRMED',
    paypalTransactionId: paypalTransactionId || null,
    confirmedAt: FieldValue.serverTimestamp(),
    confirmedBySource: source,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (source === 'admin') {
    updatePayload.confirmedByUid = adminUid;
  }
  await pendingRef.update(updatePayload);

  // 2. bookings mirror
  await db.collection('bookings').doc(bookingId).set({
    captureID: bookingId,
    bookingRef,
    provider: source === 'webhook' ? 'paypal-webhook' : 'paypal-manual',
    status: 'CONFIRMED',
    paymentStatus: source === 'webhook' ? 'webhook_confirmed' : 'manual_confirmed',
    amountKRW: pending.priceKRW,
    amountUSD: pending.priceUSD || null,
    userEmail: pending.customerEmail,
    customerPhone: pending.customerPhone || null,
    productType: pending.productType,
    tourDate: pending.dateStart || '',
    // PR #426 (Audit CY3 — 2026-05-14): persist tourTime so cancelBooking /
    // modifyBooking / my-bookings use the actual tour start hour for
    // window calculations. pending.tourTime may come from manual-payment-
    // request or admin entry; missing → legacy '00:00' fallback in
    // evaluateRefundPolicy.
    tourTime: pending.tourTime || '',
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
    confirmedByAdminUid: source === 'admin' ? adminUid : null,
    confirmedBySource: source,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // 3. fire-and-forget downstream (with failure capture — see PR #436)
  triggerDownstreamEffects({ db, pending, bookingRef, bookingId });

  // 4. 텔레그램 booking #2
  const sourceLabel = source === 'webhook' ? '🤖 자동 매칭 (PayPal Webhook)' : '✅ 입금 확인 완료 (PayPal 매칭)';
  const telText = [
    `<b>${sourceLabel}</b>`,
    '',
    `<b>예약번호:</b> <code>${bookingRef}</code>`,
    `<b>상품:</b> ${pending.productType}`,
    `<b>금액:</b> ₩${Number(pending.priceKRW).toLocaleString('ko-KR')}`,
    `<b>이메일:</b> ${pending.customerEmail}`,
    paypalTransactionId ? `<b>PayPal TX:</b> <code>${paypalTransactionId}</code>` : null,
    source === 'admin' && adminEmail ? `<b>처리:</b> ${adminEmail}` : null,
    '',
    '📩 <i>고객에게 결제 확정 안내 이메일 자동 발송 처리 중</i>',
  ].filter(Boolean).join('\n');
  notify('booking', telText).catch(() => {});

  // 5. 사용자 confirm 이메일 — PR #439 (Z-H16): helper 가 실패 시 운영자 알림
  // + pending_email_retries 등록 (silent loss 차단). fire-and-forget 유지.
  void sendCustomerConfirmEmail(db, pending);

  return { ok: true, bookingId };
}
