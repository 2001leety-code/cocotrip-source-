/**
 * Vercel API Route: Admin Telegram Bot Webhook
 * POST /api/telegram-webhook-admin
 *
 * 관리자(태연님) 텔레그램 봇이 받는 모든 메시지/콜백의 진입점.
 *
 * 명령:
 *   /start /help /id /status — Phase 1
 *   /drivers                  — 등록된 기사 목록
 *   /dispatch <orderID> <chatId> — 특정 기사에게 배차 발송
 *
 * 보안:
 *   - X-Telegram-Bot-Api-Secret-Token 헤더 검증
 *   - 어드민 chat_id (TELEGRAM_CHAT_ID) 외 다른 chat_id는 침묵 무시
 *
 * ENV:
 *   TELEGRAM_ADMIN_BOT_TOKEN    — 관리자용 봇 토큰 (없으면 TELEGRAM_BOT_TOKEN 폴백)
 *   TELEGRAM_DRIVER_BOT_TOKEN   — 기사봇 토큰 (dispatch 발송 시 필요)
 *   TELEGRAM_CHAT_ID            — 태연님 chat_id (인가 검증)
 *   TELEGRAM_WEBHOOK_SECRET     — webhook 검증
 */
import { callBot, sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { sweepExpiredDispatches, computeExpiryDate } from './_shared/dispatch-sweep.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'admin';

const HELP_TEXT = `<b>CocoTrip 관리자 봇</b>

<b>기본</b>
/start  /help  /id  /status

<b>기사 관리</b>
/drivers
  → 등록된 기사 목록
/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle]
  → 새 기사 등록 (vehicle 생략 가능)
/driver_remove &lt;chatId&gt;
  → 기사 등록 해제
/driver_off &lt;chatId&gt;
  → 기사 비활성화 (active=false, 명단엔 남음)
/driver_on &lt;chatId&gt;
  → 기사 재활성화

<b>배차</b>
/dispatch &lt;orderID&gt; &lt;driverChatId&gt;
  → 해당 예약을 기사에게 배차 발송 (인라인 키보드)

<b>예시</b>
<code>/driver_add 1234567890 김기사 스타리아1호</code>
<code>/dispatch CT-20260502-123 1234567890</code>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  if (!verifyWebhookSecret(req, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    console.warn(`[${BOT_TAG}-webhook] invalid secret token`);
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error(`[${BOT_TAG}-webhook] no bot token configured`);
    res.status(500).json({ ok: false, error: 'bot not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const parsed = parseUpdate(body || {});

  if (!parsed || !parsed.chatId) {
    res.status(200).json({ ok: true });
    return;
  }

  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (adminChatId && String(parsed.chatId) !== String(adminChatId)) {
    console.warn(`[${BOT_TAG}-webhook] unauthorized chat_id:`, parsed.chatId);
    res.status(200).json({ ok: true });
    return;
  }

  console.log(`[${BOT_TAG}-webhook] cmd:`, parsed.command, '| text:', parsed.text?.slice(0, 60));

  // Lazy expiry: 매 어드민 활동마다 만료된 dispatch_messages 정리
  // (Vercel Hobby cron 1일 1회 제약 회피).
  try {
    await sweepExpiredDispatches({
      driverBotToken: process.env.TELEGRAM_DRIVER_BOT_TOKEN,
      adminBotToken: botToken,
      adminChatId: parsed.chatId,
    });
  } catch (err) {
    console.warn(`[${BOT_TAG}-webhook] sweep 실패 (무시):`, err.message);
  }

  try {
    await routeCommand(botToken, parsed);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] handler error:`, err);
    // 핸들러 에러를 사용자에게도 표시 (관리자만 받으므로 안전)
    try {
      await sendBotMessage(botToken, parsed.chatId, `오류: ${err.message}`);
    } catch {}
    res.status(200).json({ ok: false, error: err.message });
  }
}

