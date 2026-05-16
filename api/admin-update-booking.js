/**
 * POST /api/admin-update-booking
 *
 * 어드민 캘린더(/admin)에서 예약 카드 → "배차 상세" 폼 저장 시 호출.
 *
 * Action: 'dispatch'
 *   1. drivers/{driverChatId} 조회 + active=true 검증
 *   2. bookings/{orderID} 도큐먼트 update:
 *        - driverChatId, driverName, driverVehicle
 *        - dispatchMemo, actualEndAt, extraCost
 *        - dispatchedAt, dispatchedBy='admin'
 *   3. 기사봇으로 [수락/거절] 인라인 키보드 발송 (sendDispatchToDriver 재사용)
 *   4. 어드민 채널에 "✅ 배차 완료" 알림
 *
 * 기존 /api/admin-booking-action 과는 별도 endpoint:
 *   - admin-booking-action: pending_bookings (PayPal 결제 신고 매칭)
 *   - admin-update-booking: bookings (확정 예약의 배차/운영 필드 수정)
 *
 * Auth: Firebase Admin token (verifyAdminToken — ADMIN_EMAIL 매칭).
 *
 * Body:
 *   {
 *     orderID,            // 'CT-...' or 'MANUAL-...' (bookings doc ID)
 *     action: 'dispatch',
 *     driverChatId,       // 기사 chat_id (string)
 *     dispatchMemo,       // (옵션) 픽업 위치 / 특이사항
 *     actualEndAt,        // (옵션) ISO 8601 datetime — 운행 종료 시간
 *     extraCost,          // (옵션) 톨비/야간할증 등 (KRW)
 *   }
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { sendDispatchToDriver } from './_shared/dispatch-helpers.js';
import { notify } from './_shared/notify.js';
import { productDisplayLabel } from './_shared/pricing.js';
import { buildAdminJsonCors } from './_shared/cors.js';

export const config = { runtime: 'nodejs' };
export const maxDuration = 30;

// PR #437 (W-H11): per-request origin allowlist — was wildcard '*'.
const JSON_HEADERS_STATIC = { 'Cache-Control': 'no-store' };
const CORS_METHODS = 'POST, OPTIONS';

const VALID_ACTIONS = new Set(['dispatch']);

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

    const { orderID, action, driverChatId, dispatchMemo, actualEndAt, extraCost } = body;

    if (!orderID) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('orderID required', 'MISSING_ORDER_ID')));
    }
    if (!VALID_ACTIONS.has(action)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`Invalid action. Allowed: ${[...VALID_ACTIONS].join(', ')}`, 'INVALID_ACTION')));
    }

    const adminDb = initAdminDb('admin-update-booking');
    if (!adminDb) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    // ──────── Action: dispatch ─────────────────────────────────────────
    if (action === 'dispatch') {
      if (!driverChatId) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('driverChatId required', 'MISSING_DRIVER')));
      }
      if (!/^\d+$/.test(String(driverChatId))) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err('driverChatId must be numeric', 'INVALID_DRIVER')));
      }

      // 1. 예약 조회
      const bookingRef = adminDb.collection('bookings').doc(orderID);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        res.writeHead(404, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`bookings/${orderID} not found`, 'NOT_FOUND')));
      }
      const booking = bookingSnap.data();

      // 2. 기사 조회 (active=true 검증)
      const driverSnap = await adminDb.collection('drivers').doc(String(driverChatId)).get();
      if (!driverSnap.exists) {
        res.writeHead(404, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`driver ${driverChatId} not registered`, 'DRIVER_NOT_FOUND')));
      }
      const driver = driverSnap.data();
      if (driver.active === false) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify(_err(`driver inactive: ${driver.name || driverChatId}`, 'DRIVER_INACTIVE')));
      }

      // 3. bookings 도큐먼트 update
      const updates = {
        driverChatId: Number(driverChatId),
        driverName: driver.name || '',
        driverVehicle: driver.vehicle || '',
        driver: driver.name || '',          // 기존 필드 호환 (AdminCalendar 표시용)
        vehicleType: driver.vehicle || booking.vehicleType || '',
        dispatchedAt: FieldValue.serverTimestamp(),
        dispatchedBy: 'admin',
        dispatchedByUid: adminUid,
        dispatchedByEmail: adminEmail,
        dispatchedTo: { chatId: Number(driverChatId), name: driver.name || '' },
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (dispatchMemo != null) updates.dispatchMemo = String(dispatchMemo);
      if (actualEndAt) {
        try {
          updates.actualEndAt = new Date(actualEndAt);
        } catch (e) {
          // ISO 파싱 실패 시 string 그대로 저장 (admin UI 가 input type=datetime-local 사용)
          updates.actualEndAt = String(actualEndAt);
        }
      }
      if (extraCost != null) {
        const n = Number(extraCost);
        updates.extraCost = Number.isFinite(n) ? n : 0;
      }

      await bookingRef.update(updates);

      // 4. 기사봇으로 [수락/거절] 메시지 발송 (sendDispatchToDriver 재사용)
      // booking 데이터에 dispatchMemo 가 있으면 memo 필드에 합쳐서 전달
      const dispatchBooking = {
        ...booking,
        memo: [booking.memo, dispatchMemo].filter(Boolean).join(' / '),
      };
      const dispatchResult = await sendDispatchToDriver({
        orderID,
        booking: dispatchBooking,
        driverChatId: String(driverChatId),
        driver,
      });
      if (!dispatchResult.ok) {
        // 텔레그램 발송 실패해도 Firestore 업데이트는 이미 성공.
        // admin 에 명시적으로 에러 알림 (silent fail 금지).
        notify('error', `⚠️ 배차 텔레그램 발송 실패\n예약: <code>${orderID}</code>\n기사: ${driver.name} (<code>${driverChatId}</code>)\n사유: ${dispatchResult.error}`).catch(() => {});
        res.writeHead(207, JSON_HEADERS);
        return res.end(JSON.stringify({
          ok: true,
          partial: true,
          warning: `Firestore 업데이트 성공, 텔레그램 발송 실패: ${dispatchResult.error}`,
          data: { orderID, driverChatId, driverName: driver.name },
        }));
      }

      // 5. 어드민 채널 "✅ 배차 완료" 알림
      const productLabel = productDisplayLabel(booking.productType) || booking.productType || '-';
      const adminText = [
        '✅ <b>배차 완료</b>',
        '',
        `<b>예약:</b> <code>${orderID}</code>`,
        `<b>상품:</b> ${productLabel}`,
        `<b>날짜:</b> ${booking.tourDate || '-'}`,
        `<b>기사:</b> ${driver.name || '-'} (${driver.vehicle || '-'})`,
        dispatchMemo ? `<b>메모:</b> ${dispatchMemo}` : null,
        '',
        '기사 응답을 기다리는 중...',
      ].filter(Boolean).join('\n');
      notify('booking', adminText).catch(() => {});

      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: true,
        data: {
          orderID,
          driverChatId: Number(driverChatId),
          driverName: driver.name,
          driverVehicle: driver.vehicle,
          telegramMessageId: dispatchResult.messageId,
        },
      }));
    }

    // unreachable
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err('unhandled action', 'UNHANDLED')));
  } catch (err) {
    console.error('[admin-update-booking] failed:', err.message);
    await captureError(err, { route: '/api/admin-update-booking', method: req.method, adminEmail });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
