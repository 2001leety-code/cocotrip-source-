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
import { sweepExpiredDispatches } from './_shared/dispatch-sweep.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'driver';

const HELP_TEXT = `<b>CocoTrip 기사용 봇</b>

<i>📖 처음이면: <code>/설명</code> 입력 (역할 + 등록 절차 + 배차 흐름)</i>

이 봇은 배차 요청 수락/거절을 위해 사용됩니다.

<b>명령어 (영문 또는 한글)</b>
/start    또는  시작
/help     또는  도움말 / 도움 / 사용법
/explain  또는  설명 / 가이드 / 매뉴얼
/id       또는  내아이디 / 아이디

<b>배차 흐름</b>
1. 관리자가 배차 메시지 발송
2. [✓ 수락] / [✗ 거절] 버튼 클릭
3. 10분 무응답 시 자동 거절 + 정보 파기

<b>최초 등록</b>
1. <code>아이디</code> 또는 /id 입력
2. 표시되는 chat_id를 관리자(태연님)에게 전달
3. 등록 완료 후 배차 메시지 수신 가능`;

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

  // Lazy expiry sweep — 콜백 처리 전에 만료된 메시지 정리
  // (Vercel Hobby cron 1일 1회 제약 회피)
  try {
    await sweepExpiredDispatches({
      driverBotToken: botToken,
      adminBotToken: process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_CHAT_ID,
    });
  } catch (err) {
    console.warn(`[${BOT_TAG}-webhook] sweep 실패 (무시):`, err.message);
  }

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

// 한글 텍스트 → 슬래시 명령 매핑 (기사봇 — 한국 기사 다수)
const DRIVER_KOREAN_ALIASES = [
  { re: /^(시작|스타트)$/, cmd: '/start' },
  { re: /^(도움|도움말|헬프|명령|명령어|사용법)$/, cmd: '/help' },
  { re: /^(설명|가이드|매뉴얼|운영가이드|운영 가이드|역할)$/, cmd: '/explain' },
  { re: /^(내아이디|아이디|내 아이디|내id|내ID)$/, cmd: '/id' },
];

// 기사봇 역할 설명 — 운영 가이드 다시 보려면 /설명
const DRIVER_EXPLAIN_TEXT = `<b>📖 Driver_Chat 봇 가이드</b>

<b>1. 이 봇의 역할</b>
🚗 CocoTrip 기사 전용 봇입니다.
배차 요청을 [✓ 수락] / [✗ 거절] 버튼으로 응답하는 곳.

<b>2. 등록 절차 (최초 1회)</b>
1) 이 봇에서 <code>아이디</code> 또는 <code>/id</code> 입력
2) 봇이 내 chat_id를 알려줌 (예: 1234567890)
3) 그 chat_id를 관리자(태연님)에게 카톡/문자로 전달
4) 관리자가 등록하면 배차 메시지 받기 시작

<b>3. 배차 받기 흐름</b>
1) 관리자가 배차 발송 → 이 봇에 메시지 도착
2) [✓ 수락] / [✗ 거절] 버튼 클릭
3) <b>10분 무응답 시 자동 거절</b> + 정보 자동 삭제
4) 수락 시 → 관리자에게 즉시 알림, 본인 일정 확정

<b>4. 자주 쓰는 명령</b>
<code>/start</code> 또는 <code>시작</code>
<code>/help</code> 또는 <code>도움말</code>
<code>/id</code> 또는 <code>아이디</code>
<code>/설명</code> 또는 <code>설명</code> (이 가이드)

<b>5. 일반 문의는 어디로?</b>
이 봇은 배차 응답 전용입니다.
일반 문의·일정 조정은 카톡/전화로 관리자에게 직접 연락하세요.`;

function resolveDriverAlias(p) {
  if (p.command) return p;
  if (!p.text) return p;
  const trimmed = p.text.trim();
  for (const { re, cmd } of DRIVER_KOREAN_ALIASES) {
    if (re.test(trimmed)) {
      return { ...p, command: cmd, args: [] };
    }
  }
  return p;
}

async function routeCommand(botToken, p) {
  // 한글 별칭 변환
  p = resolveDriverAlias(p);

  switch (p.command) {
    case '/start':
      await sendBotMessage(botToken, p.chatId,
        `안녕하세요, CocoTrip 기사용 봇입니다.\n` +
        `<b>아이디</b> 또는 <code>/id</code> 입력 → 본인 chat_id 확인 후\n` +
        `관리자(태연님)에게 등록을 요청해 주세요.\n\n` +
        `사용법: <b>도움말</b> 또는 /help`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/explain':
      await sendBotMessage(botToken, p.chatId, DRIVER_EXPLAIN_TEXT);
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

  // 4. 어드민에게 알림 — dispatch 채널로 라우팅
  try {
    await notify('dispatch', `✓ 배차 수락\n${orderID} → ${dispatch.driverName}`);
  } catch (err) {
    console.warn('[driver-webhook] dispatch notify 실패:', err.message);
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

  // 4. 어드민에게 알림 — dispatch 채널로 라우팅
  try {
    await notify('dispatch', `✗ 배차 거절\n${orderID} ← ${dispatch.driverName}\n다른 기사에게 재배차 필요`);
  } catch (err) {
    console.warn('[driver-webhook] dispatch notify 실패:', err.message);
  }
}
