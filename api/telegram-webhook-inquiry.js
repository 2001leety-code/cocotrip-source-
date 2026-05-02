/**
 * Vercel API Route: Inquiry Telegram Bot Webhook
 * POST /api/telegram-webhook-inquiry
 *
 * 인쿼리 봇 (TELEGRAM_INQUIRY_BOT_TOKEN) 전용 webhook.
 * 별도 봇으로 inquiry 채널 운영 시, 이 webhook을 등록해야
 * 관리자 답장 → 고객 채팅 위젯 릴레이가 작동.
 *
 * 단일 봇 운영(TELEGRAM_BOT_TOKEN만 사용) 시엔 admin webhook이
 * 같은 처리를 하므로 본 파일은 사용 안 됨.
 *
 * 동작:
 *   - reply_to_message가 있고 매핑이 존재 → 고객 세션에 admin 메시지 추가
 *   - 그 외 메시지/명령 → 안내 메시지로 응답
 *
 * 보안:
 *   - secret_token 검증
 *   - TELEGRAM_CHAT_ID 일치 검증 (외부 chat_id 무시)
 */
import { sendBotMessage, verifyWebhookSecret, parseUpdate } from './_shared/telegram-bot.js';
import { relayAdminReply } from './_shared/chat-relay.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const BOT_TAG = 'inquiry';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  if (!verifyWebhookSecret(req, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const botToken = process.env.TELEGRAM_INQUIRY_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ ok: false, error: 'inquiry bot not configured' });
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

  // chat_id pin (관리자만)
  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  if (adminChatId && String(parsed.chatId) !== String(adminChatId)) {
    res.status(200).json({ ok: true });
    return;
  }

  console.log(`[${BOT_TAG}-webhook] cmd:`, parsed.command, '| reply:', parsed.replyToMessageId);

  try {
    // 인쿼리 메시지에 reply → 고객 채팅으로 릴레이
    if (parsed.replyToMessageId && parsed.text && !parsed.command) {
      const result = await relayAdminReply({
        replyToMessageId: parsed.replyToMessageId,
        text: parsed.text,
        adminName: parsed.fromName || '관리자',
      });
      if (result.relayed) {
        await sendBotMessage(botToken, parsed.chatId,
          `✓ 고객에게 전달\n세션: <code>${result.sessionId}</code>`);
      } else {
        await sendBotMessage(botToken, parsed.chatId,
          `매핑된 채팅 세션을 찾을 수 없습니다.\n` +
          `(원본 인쿼리 메시지에 직접 reply 해야 작동)`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // 그 외 — 도움말 안내
    if (parsed.text) {
      await sendBotMessage(botToken, parsed.chatId,
        `<b>인쿼리 봇</b>\n` +
        `이 봇은 고객 채팅 문의 알림 + 답장 릴레이 전용입니다.\n` +
        `관리 명령은 <b>관리자 봇</b>으로 사용해 주세요.`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] error:`, err);
    res.status(200).json({ ok: false, error: err.message });
  }
}
