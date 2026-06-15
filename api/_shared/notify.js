/**
 * CocoTripKR — 채널 기반 텔레그램 알림 라우터
 *
 * 알림 종류별로 별도 봇을 사용해 채팅창을 분리.
 * 같은 chat_id (관리자 본인)에 여러 봇이 메시지 보내면 텔레그램 앱에서
 * 봇별로 채팅이 분리되어 정렬됨 → 종류별 알림 구분 용이.
 *
 * 채널 (각각 개별 봇 토큰 옵션):
 *   - booking   : 예약 알림 (새 예약, 취소, 환불, 변경)
 *   - dispatch  : 배차 결과 (수락/거절/만료)
 *   - error     : 시스템 오류 (결제/API 실패)
 *   - inquiry   : 고객 채팅 문의 (chat.js)
 *   - report    : 일일/주간 리포트 (cron)
 *
 * 환경변수 (모두 옵션 — 미설정 시 TELEGRAM_BOT_TOKEN 폴백):
 *   TELEGRAM_BOOKING_BOT_TOKEN
 *   TELEGRAM_DISPATCH_BOT_TOKEN
 *   TELEGRAM_ERROR_BOT_TOKEN
 *   TELEGRAM_INQUIRY_BOT_TOKEN
 *   TELEGRAM_REPORT_BOT_TOKEN
 *   TELEGRAM_BOT_TOKEN     (폴백)
 *   TELEGRAM_CHAT_ID       (모든 채널 공통 수신자)
 *
 * 사용 예:
 *   import { notify } from './_shared/notify.js';
 *   await notify('booking', '<b>새 예약</b>\n...');
 *   await notify('error', `API 실패: ${err.message}`);
 */

const CHANNEL_ENV = {
  booking:  'TELEGRAM_BOOKING_BOT_TOKEN',
  dispatch: 'TELEGRAM_DISPATCH_BOT_TOKEN',
  error:    'TELEGRAM_ERROR_BOT_TOKEN',
  inquiry:  'TELEGRAM_INQUIRY_BOT_TOKEN',
  report:   'TELEGRAM_REPORT_BOT_TOKEN',
  // 'admin' = operator-alerts 등 32곳에서 쓰는 채널. CHANNEL_ENV 미정의 시 TELEGRAM_BOT_TOKEN
  // fallback 에만 의존(취약)해서 명시 등록. unset 이면 기존 동작 동일(무변화). 2026-06-08
  admin:    'TELEGRAM_ADMIN_BOT_TOKEN',
};

const TELEGRAM_API = 'https://api.telegram.org';

// ── 디스코드 미러 (2026-06-15) ──
// DISCORD_WEBHOOK_URL 설정 시, 텔레그램과 별개로 모든 알림을 디스코드 채널에도 전송.
// 미설정(기본)이면 no-op → 기존 동작 byte-identical. 텔레그램 HTML → 디스코드 마크다운 변환.
function htmlToDiscord(html) {
  return String(html || '')
    .replace(/<b>|<strong>/gi, '**').replace(/<\/b>|<\/strong>/gi, '**')
    .replace(/<i>|<em>/gi, '*').replace(/<\/i>|<\/em>/gi, '*')
    .replace(/<\/?code>/gi, String.fromCharCode(96)) // 96 = backtick for <code> tag (P91 lint: no literal backtick)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export async function sendDiscord(text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return; // 미설정 = no-op (기존 동작 무변화)
  const content = htmlToDiscord(text);
  for (let i = 0; i < content.length; i += 1900) {
    try {
      // 4초 타임아웃 — 디스코드가 느려도 중요한 텔레그램 알림(예약/결제)이 지연되지 않게.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.slice(i, i + 1900) || '​' }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn('[notify:discord] webhook failed:', err.message);
      break;
    }
    if (i + 1900 < content.length) await new Promise((r) => setTimeout(r, 300));
  }
}

// PR #451 (Audit Z-H13 — 2026-05-16): Telegram sendMessage hard-caps text at
// 4096 chars. Pre-fix, notify() forwarded oversized text unchanged; Telegram
// rejected with "MESSAGE_TOO_LONG" → notify() returned ok:false but the alert
// was silently lost. notifyLong() existed for explicit chunking but no caller
// reached for it on booking memo / operator alert paths.
//
// Now notify() auto-truncates oversized text at the last newline boundary
// under the cap so the alert still reaches the operator. The suffix points at
// throttledTelegramAlert's error_log collection for the full original text.
const TELEGRAM_TEXT_HARD_LIMIT = 4096;
const TELEGRAM_TEXT_SAFE_LIMIT = 4090; // 6-char margin for suffix bytes
const TRUNCATE_SUFFIX = '\n…(truncated, full text in error_log)';