async function routeCommand(botToken, p) {
  if (p.isCallback) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '관리자봇은 콜백 사용 안 함',
    });
    return;
  }

  switch (p.command) {
    case '/start':
      await sendBotMessage(botToken, p.chatId,
        `CocoTrip 관리자 봇입니다.\n\n` +
        `/help 로 명령어 목록 확인.`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/id':
      await sendBotMessage(botToken, p.chatId,
        `<b>내 chat_id</b>\n<code>${p.chatId}</code>`);
      break;

    case '/status':
      await sendBotMessage(botToken, p.chatId,
        `<b>시스템 상태</b>\n` +
        `봇 webhook: 정상\n` +
        `Phase: 2 (dispatch)\n` +
        `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
      break;

    case '/drivers':
      await handleDriversCommand(botToken, p);
      break;

    case '/driver_add':
      await handleDriverAdd(botToken, p);
      break;

    case '/driver_remove':
      await handleDriverRemove(botToken, p);
      break;

    case '/driver_off':
      await handleDriverActive(botToken, p, false);
      break;

    case '/driver_on':
      await handleDriverActive(botToken, p, true);
      break;

    case '/dispatch':
      await handleDispatchCommand(botToken, p);
      break;

    default:
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `Echo: ${p.text}\n\n명령어를 사용하시려면 /help`);
      }
  }
}

async function handleDriversCommand(botToken, p) {
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const snap = await db.collection('drivers').get();
  if (snap.empty) {
    await sendBotMessage(botToken, p.chatId,
      `등록된 기사 없음.\n\n` +
      `등록 방법:\n` +
      `1. 기사가 기사봇에 /id 입력 후 chat_id 확인\n` +
      `2. <code>/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle]</code>`);
    return;
  }

  const lines = [`<b>등록된 기사 (${snap.size}명)</b>\n`];
  snap.forEach((doc) => {
    const d = doc.data();
    const status = d.active === false ? '⏸ 비활성' : '✓ 활성';
    lines.push(`<code>${doc.id}</code> · ${d.name || '?'} · ${d.vehicle || '?'} · ${status}`);
  });
  await sendBotMessage(botToken, p.chatId, lines.join('\n'));
}

// /driver_add <chatId> <name> [vehicle...]
async function handleDriverAdd(botToken, p) {
  if (p.args.length < 2) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/driver_add &lt;chatId&gt; &lt;name&gt; [vehicle]</code>\n` +
      `예: <code>/driver_add 1234567890 김기사 스타리아1호</code>`);
    return;
  }

  const [chatId, name, ...vehicleParts] = p.args;
  if (!/^\d+$/.test(chatId)) {
    await sendBotMessage(botToken, p.chatId, `chatId는 숫자만 가능합니다: <code>${chatId}</code>`);
    return;
  }
  const vehicle = vehicleParts.join(' ').trim();

  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const existing = await ref.get();
  if (existing.exists) {
    await sendBotMessage(botToken, p.chatId,
      `이미 등록된 기사입니다: <code>${chatId}</code>\n` +
      `정보 수정은 <code>/driver_remove</code> 후 다시 등록 또는 Firestore Console에서 직접.`);
    return;
  }

  await ref.set({
    chatId: Number(chatId),
    name,
    vehicle: vehicle || '',
    active: true,
    registeredAt: new Date(),
  });

  await sendBotMessage(botToken, p.chatId,
    `✓ 기사 등록 완료\n` +
    `chatId: <code>${chatId}</code>\n` +
    `이름: ${name}\n` +
    (vehicle ? `차량: ${vehicle}\n` : '') +
    `\n이제 기사봇으로 배차 메시지를 받을 수 있습니다.`);
}

// /driver_remove <chatId>
async function handleDriverRemove(botToken, p) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId, `사용법: <code>/driver_remove &lt;chatId&gt;</code>`);
    return;
  }

  const [chatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const doc = await ref.get();
  if (!doc.exists) {
    await sendBotMessage(botToken, p.chatId, `등록되지 않은 chatId: <code>${chatId}</code>`);
    return;
  }

  const data = doc.data();
  await ref.delete();

  await sendBotMessage(botToken, p.chatId,
    `✓ 기사 삭제 완료\n` +
    `<code>${chatId}</code> · ${data?.name || '?'}`);
}

