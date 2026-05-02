/**
 * Vercel API Route: Admin Telegram Bot Webhook
 * POST /api/telegram-webhook-admin
 *
 * 관리자(태연님) 텔레그램 봇이 받는 모든 메시지/콜백의 진입점.
 * Phase 1 (현재): Echo + 기본 명령어 (/start, /help, /id)
 * Phase 2 (TODO): /bookings (오늘 예약), /sales (매출), /dispatch (배차 발송)
 *
 * 보안:
 *   - 어드민 chat_id (TELEGRAM_CHAT_ID) 외 다른 chat_id에서 온 요청은 무시
 *
 * ENV:
 *   TELEGRAM_ADMIN_BOT_TOKEN  — 관리자용 봇 토큰
 *                               (기존 TELEGRAM_BOT_TOKEN 재사용 가능 — 폴백 처리)
 *   TELEGRAM_CHAT_ID          — 태연님 개인 chat_id (인가 검증용)
 *   TELEGRAM_WEBHOOK_SECRET   — webhook 등록 시 secret_token
 */
import { callBot, sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'admin';

const HELP_TEXT = `<b>CocoTrip 관리자 봇</b>

<b>명령어</b>
/start    — 봇 사용 시작
/help     — 도움말
/id       — 내 chat_id 확인
/status   — 시스템 상태 (예정)

<b>Phase 2 예정</b>
/bookings — 오늘 예약 조회
/sales    — 이번 달 매출
/dispatch CT-XXXXXXXX-XXX — 배차 발송`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!verifyWebhookSecret(req, secret)) {
    console.warn(`[${BOT_TAG}-webhook] invalid secret token`);
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  // 기존 outbound TELEGRAM_BOT_TOKEN 재사용 폴백 — 별도 봇 안 만든 경우
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

  // 인가 검증: ADMIN chat_id 외 요청 거부 (echo도 안 함 — 정보 누출 방지)
  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (adminChatId && String(parsed.chatId) !== String(adminChatId)) {
    console.warn(`[${BOT_TAG}-webhook] unauthorized chat_id:`, parsed.chatId);
    // 침묵 — 응답 없이 200으로 종료
    res.status(200).json({ ok: true });
    return;
  }

  console.log(`[${BOT_TAG}-webhook] cmd:`, parsed.command, '| text:', parsed.text?.slice(0, 60));

  try {
    await routeCommand(botToken, parsed);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] handler error:`, err);
    res.status(200).json({ ok: false, error: err.message });
  }
}

async function routeCommand(botToken, p) {
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
        `CocoTrip 관리자 봇이 활성화되었습니다.\n\n` +
        `현재 Phase 1 (echo 모드).\nPhase 2에서 /bookings, /sales, /dispatch 명령 지원 예정.\n\n` +
        `사용법: /help`);
      break;

    case '/help':
      await sendBotMessage(botToken, p.chatId, HELP_TEXT);
      break;

    case '/id':
      await sendBotMessage(botToken, p.chatId,
        `<b>내 chat_id</b>\n<code>${p.chatId}</code>\n\n` +
        `현재 TELEGRAM_CHAT_ID 환경변수와 일치 확인됨.`);
      break;

    case '/status':
      await sendBotMessage(botToken, p.chatId,
        `<b>시스템 상태</b>\n` +
        `봇 webhook: 정상\n` +
        `Phase: 1 (echo)\n` +
        `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
      break;

    default:
      if (p.text) {
        await sendBotMessage(botToken, p.chatId,
          `Echo: ${p.text}\n\n명령어를 사용하시려면 /help`);
      }
  }
}