export function safeTruncateForTelegram(text) {
  // nullish 폴백(== null 삼항): text 가 string 이 아닐 때만(null/undefined→'', 0/숫자는 그대로) 안전 변환.
  if (typeof text !== 'string') return { text: String(text == null ? '' : text), truncated: false };
  if (text.length <= TELEGRAM_TEXT_HARD_LIMIT) return { text, truncated: false };
  // Prefer truncation at the last newline within the safe limit so we don't
  // chop mid-line and orphan an HTML tag.
  const window = text.slice(0, TELEGRAM_TEXT_SAFE_LIMIT - TRUNCATE_SUFFIX.length);
  const lastNl = window.lastIndexOf('\n');
  const cut = lastNl > 0 ? window.slice(0, lastNl) : window;
  return { text: `${cut}${TRUNCATE_SUFFIX}`, truncated: true, originalLength: text.length };
}

/**
 * 채널 → bot token 해석. 미설정 시 fallback.
 */
function resolveToken(channel) {
  const channelEnv = CHANNEL_ENV[channel];
  if (channelEnv && process.env[channelEnv]) return process.env[channelEnv];
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * 채널 기반 메시지 전송.
 * @param {keyof typeof CHANNEL_ENV} channel
 * @param {string} text — HTML parse_mode (기본)
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, channel: string, fallback?: boolean, error?: string }>}
 */
export async function notify(channel, text, options = {}) {
  // 디스코드 미러: DISCORD_WEBHOOK_URL 설정 시 텔레그램과 "병렬"로 디스코드에도 전송(미설정=no-op).
  // 병렬 시작(await 안 함) → 텔레그램이 디스코드를 기다리지 않음(지연 0) → finally 에서 완료 보장(서버리스 drop 방지).
  const discordMirror = sendDiscord(text);
  try {
    const token = resolveToken(channel);
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.warn(`[notify:${channel}] 토큰 또는 chat_id 미설정 — skip`);
      return { ok: false, channel, error: 'no_token_or_chat' };
    }

    const channelEnv = CHANNEL_ENV[channel];
    const isFallback = channelEnv && !process.env[channelEnv];

    // PR #451 (Z-H13): hard-cap text at Telegram's 4096-char limit.
    // Truncating is better than silent-dropping the alert.
    const { text: safeText, truncated, originalLength } = safeTruncateForTelegram(text);
    if (truncated) {
      console.warn(`[notify:${channel}] text truncated for Telegram 4096-cap: ${originalLength} → ${safeText.length} chars`);
    }

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: safeText,
          parse_mode: options.parseMode || 'HTML',
          disable_web_page_preview: true,
          ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`[notify:${channel}] Telegram error:`, data.description);
        return { ok: false, channel, error: data.description };
      }
      // result.message_id를 호출자가 알 수 있어야 추후 reply_to_message 매핑 가능
      return { ok: true, channel, fallback: isFallback, messageId: data.result?.message_id, truncated };
    } catch (err) {
      console.error(`[notify:${channel}] fetch failed:`, err.message);
      return { ok: false, channel, error: err.message };
    }
  } finally {
    await discordMirror.catch(() => {}); // 모든 반환 경로에서 디스코드 완료 보장(텔레그램은 이미 끝난 뒤)
  }
}

/**
 * 긴 메시지 4096자 분할 전송.
 */
export async function notifyLong(channel, text, options = {}) {
  const MAX = 4096;
  if (text.length <= MAX) return notify(channel, text, options);

  for (let i = 0; i < text.length; i += MAX) {
    const part = text.slice(i, i + MAX);
    await notify(channel, part, options);
    if (i + MAX < text.length) await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: true, channel };
}

/**
 * 디버그/체크용 — 채널별 봇 토큰 설정 상태 반환.
 * @returns {Record<string, { configured: boolean, fallback: boolean }>}
 */
export function getChannelStatus() {
  const status = {};
  for (const [channel, env] of Object.entries(CHANNEL_ENV)) {
    status[channel] = {
      configured: !!process.env[env],
      fallback: !process.env[env] && !!process.env.TELEGRAM_BOT_TOKEN,
    };
  }
  return status;
}
