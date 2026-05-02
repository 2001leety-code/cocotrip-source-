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

// 인쿼리 봇 역할 설명 — /설명, 설명, 가이드 등으로 호출
const INQUIRY_EXPLAIN_TEXT = `<b>📖 InquiryCHAT_BOT 가이드</b>

<b>1. 이 봇의 역할</b>
💬 사이트 채팅 위젯 → 텔레그램 알림 + 답장 릴레이 전용.

<b>2. 메시지 수신 흐름</b>
1) 고객이 cocotripkr.com 우하단 채팅 위젯에 메시지 입력
2) 이 봇으로 알림 도착 (고객 세션 ID + 메시지 내용)
3) 어드민이 <b>그 메시지에 reply</b>하면 → 사이트 채팅창에 답이 표시됨

<b>3. 중요한 규칙</b>
✅ 인쿼리 알림 메시지에 <b>reply (답장)</b> 기능을 사용해야 작동
❌ 새 메시지로 보내면 고객에게 전달 안 됨
❌ 다른 inquiry 메시지에 잘못 reply하면 다른 고객 세션으로 감

<b>4. 작동 안 될 때</b>
"매핑된 채팅 세션을 찾을 수 없습니다" 응답 받으면:
• 원본 인쿼리 알림 메시지가 너무 오래된 경우 (TTL 만료)
• 잘못된 메시지에 reply한 경우
→ 가장 최신 인쿼리 메시지에 다시 reply 시도

<b>5. 어드민 명령은 여기 안 됨</b>
이 봇은 답장만 받습니다.
명령(/예약, /매출 등)은 <b>COCOTRIPKR (메인 봇)</b>에서 사용.

<b>6. 명령</b>
<code>/설명</code> 또는 <code>설명</code> (이 가이드)`;

// 한글 alias — slash 명령 없을 때만 매핑
const INQUIRY_ALIASES = [
  { re: /^(설명|가이드|매뉴얼|사용법|운영가이드|운영 가이드|역할)$/, cmd: '/explain' },
  { re: /^(도움|도움말|헬프|명령|명령어)$/, cmd: '/help' },
];

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

    // 명령어 처리 — /explain, /help (한글 alias 포함)
    let cmd = parsed.command;
    if (!cmd && parsed.text) {
      const trimmed = parsed.text.trim();
      const match = INQUIRY_ALIASES.find(({ re }) => re.test(trimmed));
      if (match) cmd = match.cmd;
    }

    if (cmd === '/explain' || cmd === '/help') {
      await sendBotMessage(botToken, parsed.chatId, INQUIRY_EXPLAIN_TEXT);
      res.status(200).json({ ok: true });
      return;
    }

    // 그 외 — Reply 미사용 경고 (실수 방지가 핵심)
    if (parsed.text) {
      await sendBotMessage(botToken, parsed.chatId,
        `⚠️ <b>이 메시지는 어느 고객에게도 전달되지 않았습니다.</b>\n\n` +
        `고객에게 답장하려면:\n` +
        `1. 답하고 싶은 고객 메시지를 <b>길게 누름</b> (모바일) 또는 <b>우클릭</b> (데스크탑)\n` +
        `2. <b>답장 (Reply)</b> 선택\n` +
        `3. 답변 입력 후 전송\n\n` +
        `→ 그래야 그 고객에게만 메시지가 전달됩니다.\n\n` +
        `자세한 가이드: <code>/설명</code>`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${BOT_TAG}-webhook] error:`, err);
    res.status(200).json({ ok: false, error: err.message });
  }
}
