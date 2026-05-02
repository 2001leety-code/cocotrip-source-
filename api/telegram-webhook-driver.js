/**
 * Vercel API Route: Driver Telegram Bot Webhook
 * POST /api/telegram-webhook-driver
 *
 * 기사용 텔레그램 봇이 받는 모든 메시지/콜백의 진입점.
 * Phase 1 (현재): Echo + 기본 명령어 (/start, /help, /id)
 * Phase 2 (TODO): /accept, /reject 명령으로 dispatch 응답
 *
 * ENV:
 *   TELEGRAM_DRIVER_BOT_TOKEN     — BotFather에서 발급받은 기사용 봇 토큰
 *   TELEGRAM_WEBHOOK_SECRET       — webhook 등록 시 secret_token (위조 방지)
 *
 * Webhook 등록: scripts/setup-telegram-webhooks.cjs 참고.
 */
import { callBot, sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'driver';

const HELP_TEXT = `<b>CocoTrip 기사용 봇</b>

이 봇은 배차 요청 수락/거절을 위해 사용됩니다.

<b>명령어</b>
/start  — 봇 사용 시작
/help   — 도움말
/id     — 내 chat_id 확인 (관리자에게 등록 시 필요)

<b>배차 흐름 (Phase 2 예정)</b>
1. 관리자가 배차 메시지 발송
2. [수락] / [거절] 버튼 클릭
3. 10분 무응답 시 자동 거절 + 정보 파기`;

export default async function handler(req, res) {
  // Telegram은 항상 POST
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  // 1. webhook secret 검증
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!verifyWebhookSecret(req, secret)) {
    console.warn(`[${BOT_TAG}-webhook] invalid secret token`);
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  // 2. 봇 토큰 확인
  const botToken = process.env.TELEGRAM_DRIVER_BOT_TOKEN;
  if (!botToken) {
    console.error(`[${BOT_TAG}-webhook] TELEGRAM_DRIVER_BOT_TOKEN not configured`);
    res.status(500).json({ ok: false, error: 'bot not configured' });
    return;
  }

  // 3. update 파싱
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const parsed = parseUpdate(body || {});

  if (!parsed || !parsed.chatId) {
    // 메시지 없는 update (예: chat_member 변경) — 무시
    res.status(200).json({ ok: true });
    return;
  }

  console.log(`[${BOT_TAG}-webhook] update from`, parsed.chatId, '| cmd:', parsed.command, '| text:', parsed.text?.slice(0, 60));

  try {
    await routeCommand(botToken, parsed);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] handler error:`, err);
    // Telegram에 200 반환 — 그렇지 않으면 같은 update를 재시도하여 무한 루프 발생
    res.status(200).json({ ok: false, error: err.message });
  }
}

async function routeCommand(botToken, p) {
  // 콜백 쿼리 (인라인 키보드 버튼 클릭) — Phase 2에서 /accept, /reject로 라우팅
  if (p.isCallback) {
    await callBot(botToken, 'answerCallbackQuery', {
      callback_query_id: p.callbackId,
      text: '아직 구현되지 않은 기능입니다.',
    });
    return;
  }

  switch (p.command) {
    case '/start':
      await sendBotMessage(botToken, p.chatId,
        `안녕하세요, CocoTrip 기사용 봇입니다.\n` +
        `먼저 <code>/id</code> 명령어로 본인 chat_id를 확인 후\n` +
        `관리자에게 등록을 요청해 주세요.\n\n` +
        `자세한 사용법: /help`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/id':
      await sendBotMessage(botToken, p.chatId,
        `<b>내 chat_id</b>\n<code>${p.chatId}</code>\n\n` +
        `이 ID를 관리자(태연님)에게 전달해 주세요.\n` +
        `Firestore drivers 컬렉션에 등록되어야 배차 메시지를 받을 수 있습니다.`);
      break;

    default:
      // Echo (Phase 1) — 메시지 그대로 반환하여 webhook 동작 확인
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `Echo: ${p.text}\n\n명령어를 사용하시려면 /help`);
      }
  }
}