// /driver_off <chatId> 또는 /driver_on <chatId>
async function handleDriverActive(botToken, p, active) {
  if (p.args.length < 1) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>${active ? '/driver_on' : '/driver_off'} &lt;chatId&gt;</code>`);
    return;
  }

  const [chatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  const ref = db.collection('drivers').doc(chatId);
  const doc = await ref.get();
  if (!doc.exists) {
    await sendBotMessage(botToken, p.chatId, `등록되지 않은 chatId: <code>${chatId}</code>`);
    return;
  }

  await ref.update({ active });

  const data = doc.data();
  await sendBotMessage(botToken, p.chatId,
    `${active ? '✓ 활성화' : '⏸ 비활성화'} 완료\n` +
    `<code>${chatId}</code> · ${data?.name || '?'}`);
}

async function handleDispatchCommand(botToken, p) {
  const driverBotToken = process.env.TELEGRAM_DRIVER_BOT_TOKEN;
  if (!driverBotToken) {
    await sendBotMessage(botToken, p.chatId,
      `오류: TELEGRAM_DRIVER_BOT_TOKEN 미설정.\n` +
      `Vercel 환경변수에 기사봇 토큰을 추가해 주세요.`);
    return;
  }

  if (p.args.length < 2) {
    await sendBotMessage(botToken, p.chatId,
      `사용법: <code>/dispatch &lt;orderID&gt; &lt;driverChatId&gt;</code>\n` +
      `예: <code>/dispatch CT-20260502-123 1234567890</code>`);
    return;
  }

  const [orderID, driverChatId] = p.args;
  const db = initAdminDb('telegram-admin');
  if (!db) throw new Error('Firestore unavailable');

  // 1. 예약 조회
  const bookingDoc = await db.collection('bookings').doc(orderID).get();
  if (!bookingDoc.exists) {
    await sendBotMessage(botToken, p.chatId, `예약을 찾을 수 없습니다: <code>${orderID}</code>`);
    return;
  }
  const booking = bookingDoc.data();

  // 2. 기사 조회
  const driverDoc = await db.collection('drivers').doc(driverChatId).get();
  if (!driverDoc.exists) {
    await sendBotMessage(botToken, p.chatId,
      `기사를 찾을 수 없습니다: <code>${driverChatId}</code>\n` +
      `<code>/drivers</code> 로 등록된 기사 확인`);
    return;
  }
  const driver = driverDoc.data();

  if (driver.active === false) {
    await sendBotMessage(botToken, p.chatId, `기사가 비활성 상태입니다: ${driver.name}`);
    return;
  }

  // 3. 기사봇으로 배차 메시지 발송 (인라인 키보드)
  const dispatchText =
    `<b>새 배차 요청</b>\n` +
    `예약번호: <code>${orderID}</code>\n` +
    `상품: ${booking.productType || '-'}\n` +
    `날짜: ${booking.tourDate || '-'}\n` +
    `인원: ${booking.paxCount || '?'}명\n` +
    `픽업: ${booking.pickupLocation || '-'}\n` +
    (booking.dropoffLocation ? `드롭오프: ${booking.dropoffLocation}\n` : '') +
    (booking.memo ? `\n메모: ${booking.memo}\n` : '') +
    `\n10분 내 응답 부탁드립니다.`;

  const sent = await callBot(driverBotToken, 'sendMessage', {
    chat_id: Number(driverChatId),
    text: dispatchText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✓ 수락', callback_data: `accept:${orderID}` },
        { text: '✗ 거절', callback_data: `reject:${orderID}` },
      ]],
    },
  });

  // 4. dispatch_messages 로그 기록
  const msgId = `${orderID}_${driverChatId}`;
  const sentAt = new Date();
  await db.collection('dispatch_messages').doc(msgId).set({
    orderID,
    driverChatId: Number(driverChatId),
    driverName: driver.name || '',
    driverVehicle: driver.vehicle || '',
    status: 'sent',
    telegramMessageId: sent.result?.message_id || null,
    sentAt: FieldValue.serverTimestamp(),
    expiresAt: computeExpiryDate(sentAt),  // sentAt + 10분
  });

  // 5. bookings에 dispatch 기록 (아직 accepted는 아님)
  await db.collection('bookings').doc(orderID).update({
    dispatchedAt: FieldValue.serverTimestamp(),
    dispatchedTo: { chatId: Number(driverChatId), name: driver.name || '' },
    updatedAt: FieldValue.serverTimestamp(),
  });

  await sendBotMessage(botToken, p.chatId,
    `✓ 배차 발송 완료\n` +
    `예약: <code>${orderID}</code>\n` +
    `기사: ${driver.name} (${driver.vehicle || '-'})\n` +
    `메시지ID: ${sent.result?.message_id || '-'}\n\n` +
    `기사 응답을 기다리는 중...`);
}
