/**
 * CocoTripKR — Telegram Bot 공통 헬퍼 (멀티 봇 지원)
 *
 * 기존 api/_telegram.js 는 단일 outbound 알림 (TELEGRAM_BOT_TOKEN/CHAT_ID 고정).
 * 본 헬퍼는 webhook 기반 양방향 봇 (driver/admin) 처리에 사용.
 *
 * 사용처:
 *   - api/telegram-webhook-driver.js
 *   - api/telegram-webhook-admin.js
 */

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Telegram Bot API 호출.
 * @param {string} botToken - 각 봇의 BotFather 토큰
 * @param {string} method - sendMessage / answerCallbackQuery / editMessageText 등
 * @param {object} payload - method 별 파라미터
 */
export async function callBot(botToken, method, payload) {
  if (!botToken) throw new Error('botToken required');
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`[telegram-bot] ${method} failed:`, data);
    throw new Error(`Telegram ${method} failed: ${data.description || 'unknown'}`);
  }
  return data;
}

/**
 * 메시지 전송 헬퍼.
 */
export function sendBotMessage(botToken, chatId, text, options = {}) {
  return callBot(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || 'HTML',
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

/**
 * Webhook secret 검증 — Telegram이 webhook 설정 시 secret_token을 등록하면
 * 모든 update 요청 헤더에 X-Telegram-Bot-Api-Secret-Token 으로 동일 값 전송.
 * 일치하지 않으면 위조 요청 → 401 거부.
 *
 * @param {object} req - Vercel Request
 * @param {string} expectedSecret - process.env.TELEGRAM_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyWebhookSecret(req, expectedSecret) {
  if (!expectedSecret) {
    // 🔴 fail-CLOSED (prod): secret 미설정은 미스컨피그 — 프로덕션에선 거부한다(무인증 봇
    //   명령/배차 콜백 실행 차단). 이전엔 무조건 true(fail-open) → TELEGRAM_WEBHOOK_SECRET
    //   미설정 시 임의 Telegram 사용자가 admin/driver/inquiry webhook 을 무인증 호출 가능했음.
    //   dev/preview 만 스킵 허용(로컬 테스트 편의). 이 단일 변경이 3개 webhook 동시 보호.
    //   ⚠️ prod 인데 봇이 안 돌면 = TELEGRAM_WEBHOOK_SECRET 미설정 신호 → 즉시 등록.
    if (String(process.env.VERCEL_ENV) === 'production') return false;
    return true;
  }
  const got = req.headers['x-telegram-bot-api-secret-token'];
  return got === expectedSecret;
}

/**
 * Update payload에서 chat_id, text, command 추출.
 * @param {object} update - Telegram Update 객체
 */
export function parseUpdate(update) {
  const msg = update.message || update.edited_message || update.callback_query?.message;
  if (!msg) return null;

  const chatId = msg.chat?.id;
  const userId = (update.message?.from || update.callback_query?.from)?.id;
  const text = update.message?.text || update.callback_query?.data || '';

  // /command 파싱 (예: "/start", "/dispatch CT-20260502-123")
  let command = null;
  let args = [];
  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    command = parts[0].toLowerCase().split('@')[0]; // /start@bot_name → /start
    args = parts.slice(1);
  }

  return {
    chatId,
    userId,
    text,
    command,
    args,
    isCallback: !!update.callback_query,
    callbackId: update.callback_query?.id,
    callbackData: update.callback_query?.data,
    messageId: msg.message_id,
    // Telegram "Reply" 기능으로 답장한 경우 — 원본 메시지 id (chat-relay 매핑용)
    replyToMessageId: update.message?.reply_to_message?.message_id || null,
    fromName: (update.message?.from || update.callback_query?.from)
      ? `${update.message?.from?.first_name || update.callback_query?.from?.first_name || ''}`.trim()
      : '',
  };
}
