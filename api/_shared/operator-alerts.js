/**
 * CocoTripKR — 운영자 텔레그램 알림 헬퍼 (PR-G)
 *
 * 운영자 (관리자 본인) 의 메인 텔레그램 봇 채널 (COCOTRIPKR / TELEGRAM_BOT_TOKEN)
 * 으로 액션 필요 알림을 일관된 prefix 와 형식으로 전송.
 *
 * notify.js (채널 라우터, 5개 채널 분리) 와는 별도 — booking/dispatch/error 등
 * 카테고리별 봇 분리되어도 "운영자 본인이 즉시 봐야 하는" 알림은 무조건 admin 본인
 * 채널로 들어와야 한다는 정책. 따라서 channel 라우팅 우회하고 직접 TELEGRAM_BOT_TOKEN
 * + TELEGRAM_CHAT_ID 호출.
 *
 * Categories (운영자 가시성 라벨링용):
 *   'dispatch'           — 배차 미입력 D-3
 *   'todo'               — 일일 운영자 to-do 종합
 *   'refund'             — 환불 요청/처리
 *   'coupon-warning'     — 쿠폰 race fix 후 수동 환불 대상
 *   'coupon-race'        — 쿠폰 선점 race (capture 전 차단 / 프로모 한도 자동환불)
 *   'cs-overdue'         — 미답변 CS 티켓
 *   'complaint-overdue'  — 미응답 plan 신고
 *
 * silent fail 금지: 알림 발송 실패도 console.error 로 기록 + 호출자에 결과 반환.
 *
 * 사용 예:
 *   import { notifyOperator } from './_shared/operator-alerts.js';
 *   await notifyOperator('refund', `BK-XXXX user@email 환불 요청`);
 */

import { sendDiscord } from './notify.js';

const TELEGRAM_API = 'https://api.telegram.org';

const CATEGORY_LABELS = {
  'dispatch':          '배차 미입력',
  'todo':              '일일 to-do',
  'refund':            '환불',
  'coupon-warning':    '쿠폰 경고',
  'coupon-race':       '쿠폰 레이스',
  'cs-overdue':        'CS 미답변',
  'complaint-overdue': '신고 미응답',
};

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

/**
 * 운영자 본인 (admin A 채널) 으로 메시지 송신.
 * @param {keyof typeof CATEGORY_LABELS} category
 * @param {string} body — HTML parse_mode (기본). prefix 는 자동 부착.
 * @param {object} [options]
 * @param {object} [options.replyMarkup] — Telegram inline keyboard 등
 * @param {boolean} [options.skipPrefix] — true 면 prefix 부착 안 함
 * @returns {Promise<{ ok: boolean, category: string, error?: string, messageId?: number }>}
 */
export async function notifyOperator(category, body, options = {}) {
  if (!VALID_CATEGORIES.has(category)) {
    console.error(`[operator-alerts] unknown category: ${category}`);
    return { ok: false, category, error: 'invalid_category' };
  }

  const label = CATEGORY_LABELS[category];
  const prefix = options.skipPrefix ? '' : `<b>[운영자 알림 · ${label}]</b>\n`;
  const text = `${prefix}${body}`;

  // 디스코드 미러: DISCORD_WEBHOOK_URL 설정 시 운영자 알림을 디스코드에도 전송(텔레그램과 병렬, 미설정=no-op).
  // 병렬 시작 → 텔레그램 지연 0 → finally 에서 완료 보장(서버리스 drop 방지).
  const discordMirror = sendDiscord(text);
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.error(`[operator-alerts:${category}] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 — skip`);
      return { ok: false, category, error: 'no_token_or_chat' };
    }

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`[operator-alerts:${category}] Telegram error:`, data.description);
        return { ok: false, category, error: data.description };
      }
      return { ok: true, category, messageId: data.result?.message_id };
    } catch (err) {
      console.error(`[operator-alerts:${category}] fetch failed:`, err.message);
      return { ok: false, category, error: err.message };
    }
  } finally {
    await discordMirror.catch(() => {});
  }
}

/**
 * 4096자 초과 시 분할 송신 (텔레그램 한도).
 */
export async function notifyOperatorLong(category, body, options = {}) {
  const MAX = 4000; // prefix 100자 여유
  if (body.length <= MAX) return notifyOperator(category, body, options);

  const parts = [];
  for (let i = 0; i < body.length; i += MAX) {
    parts.push(body.slice(i, i + MAX));
  }
  let lastResult = null;
  for (let i = 0; i < parts.length; i++) {
    const opts = i === 0 ? options : { ...options, skipPrefix: true };
    lastResult = await notifyOperator(category, parts[i], opts);
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  return lastResult || { ok: false, category, error: 'no_parts' };
}

export const OPERATOR_CATEGORIES = Object.keys(CATEGORY_LABELS);
