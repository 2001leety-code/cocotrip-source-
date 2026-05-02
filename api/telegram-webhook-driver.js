/**
 * Vercel API Route: Driver Telegram Bot Webhook
 * POST /api/telegram-webhook-driver
 *
 * 기사용 텔레그램 봇이 받는 모든 메시지/콜백의 진입점.
 *
 * 명령:
 *   /start /help /id — 기본
 *
 * 콜백 (인라인 키보드 버튼):
 *   accept:<orderID>  — 배차 수락 → bookings + dispatch_messages 갱신
 *   reject:<orderID>  — 배차 거절 → 메시지 PII 제거 + 로그
 *
 * ENV:
 *   TELEGRAM_DRIVER_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET
 */
import { callBot, sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'driver';

const HELP_TEXT = `<b>CocoTrip 기사용 봇</b>

이 봇은 배차 요청 수락/거절을 위해 사용됩니다.

<b>명령어</b>
/start  — 봇 사용 시작
/help   — 도움말
/id     — 내 chat_id 확인 (관리자 등록 시 필요)

<b>배차 흐름</b>
1. 관리자가 배차 메시지 발송
2. [수락] / [거절] 버튼 클릭
3. 10분 무응답 시 자동 거절 + 정보 파기 (예정)`;

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

  const botToken = process.env.TELEGRAM_DRIVER_BOT_TOKEN;
  if (!botToken) {
    console.error(`[${BOT_TAG}-webhook] TELEGRAM_DRIVER_BOT_TOKEN not configured`);
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

  console.log(`[${BOT_TAG}-webhook] chat:`, parsed.chatId, '| cmd:', parsed.command, '| cb:', parsed.callbackData);

  try {
    if (parsed.isCallback) {
      await handleCallback(botToken, parsed);
    } else {
      await routeCommand(botToken, parsed);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] handler error:`, err);
    res.status(200).json({ ok: false, error: err.message });
  }
}

async function routeCommand(botToken, p) {
  switch (p.command) {
    case '/start':
      await sendBotMessage(botToken, p.chatId,
        `안녕하세요, CocoTrip 기사용 봇입니다.\n` +
        `<code>/id</code> 로 본인 chat_id 확인 후\n` +
        `관리자에게 등록을 요청해 주세요.\n\n` +
        `자세한 사용법: /help`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/id':
      await sendBotMessage(botToken, p.chatId,
        `<b>내 chat_id</b>\n<code>${p.chatId}</code>\n\n` +
        `이 ID를 관리자(태연님)에게 전달해 주세요.`);
      break;

    default:
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `명령어를 사용해 주세요: /help`);
      }
  }
}

/**
 * 인라인 키보드 콜백 처리.
 * callback_data 형식: "accept:CT-20260502-123" 또는 "reject:CT-20260502-123"
 */
async function handleCallback(botToken, p) {
  const [action, orderID] = (p.callbackData || '').split(':');
  if (!action || !orderID) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '잘못된 콜백',
    });
    return;
  }

  const db = initAdminDb('telegram-driver');
  if (!db) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: 'DB 오류 — 잠시 후 재시도',
    });
    return;
  }

  const msgKey = `${orderID}_${p.chatId}`;
  const dispatchRef = db.collection('dispatch_messages').doc(msgKey);
  const dispatchSnap = await dispatchRef.get();

  if (!dispatchSnap.exists) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '만료된 배차 요청입니다',
    });
    return;
  }

  const dispatch = dispatchSnap.data();

  // 이미 응답한 메시지면 재처리 방지 (Telegram이 같은 콜백을 재전송하는 케이스)
  if (dispatch.status !== 'sent') {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: `이미 ${dispatch.status === 'accepted' ? '수락' : '거절'}됨`,
    });
    return;
  }

  if (action === 'accept') {
    await handleAccept(botToken, p, dispatchRef, dispatch, orderID);
  } else if (action === 'reject') {
    await handleReject(botToken, p, dispatchRef, dispatch, orderID);
  } else {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '알 수 없는 액션',
    });
  }
}

async function handleAccept(botToken, p, dispatchRef, dispatch, orderID) {
  const db = initAdminDb('telegram-driver');

  // 1. dispatch_messages 상태 갱신
  await dispatchRef.update({
    status: 'accepted',
    respondedAt: FieldValue.serverTimestamp(),
  });

  // 2. bookings에 기사 배정 확정
  await db.collection('bookings').doc(orderID).update({
    driver: dispatch.driverName,
    driverChatId: dispatch.driverChatId,
    vehicleType: dispatch.driverVehicle || null,
    acceptedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 3. 기사에게 토스트 + 메시지 편집 (버튼 제거 후 확정 텍스트만 남김)
  await callBot(botToken, 'answerCallbackQuery', {
    callback_query_id: p.callbackId,
    text: '배차 수락 완료',
  });

  if (dispatch.telegramMessageId) {
    try {
      await callBot(botToken, 'editMessageText', {
        chat_id: p.chatId,
        message_id: dispatch.telegramMessageId,
        text:
          `<b>✓ 배차 수락 완료</b>\n` +
          `예약번호: <code>${orderID}</code>\n` +
          `상태: 운행 예정\n\n` +
          `당일 정시에 픽업 장소에서 대기해 주세요.`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.warn('[driver-webhook] editMessageText 실패 (무시):', err.message);
    }
  }

  // 4. 어드민에게 알림 (외부 _telegram.js 모듈 — 별도 outbound bot)
  try {
    const adminToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChat = process.env.TELEGRAM_CHAT_ID;
    if (adminToken && adminChat) {
      await callBot(adminToken, 'sendMessage', {
        chat_id: adminChat,
        text: `✓ 배차 수락\n${orderID} → ${dispatch.driverName}`,
        parse_mode: 'HTML',
      });
    }
  } catch (err) {
    console.warn('[driver-webhook] admin notify 실패:', err.message);
  }
}

async function handleReject(botToken, p, dispatchRef, dispatch, orderID) {
  // 1. dispatch_messages 상태 갱신
  await dispatchRef.update({
    status: 'rejected',
    respondedAt: FieldValue.serverTimestamp(),
  });

  // 2. 콜백 응답
  await callBot(botToken, 'answerCallbackQuery', {
    callback_query_id: p.callbackId,
    text: '거절 처리됨',
  });

  // 3. 메시지 편집 — PII (예약 정보) 제거, 거절 사실만 남김
  if (dispatch.telegramMessageId) {
    try {
      await callBot(botToken, 'editMessageText', {
        chat_id: p.chatId,
        message_id: dispatch.telegramMessageId,
        text: `<b>✗ 배차 거절</b>\n예약번호: <code>${orderID}</code>\n\n고객 정보는 파기되었습니다.`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.warn('[driver-webhook] editMessageText 실패 (무시):', err.message);
    }
  }

  // 4. 어드민에게 알림
  try {
    const adminToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChat = process.env.TELEGRAM_CHAT_ID;
    if (adminToken && adminChat) {
      await callBot(adminToken, 'sendMessage', {
        chat_id: adminChat,
        text: `✗ 배차 거절\n${orderID} ← ${dispatch.driverName}\n다른 기사에게 재배차 필요`,
        parse_mode: 'HTML',
      });
    }
  } catch (err) {
    console.warn('[driver-webhook] admin notify 실패:', err.message);
  }
}
