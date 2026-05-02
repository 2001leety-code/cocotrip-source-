/**
 * Cron: dispatch_messages 만료 sweep
 *
 * Vercel cron-runner가 5분 간격으로 호출.
 * sweepExpiredDispatches()를 한 번 실행하여 status='sent' AND
 * expiresAt <= now 인 항목을 모두 expired 처리.
 *
 * Lazy expiry(웹훅 활동 시 자동 sweep)와 병행 — webhook 호출이 없는
 * 시간대에도 정확히 만료시키기 위함.
 *
 * Vercel Pro 플랜에서 sub-hourly cron 가능.
 */
import { sweepExpiredDispatches } from '../_shared/dispatch-sweep.js';

export default async function handler(req, res) {
  try {
    const result = await sweepExpiredDispatches({
      driverBotToken: process.env.TELEGRAM_DRIVER_BOT_TOKEN,
      adminBotToken: process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_CHAT_ID,
      maxBatch: 50,
    });
    console.log('[cron:dispatch-timeout-sweep] result:', result);
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('[cron:dispatch-timeout-sweep] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
