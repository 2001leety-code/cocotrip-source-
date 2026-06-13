/**
 * POST /api/notify-claim
 *
 * 새 free-plan 클레임이 Firestore `pending_free_claims/{id}`에 저장된 직후
 * 클라이언트가 fire-and-forget으로 호출. 어드민 텔레그램 봇으로
 * [✓ 승인] [✗ 거부] 인라인 버튼이 달린 알림을 발송한다.
 *
 * 콜백 처리는 telegram-webhook-admin.js 의 `handleClaimCallback` 에서.
 *
 * Body: { claimId, email, flightRef?, hotelRef?, tripDates?, receipts? }
 *
 * ENV: TELEGRAM_BOT_TOKEN (또는 TELEGRAM_ADMIN_BOT_TOKEN), TELEGRAM_CHAT_ID
 */
import { callBot } from './_shared/telegram-bot.js';
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// 비용/스팸 DoS 가드용 — 무인증 + Telegram 발송이라 per-IP rate-limit.
const _rateDb = initAdminDb('notify-claim');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { claimId, email, flightRef, hotelRef, tripDates, receipts } = body;
  if (!claimId || !email) {
    res.status(400).json({ ok: false, error: 'claimId and email required' });
    return;
  }

  // 비용/스팸 DoS 가드 — 무인증 + Telegram 발송 → per-IP rate-limit (fail-open).
  const rl = await checkIpRateLimit({
    db: _rateDb, ip: getClientIp(req),
    collection: 'claim_notify_rate_limits',
    maxRequests: 10, errorLabel: 'claim notifications',
  });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    res.status(rl.status).json({ ok: false, error: rl.error, code: 'RATE_LIMITED' });
    return;
  }

  const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('[notify-claim] telegram env not set — skipping');
    res.status(200).json({ ok: true, skipped: 'no_telegram_config' });
    return;
  }

  const lines = [
    '🆓 <b>새 무료 플랜 클레임</b>',
    '',
    `이메일: <code>${escapeHtml(email)}</code>`,
  ];
  if (flightRef) lines.push(`항공 PNR: <code>${escapeHtml(flightRef)}</code>`);
  if (hotelRef) lines.push(`호텔 ref: <code>${escapeHtml(hotelRef)}</code>`);
  if (tripDates) lines.push(`여행: ${escapeHtml(tripDates)}`);
  if (Array.isArray(receipts) && receipts.length > 0) {
    lines.push(`영수증: ${receipts.length}개 첨부`);
  }
  lines.push('');
  lines.push(`<i>아래 버튼으로 승인/거부 처리.</i>`);
  lines.push(`<i>커스텀 거부 사유는 어드민 페이지(/admin/claims)에서.</i>`);

  try {
    await callBot(botToken, 'sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: '✓ 승인', callback_data: `claim_approve:${claimId}` },
          { text: '✗ 거부', callback_data: `claim_reject:${claimId}` },
        ]],
      },
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-claim] telegram send failed:', err);
    await captureError(err, { route: '/api/notify-claim', method: req.method });
    res.status(200).json({ ok: false, error: err.message });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
