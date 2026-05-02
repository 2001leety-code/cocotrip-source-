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
};

const TELEGRAM_API = 'https://api.telegram.org';

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
  const token = resolveToken(channel);
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn(`[notify:${channel}] 토큰 또는 chat_id 미설정 — skip`);
    return { ok: false, channel, error: 'no_token_or_chat' };
  }

  const channelEnv = CHANNEL_ENV[channel];
  const isFallback = channelEnv && !process.env[channelEnv];

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
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
    return { ok: true, channel, fallback: isFallback, messageId: data.result?.message_id };
  } catch (err) {
    console.error(`[notify:${channel}] fetch failed:`, err.message);
    return { ok: false, channel, error: err.message };
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
