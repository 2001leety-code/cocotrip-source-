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
import { refundPaypalCapture } from './_shared/paypal-refund.js';
import { buildAdminJsonCors } from './_shared/cors.js';

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

// PR #437 (W-H11): per-request origin allowlist — was wildcard '*'.
// JSON_HEADERS is now built per-handler-call so it can echo req.headers.origin.
const JSON_HEADERS_STATIC = { 'Cache-Control': 'no-store' };
const CORS_METHODS = 'POST, OPTIONS';

const VALID_ACTIONS = new Set(['mark-paid', 'mark-refunded', 'mark-canceled']);

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
}

export default async function handler(req, res) {
  const JSON_HEADERS = { ...JSON_HEADERS_STATIC, ...buildAdminJsonCors(req, { methods: CORS_METHODS }) };
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
    //
    // PR #425 (Audit CY5 — 2026-05-14): 이전엔 Firestore status='REFUNDED' +
    // 환불 이메일만 발송하고 PayPal API 호출은 누락. 결과: 사용자 mypage 와
    // 이메일은 "환불 완료" 라고 표시되지만 PayPal 계정엔 그대로 돈이 남음.
    // 운영자가 별도로 PayPal Dashboard 에서 수동 refund 안 누르면 사용자가
    // 며칠씩 환불 못 받음. 이제 captureID 가 있으면 자동 PayPal refund 호출.
    if (action === 'mark-refunded') {
      // 환불은 confirmed booking 에만 가능
      if (pending.status !== 'CONFIRMED') {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`Cannot refund — current status: ${pending.status}`, 'INVALID_STATUS')));
      }
      const refundKrw = refundedKRW != null ? Number(refundedKRW) : pending.priceKRW;

      // bookings doc 에서 captureID 조회 — PayPal 자동 환불용.
      const bookingId = pending.paypalTransactionId || bookingRef;
      const bookingSnap = await adminDb.collection('bookings').doc(bookingId).get();
      const bookingData = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
      const captureID = bookingData.captureID || pending.paypalCaptureId || null;

      // 🔴 money 가드: 입력 환불액이 결제 원금을 초과하면 차단.
      //   초과 시 captureID 경로에서 refundKrw<originalKRW 가 false → refundUSD=null →
      //   refundPaypalCapture 가 부분 의도임에도 silent 전액 환불 + Firestore refundedKRW 과대기록.
      //   refundKrw===originalKRW(전액) / refundKrw<originalKRW(부분) 은 정상.
      const originalKRW = Number(bookingData.amountKRW || pending.priceKRW || 0);
      if (originalKRW > 0 && refundKrw > originalKRW) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          `환불액(₩${refundKrw.toLocaleString('ko-KR')})이 결제 원금(₩${originalKRW.toLocaleString('ko-KR')})을 초과합니다`,
          'REFUND_EXCEEDS_ORIGINAL')));
      }
      // 부분환불 명시(refundedKRW 입력)인데 원금 정보가 없어 비례 검증 불가 → 자동 전액환불 대신 차단.
      if (originalKRW <= 0 && refundedKRW != null) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(
          '결제 원금 정보가 없어 부분환불 금액을 검증할 수 없습니다 (전액환불은 금액 미지정으로 재시도)',
          'REFUND_ORIGINAL_UNKNOWN')));
      }

      // PayPal API 호출 — captureID 가 있을 때만. 없으면 manual booking
      // (paypal.me QR 수동 입금 등) 으로 간주하고 운영자가 별도 환불 진행.
      let paypalRefund = null;
      if (captureID) {
        const usdToKrw = Number(process.env.KRW_USD_RATE)
          || Number(process.env.VITE_USD_KRW_RATE)
          || 1430;
        // refundKrw → refundUSD 환산. 부분환불 (refundedKRW < priceKRW) 일 때 비례 계산.
        let refundUSD = null;
        if (originalKRW > 0 && refundKrw < originalKRW) {
          const originalUSD = parseFloat(bookingData.amountUSD || '0');
          if (originalUSD > 0) {
            refundUSD = (originalUSD * (refundKrw / originalKRW)).toFixed(2);
          } else {
            refundUSD = (refundKrw / usdToKrw).toFixed(2);
          }
        }
        const result = await refundPaypalCapture({
          captureID,
          // 🔴 이중환불 방어 키 (2026-07-15). bookingRef(pending_bookings 문서 id) + 금액.
          //   금액을 포함하는 이유: 운영자가 AdminPayments 의 window.prompt 로 **임의 금액**을
          //   넣는다. bookingRef 단독 키면 "실패 후 다른 금액으로 재시도" 가 첫 요청의 캐시된
          //   응답을 받아 원하는 금액이 환불되지 않는다. 금액을 넣으면 같은 금액 재시도만
          //   멱등이 되고(= 타임아웃 재클릭 방어), 다른 금액은 별개 환불로 취급된다.
          //   ⚠️ captureID 단독 금지 — cart 자식들이 captureID 를 공유한다(helper 주석 참조).
          //   ⚠️ 영구 중복 방어는 이 키가 아니라 위 status!=='CONFIRMED' 가드가 담당한다.
          //      (PayPal 은 PayPal-Request-Id 보존 기간을 공식화하지 않는다.)
          idempotencyKey: `${bookingRef}:${refundUSD || 'full'}`,
          refundUSD,
          // capture 통화 우선. bookings 문서가 없으면 bookingData={} → undefined → helper 가 USD 폴백.
          currency: bookingData.currency,
          note: reason
            ? `CocoTrip admin refund: ${String(reason).slice(0, 80)}`
            : 'CocoTrip admin refund',
        });
        if (!result.ok) {
          console.error('[admin-booking-action] PayPal refund failed:', result.code, result.error);
          // PayPal 실패 시 Firestore 도 업데이트 하지 않음 — 운영자가 정확한
          // 사유 보고 수동 처리하도록 status code 그대로 반환.
          res.writeHead(result.status, JSON_HEADERS);
          return res.end(JSON.stringify(_err(result.error, result.code)));
        }
        paypalRefund = result.refund;
      } else {
        console.warn('[admin-booking-action] mark-refunded without captureID — Firestore-only refund (manual PayPal expected):', bookingRef);
      }

      const firestoreUpdate = {
        status: 'REFUNDED',
        refundedKRW: refundKrw,
        refundReason: reason || null,
        refundedAt: FieldValue.serverTimestamp(),
        refundedByUid: adminUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(paypalRefund
          ? { refundID: paypalRefund.id, refundStatus: paypalRefund.status, refundSource: 'paypal-api' }
          : { refundSource: 'manual' }),
      };

      await pendingRef.update(firestoreUpdate);
      await adminDb.collection('bookings').doc(bookingId).set({
        ...firestoreUpdate,
        refundedByAdminUid: adminUid,
      }, { merge: true });

      const telText = [
        paypalRefund
          ? '💸 <b>환불 완료 (PayPal API 자동)</b>'
          : '💸 <b>환불 완료 (PayPal 수동 처리)</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>환불액:</b> ₩${refundKrw.toLocaleString('ko-KR')}`,
        `<b>이메일:</b> ${pending.customerEmail}`,
        paypalRefund ? `<b>PayPal refund:</b> <code>${paypalRefund.id}</code>` : null,
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
      return res.end(JSON.stringify({
        ok: true,
        data: {
          bookingRef,
          status: 'REFUNDED',
          refundedKRW: refundKrw,
          refundSource: paypalRefund ? 'paypal-api' : 'manual',
          ...(paypalRefund ? { refundID: paypalRefund.id } : {}),
        },
      }));
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
