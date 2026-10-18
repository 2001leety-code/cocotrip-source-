/** Shared admin/webhook confirmation: booking and retry intent commit together. */
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './notify.js';
import { buildManualPaymentEmail } from './manual-payment-emails.js';
import { triggerBookingProcessor } from './booking-processor-trigger.js';
import { sendCustomerEmailWithAlert } from './customer-email-trigger.js';
import { triggerAiPlanner } from './ai-planner-trigger.js';
import { internalApiBase } from './internal-base-url.js';
import { throttledTelegramAlert } from './telegram-throttle.js';

const CLOSED_QUEUE_STATES = ['done', 'manual-intervention', 'permanent-failure'];
// REFUND_PENDING (terminal-before-refund) is stopped too: never reconfirmed, never dispatched.
const STOPPED_BOOKING_STATES = ['CANCELLED', 'CANCELED', 'REFUNDED', 'REFUND_PENDING'];

function bookingMirror(pending, bookingRef, bookingId, source, adminUid) {
  const originalSource = pending.confirmedBySource || source;
  return {
    captureID: bookingId,
    bookingRef,
    provider: originalSource === 'webhook' ? 'paypal-webhook' : 'paypal-manual',
    status: 'CONFIRMED',
    paymentStatus: originalSource === 'webhook' ? 'webhook_confirmed' : 'manual_confirmed',
    amountKRW: pending.priceKRW,
    amountUSD: pending.priceUSD || null,
    userEmail: pending.customerEmail,
    customerPhone: pending.customerPhone || null,
    productType: pending.productType,
    tourDate: pending.dateStart || '',
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
    confirmedByAdminUid: pending.confirmedByUid || (source === 'admin' ? adminUid : null),
    confirmedBySource: originalSource,
    createdAt: pending.confirmedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function processorPayload(booking, bookingId) {
  const usdToKrwFallback = Number(process.env.KRW_USD_RATE) || Number(process.env.VITE_USD_KRW_RATE) || 1430;
  return {
    orderID: bookingId,
    payerEmail: booking.userEmail,
    payerName: (booking.userEmail || '').split('@')[0],
    amount: booking.amountUSD || (Number(booking.amountKRW) / usdToKrwFallback).toFixed(2),
    product: booking.productType,
    tourDate: booking.tourDate || '',
    pickupLocation: booking.pickupLocation || '',
    dropoffLocation: booking.dropoffLocation || '',
    paxCount: booking.paxCount || 1,
    vehicleType: booking.vehicleType || '',
    memo: booking.memo || '',
    itineraryData: booking.itineraryData || null,
    airport: booking.airport || null,
  };
}

async function sendCustomerConfirmEmail(pendingRef, pending, bookingRef) {
  if (!pending.customerEmail) return;
  try {
    const content = buildManualPaymentEmail('confirmed', pending);
    // db:null — no automatic pending_email_retries entry: an ambiguous send must not be auto-resent.
    const sent = await sendCustomerEmailWithAlert({ db: null, to: pending.customerEmail, ...content, context: { bookingRef, emailType: 'manual-payment-confirmed' } });
    if (!sent || sent.ok !== true) throw new Error((sent && sent.reason) || 'send-failed');
    await pendingRef.update({ confirmationEmailState: 'completed' });
  } catch (error) {
    // The atomic confirmation already recorded UNKNOWN; neither send nor its receipt is replayed.
    console.error('[booking-confirm] confirmation email outcome unknown:', error.message);
    await notify('booking', `⚠️ <b>결제 확정 안내메일 결과 미상</b>\n예약: <code>${bookingRef}</code>\n→ 자동 재발송하지 않습니다. 실제 수신 여부를 확인한 뒤 수동 처리하세요.`).catch(() => {});
  }
}

async function dispatchIntent({ db, pendingRef, queueRef, bookingId, bookingRef, isAi, payload, claimToken }) {
  let result;
  try {
    // The durable intent belongs to this transaction; helpers must not overwrite it on failure.
    // `notify` restored 2026-10-10: the helpers alert the operator on non-2xx/timeout (PR #436/#453 contract).
    result = isAi
      ? await triggerAiPlanner({ db: null, siteUrl: internalApiBase(), bookingRef, payload, source: 'booking-confirm', notify })
      : await triggerBookingProcessor({ db: null, siteUrl: internalApiBase(), payload, source: 'booking-confirm', notify });
  } catch (error) {
    result = { ok: false, reason: error.message, outcome: 'retryable' };
    console.error('[booking-confirm] downstream effects failed:', error.message);
    await throttledTelegramAlert({
      key: 'booking-confirm-downstream-throw',
      channel: 'admin',
      severity: 'critical',
      message: [
        `🚨 <b>booking-confirm downstream 효과 함수 throw</b>`, ``,
        `<b>예약번호:</b> <code>${bookingRef || '-'}</code>`, `<b>BookingId:</b> <code>${bookingId || '-'}</code>`,
        `<b>에러:</b> ${(error.message || 'unknown').replace(/[<>&]/g, '_').slice(0, 250)}`, ``,
        `→ user 결제 완료. 재시도 큐(pending)에 남김 — 크론 재시도 실패 시 수동 처리.`,
      ].join('\n'),
      context: { bookingRef, bookingId },
    }).catch(() => {});
  }
  // Validated helper contract only: triggerBookingProcessor returns ok:true solely when the processor body's
  // outcome is semantically 'completed' (never raw HTTP 2xx); ok:false carries docStatus/outcome. AI: ok:true
  // = accepted (pre-existing semantics), ok:false = cron retry. Anything else is an unproven side effect:
  // quarantine as manual-intervention / outcome_unknown instead of re-dispatching.
  const validated = result && typeof result === 'object' && typeof result.ok === 'boolean';
  const status = !validated ? 'manual-intervention'
    : result.ok ? 'done'
      : isAi ? 'pending'
        : result.docStatus || 'pending';
  const outcome = !validated ? 'outcome_unknown' : status === 'done' ? 'completed' : result.outcome || 'retryable';
  const failureReason = !validated ? `dispatch-result-unknown: ${result && result.reason ? result.reason : 'invalid-helper-result'}`
    : status === 'done' ? null : result.reason || null;
  if (!validated) {
    // Quarantined intents are not swept by the retry cron: without an alert the customer gets nothing.
    console.error('[booking-confirm] dispatch result not validated — quarantined:', bookingId);
    await throttledTelegramAlert({
      key: 'booking-confirm-dispatch-unknown',
      channel: 'admin',
      severity: 'critical',
      message: [
        `🚨 <b>booking-confirm 후속 처리 결과 미상 — 수동 개입</b>`, ``,
        `<b>예약번호:</b> <code>${bookingRef || '-'}</code>`, `<b>BookingId:</b> <code>${bookingId || '-'}</code>`,
        `<b>사유:</b> ${String(failureReason || '').replace(/[<>&]/g, '_').slice(0, 250)}`, ``,
        `→ 큐 상태 manual-intervention. 크론이 자동 재시도하지 않음 — AI ops 센터에서 확인.`,
      ].join('\n'),
      context: { bookingRef, bookingId },
    }).catch(() => {});
  }
  await db.runTransaction(async (tx) => {
    const pendingSnap = await tx.get(pendingRef);
    const queueSnap = await tx.get(queueRef);
    const pending = pendingSnap.data() || {};
    const queue = queueSnap.data() || {};
    if (pending.confirmationFulfillment?.claimToken !== claimToken || CLOSED_QUEUE_STATES.includes(queue.status)) return;
    tx.update(queueRef, {
      status,
      outcome,
      stepStatus: (validated && result.stepStatus) || queue.stepStatus || null,
      lastFailureReason: failureReason,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(pendingRef, { confirmationFulfillment: { bookingId, claimToken, phase: status, leaseUntilMs: 0 } });
  });
}

/** Callers retain admin/webhook authorization and payment verification. */
export async function confirmBookingAsPaid({ db, bookingRef, paypalTransactionId, source, adminUid = null, adminEmail = null }) {
  if (!db) return { ok: false, code: 'NO_DB', error: 'Firestore admin db required' };
  if (!bookingRef) return { ok: false, code: 'MISSING_BOOKING_REF', error: 'bookingRef required' };
  if (source !== 'admin' && source !== 'webhook') {
    return { ok: false, code: 'INVALID_SOURCE', error: `source must be 'admin' or 'webhook'` };
  }
  const pendingRef = db.collection('pending_bookings').doc(bookingRef);
  const claimToken = randomUUID();
  const nowMs = Date.now();
  const repair = await db.runTransaction(async (tx) => {
    const pendingSnap = await tx.get(pendingRef);
    if (!pendingSnap.exists) return { error: 'NOT_FOUND' };
    const pending = pendingSnap.data();
    const alreadyConfirmed = pending.status === 'CONFIRMED';
    const bookingId = alreadyConfirmed ? pending.paypalTransactionId || bookingRef : paypalTransactionId || bookingRef;
    const bookingRefDoc = db.collection('bookings').doc(bookingId);
    const isAi = String(pending.productType || '').startsWith('ai-planner');
    const queueRef = db.collection(isAi ? 'pending_ai_planner_retries' : 'pending_processor_retries').doc(isAi ? bookingRef : bookingId);
    const bookingSnap = await tx.get(bookingRefDoc);
    const queueSnap = await tx.get(queueRef);
    const existingBooking = bookingSnap.exists ? bookingSnap.data() : null;
    const queue = queueSnap.exists ? queueSnap.data() : null;
    if (STOPPED_BOOKING_STATES.includes(String(pending.status || '').toUpperCase())
      || STOPPED_BOOKING_STATES.includes(String(existingBooking?.status || '').toUpperCase())
      || (existingBooking?.bookingRef && existingBooking.bookingRef !== bookingRef)
      || (existingBooking?.captureID && existingBooking.captureID !== bookingId)
      || (queue?.payload?.orderID && queue.payload.orderID !== bookingId)) return { error: 'CONFIRMATION_CONFLICT' };

    const original = queue?.bookingSnapshot || bookingMirror(pending, bookingRef, bookingId, source, adminUid);
    const booking = existingBooking || { ...original };
    // Legacy = confirmed before this contract: no fulfilment record and no queue. A fresh concurrent
    // confirmation (fulfilment/queue present) is NOT legacy — its voucher must stay sendable.
    const legacy = alreadyConfirmed && !pending.confirmationFulfillment && !queue;
    if (!booking.voucherSentAt && !booking.voucherSentAtState) {
      const emailStep = queue?.stepStatus?.email;
      const marker = queue?.status === 'done' || emailStep === 'completed' ? 'completed'
        : emailStep === 'outcome_unknown' || legacy ? 'outcome_unknown' : null;
      // A missing legacy marker cannot prove that the customer never received a voucher.
      if (marker) {
        booking.voucherSentAtState = marker;
        if (existingBooking) tx.set(bookingRefDoc, { voucherSentAtState: marker }, { merge: true });
      }
    }
    if (!bookingSnap.exists) tx.set(bookingRefDoc, booking);
    const payload = queue?.payload || (isAi ? {
      ...(pending.itineraryData || {}), paypalOrderId: `MANUAL-${bookingRef}`,
      email: booking.userEmail, language: pending.language || 'en', uid: pending.userId || null,
    } : processorPayload({ ...original, ...booking }, bookingId));
    const legacyAi = isAi && legacy;
    const missingAiInput = isAi && !payload.regions;
    // AI intents start 'in_progress' (cron sweeps only 'pending') so direct dispatch and the sweep never
    // double-generate; an expired lease lets a later confirmation re-dispatch an abandoned in_progress intent.
    const queueStatus = queue?.status || (legacyAi || missingAiInput ? 'manual-intervention' : isAi ? 'in_progress' : 'pending');
    if (!queue) tx.set(queueRef, {
      bookingRef, orderID: bookingId, retryDocId: isAi ? bookingRef : bookingId,
      payload, bookingSnapshot: booking, source: 'booking-confirm', status: queueStatus,
      attempts: 0, firstFailureAt: FieldValue.serverTimestamp(),
      ...(legacyAi || missingAiInput ? { lastFailureReason: 'ai-issuance-requires-verification' } : {}),
    });
    const priorClaim = pending.confirmationFulfillment;
    const dispatch = (queueStatus === 'pending' || queueStatus === 'in_progress') && !(Number(priorClaim?.leaseUntilMs) > nowMs);
    if (dispatch && queue && queue.status === 'in_progress') tx.update(queueRef, { lastClaimReset: FieldValue.serverTimestamp() });
    const confirmationPatch = alreadyConfirmed ? {} : {
      status: 'CONFIRMED', paypalTransactionId: paypalTransactionId || null,
      confirmedAt: FieldValue.serverTimestamp(), confirmedBySource: source,
      ...(source === 'admin' ? { confirmedByUid: adminUid } : {}),
    };
    tx.update(pendingRef, {
      ...confirmationPatch,
      updatedAt: FieldValue.serverTimestamp(),
      confirmationEmailState: pending.confirmationEmailState || (!pending.customerEmail ? 'skipped_not_applicable' : legacy ? 'legacy_outcome_unknown' : 'outcome_unknown'),
      confirmationFulfillment: dispatch
        ? { bookingId, claimToken, phase: 'in_progress', leaseUntilMs: nowMs + 5 * 60 * 1000 }
        : priorClaim || { bookingId, claimToken: null, phase: queueStatus, leaseUntilMs: 0 },
    });
    return { pending, bookingId, queueRef, isAi, payload, alreadyConfirmed, dispatch, missingAiInput: missingAiInput && !queue };
  });
  if (repair.error) return { ok: false, code: repair.error, error: repair.error === 'NOT_FOUND' ? `pending_bookings/${bookingRef} not found` : 'Recorded booking cannot be reconfirmed automatically' };
  const { pending, bookingId, alreadyConfirmed } = repair;

  if (!alreadyConfirmed) {
    const sourceLabel = source === 'webhook' ? '🤖 자동 매칭 (PayPal Webhook)' : '✅ 입금 확인 완료 (PayPal 매칭)';
    await notify('booking', [
      `<b>${sourceLabel}</b>`, '', `<b>예약번호:</b> <code>${bookingRef}</code>`,
      `<b>상품:</b> ${pending.productType}`, `<b>금액:</b> ₩${Number(pending.priceKRW).toLocaleString('ko-KR')}`,
      `<b>이메일:</b> ${pending.customerEmail}`,
      paypalTransactionId ? `<b>PayPal TX:</b> <code>${paypalTransactionId}</code>` : null,
      source === 'admin' && adminEmail ? `<b>처리:</b> ${adminEmail}` : null,
    ].filter(Boolean).join('\n')).catch(() => {});
    await sendCustomerConfirmEmail(pendingRef, pending, bookingRef);
  }
  if (repair.missingAiInput) {
    // Paid AI planner without wizard input: queued as manual-intervention (never swept) — operator must act.
    console.warn('[booking-confirm] AI planner requested but itineraryData missing — manual trigger required:', bookingRef);
    await throttledTelegramAlert({
      key: 'ai-planner-itinerary-missing',
      channel: 'booking',
      severity: 'critical',
      message: [
        `🚨 <b>AI Planner 결제 완료, itineraryData 누락 — 수동 개입</b>`, ``,
        `<b>예약번호:</b> <code>${bookingRef}</code>`, `<b>이메일:</b> ${pending.customerEmail || '(none)'}`,
        `<b>productType:</b> ${pending.productType}`, ``,
        `→ user 가 결제했지만 wizard input 없음 → AI 플랜 생성 불가`, `→ user 에게 wizard 재진입 안내 + 수동 환불 검토`,
      ].join('\n'),
      context: { bookingRef, customerEmail: pending.customerEmail, productType: pending.productType },
    }).catch(() => {});
  }
  if (repair.dispatch) await dispatchIntent({ db, pendingRef, ...repair, bookingRef, claimToken });
  return { ok: true, bookingId, ...(alreadyConfirmed ? { alreadyConfirmed: true } : {}) };
}
