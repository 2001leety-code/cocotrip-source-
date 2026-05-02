#!/usr/bin/env node
/**
 * Telegram Bot Webhook 등록 스크립트
 *
 * 1회 실행: 각 봇의 webhook을 cocotripkr.com 서버에 등록.
 * 등록 후 모든 메시지가 /api/telegram-webhook-{driver|admin} 으로 전달됨.
 *
 * 사용법:
 *   1. .env 또는 환경변수에 다음 설정:
 *      TELEGRAM_DRIVER_BOT_TOKEN=...     (BotFather)
 *      TELEGRAM_ADMIN_BOT_TOKEN=...      (BotFather, 또는 TELEGRAM_BOT_TOKEN 재사용)
 *      TELEGRAM_WEBHOOK_SECRET=...       (직접 생성한 랜덤 문자열, 32+ chars)
 *      WEBHOOK_BASE_URL=https://cocotripkr.com  (선택, 기본값)
 *
 *   2. 실행:
 *      node scripts/setup-telegram-webhooks.cjs
 *
 *   3. 등록 해제 (옵션):
 *      node scripts/setup-telegram-webhooks.cjs --delete
 *
 * 검증:
 *   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
 */

const BASE = process.env.WEBHOOK_BASE_URL || 'https://cocotripkr.com';
const DRIVER_TOKEN = process.env.TELEGRAM_DRIVER_BOT_TOKEN;
const ADMIN_TOKEN = process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const isDelete = process.argv.includes('--delete');

async function setWebhook(token, label, path) {
  const url = `${BASE}${path}`;
  const params = isDelete
    ? { url: '' } // 빈 url = webhook 삭제
    : {
        url,
        secret_token: SECRET,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
        drop_pending_updates: true, // 등록 시점 이전 update는 폐기
      };

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();

  if (data.ok) {
    console.log(`[${label}] ${isDelete ? '삭제' : '등록'} 성공:`, isDelete ? '(no url)' : url);
  } else {
    console.error(`[${label}] 실패:`, data.description);
    process.exit(1);
  }

  // getWebhookInfo로 확인
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log(`[${label}] info:`, JSON.stringify(info.result, null, 2));
}

async function main() {
  if (!isDelete) {
    if (!SECRET || SECRET.length < 16) {
      console.error('TELEGRAM_WEBHOOK_SECRET 미설정 또는 너무 짧음 (16자 이상 권장).');
      console.error('생성 예: openssl rand -hex 32');
      process.exit(1);
    }
  }

  if (DRIVER_TOKEN) {
    await setWebhook(DRIVER_TOKEN, 'driver', '/api/telegram-webhook-driver');
  } else {
    console.warn('TELEGRAM_DRIVER_BOT_TOKEN 미설정 — 기사봇 스킵');
  }

  if (ADMIN_TOKEN) {
    await setWebhook(ADMIN_TOKEN, 'admin', '/api/telegram-webhook-admin');
  } else {
    console.warn('TELEGRAM_ADMIN_BOT_TOKEN 미설정 — 어드민봇 스킵');
  }

  console.log('\n완료. Telegram에서 봇에게 /start 메시지 보내서 동작 확인.');
}

main().catch((err) => {
  console.error('error:', err);
  process.exit(1);
});
