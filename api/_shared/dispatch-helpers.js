/**
 * Dispatch helpers — driver bot 배차 메시지 발송 공통 로직.
 *
 * 기존 admin /dispatch 핸들러 (telegram-webhook-admin.js) 의 로직을 추출해
 * booking-processor (결제 직후 자동 배차) 에서도 재사용할 수 있게 함.
 *
 * 흐름 (기존 admin /dispatch 와 동일):
 *   1. driver bot 으로 [✓ 수락] / [✗ 거절] 인라인 키보드 메시지 발송
 *   2. dispatch_messages/{orderID}_{driverChatId} 로그 기록 (status='sent', expiresAt=+10분)
 *   3. bookings/{orderID} 에 dispatchedAt / dispatchedTo 기록
 *
 * 콜백 처리는 telegram-webhook-driver.js 의 handleAccept / handleReject 가 담당.
 *
 * 호출처:
 *   - api/telegram-webhook-admin.js (/dispatch 명령) — 직접 인라인 (legacy)
 *   - api/booking-processor.js (자동 배차 broadcast, 옵션) — broadcastDispatchToDrivers
 */
import { callBot } from './telegram-bot.js';
import { initAdminDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { computeExpiryDate } from './dispatch-sweep.js';

/**
 * 배차 메시지 텍스트 빌드 — admin /dispatch 와 동일한 포맷.
 */
function buildDispatchText(orderID, booking) {
  const productLabel = booking.product || booking.productType || '-';
  return (
    `<b>새 배차 요청</b>\n` +
    `예약번호: <code>${orderID}</code>\n` +
    `상품: ${productLabel}\n` +
    `날짜: ${booking.tourDate || '-'}\n` +
    `인원: ${booking.paxCount || '?'}명\n` +
    `픽업: ${booking.pickupLocation || '-'}\n` +
    (booking.dropoffLocation ? `드롭오프: ${booking.dropoffLocation}\n` : '') +
    (booking.memo ? `\n메모: ${booking.memo}\n` : '') +
    `\n10분 내 응답 부탁드립니다.`
  );
}

/**
 * 단일 기사에게 인라인 키보드 배차 발송 + dispatch_messages 기록.
 *
 * @param {object} opts
 * @param {string} opts.orderID — bookings 도큐먼트 ID
 * @param {object} opts.booking — booking 데이터 (product/tourDate/paxCount/pickupLocation/...)
 * @param {string|number} opts.driverChatId — 기사 chat_id
 * @param {object} [opts.driver] — drivers/{chatId} 도큐먼트 데이터 (name/vehicle). 없으면 fetch.
 * @param {string} [opts.driverBotToken] — 기사봇 토큰 (없으면 env)
 * @returns {Promise<{ ok: boolean, messageId?: number, error?: string }>}
 */
export async function sendDispatchToDriver(opts) {
  const {
    orderID,
    booking,
    driverChatId,
    driver: driverHint,
    driverBotToken: tokenOverride,
  } = opts;

  if (!orderID || !booking || !driverChatId) {
    return { ok: false, error: 'orderID/booking/driverChatId required' };
  }

  const driverBotToken = tokenOverride || process.env.TELEGRAM_DRIVER_BOT_TOKEN;
  if (!driverBotToken) {
    return { ok: false, error: 'TELEGRAM_DRIVER_BOT_TOKEN missing' };
  }

  const db = initAdminDb('dispatch-helpers');
  if (!db) return { ok: false, error: 'firestore unavailable' };

  // driver 정보 — hint 없으면 fetch (active=false 기사는 발송 스킵)
  let driver = driverHint;
  if (!driver) {
    const snap = await db.collection('drivers').doc(String(driverChatId)).get();
    if (!snap.exists) return { ok: false, error: `driver not registered: ${driverChatId}` };
    driver = snap.data();
  }
  if (driver.active === false) {
    return { ok: false, error: `driver inactive: ${driverChatId}` };
  }

  // 1. 인라인 키보드 메시지 발송
  const text = buildDispatchText(orderID, booking);
  let sent;
  try {
    sent = await callBot(driverBotToken, 'sendMessage', {
      chat_id: Number(driverChatId),
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✓ 수락', callback_data: `accept:${orderID}` },
          { text: '✗ 거절', callback_data: `reject:${orderID}` },
        ]],
      },
    });
  } catch (err) {
    return { ok: false, error: `sendMessage failed: ${err.message}` };
  }

  // 2. dispatch_messages 로그
  const msgKey = `${orderID}_${driverChatId}`;
  const sentAt = new Date();
  await db.collection('dispatch_messages').doc(msgKey).set({
    orderID,
    driverChatId: Number(driverChatId),
    driverName: driver.name || '',
    driverVehicle: driver.vehicle || '',
    status: 'sent',
    telegramMessageId: sent.result?.message_id || null,
    sentAt: FieldValue.serverTimestamp(),
    expiresAt: computeExpiryDate(sentAt),
  });

  return { ok: true, messageId: sent.result?.message_id || null };
}

/**
 * 활성 기사 전원에게 배차 broadcast — first-to-accept wins.
 *
 * 두 번째 이후로 응답하는 기사는 driver-webhook의 status guard 에 의해
 * "이미 수락/거절됨" 토스트만 받음 (status !== 'sent' 체크).
 *
 * 부분 실패 허용 — 일부 기사 발송 실패해도 나머지는 계속 발송.
 *
 * @param {object} opts
 * @param {string} opts.orderID
 * @param {object} opts.booking
 * @param {string} [opts.driverBotToken]
 * @returns {Promise<{ ok: boolean, sent: number, failed: number, errors: string[] }>}
 */
export async function broadcastDispatchToDrivers(opts) {
  const { orderID, booking, driverBotToken } = opts;
  const db = initAdminDb('dispatch-helpers');
  if (!db) return { ok: false, sent: 0, failed: 0, errors: ['firestore unavailable'] };

  const driversSnap = await db.collection('drivers').where('active', '==', true).get();
  if (driversSnap.empty) {
    // active 필드가 없는 기존 도큐먼트 호환 — 전체 fetch 후 active!==false 만 사용
    const allSnap = await db.collection('drivers').get();
    if (allSnap.empty) return { ok: true, sent: 0, failed: 0, errors: ['no drivers registered'] };
    const docs = allSnap.docs.filter((d) => d.data().active !== false);
    if (!docs.length) return { ok: true, sent: 0, failed: 0, errors: ['no active drivers'] };
    return await broadcastToDocs(orderID, booking, docs, driverBotToken, db);
  }

  return await broadcastToDocs(orderID, booking, driversSnap.docs, driverBotToken, db);
}

async function broadcastToDocs(orderID, booking, docs, driverBotToken, db) {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const doc of docs) {
    const driver = doc.data();
    const result = await sendDispatchToDriver({
      orderID,
      booking,
      driverChatId: doc.id,
      driver,
      driverBotToken,
    });
    if (result.ok) sent++;
    else {
      failed++;
      errors.push(`${doc.id}: ${result.error}`);
    }
  }

  // bookings 도큐먼트에 broadcast 시각 기록
  if (sent > 0) {
    try {
      await db.collection('bookings').doc(orderID).update({
        dispatchedAt: FieldValue.serverTimestamp(),
        dispatchBroadcast: { driversNotified: sent, attemptedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      errors.push(`bookings update: ${err.message}`);
    }
  }

  return { ok: sent > 0, sent, failed, errors };
}
