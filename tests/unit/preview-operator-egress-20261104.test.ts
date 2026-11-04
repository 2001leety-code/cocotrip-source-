import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPreviewOperatorSuppressed } from '../../api/_shared/preview-egress-policy.js';
import { notify, sendDiscord } from '../../api/_shared/notify.js';
import { callBot, sendBotMessage } from '../../api/_shared/telegram-bot.js';
import { notifyOperator } from '../../api/_shared/operator-alerts.js';
import { sendMessage, sendLongMessage } from '../../api/_telegram.js';

const network = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
  vi.stubEnv('TELEGRAM_CHAT_ID', '');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fixture-token');
  vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.invalid/fixture');
  network.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) }));
  vi.stubGlobal('fetch', network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Preview operator channel isolation', () => {
  it.each([
    ['preview', 'true', true], ['production', 'true', false], ['development', 'true', false],
    ['preview', 'false', false], ['preview', undefined, false], ['preview', 'TRUE', false],
  ])('exact runtime=%s flag=%s', (runtime, flag, expected) => {
    expect(isPreviewOperatorSuppressed({ VERCEL_ENV: runtime, PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: flag })).toBe(expected);
  });
  it('suppresses separate destinations and Discord before any outbound attempt', async () => {
    const receipts = [await sendDiscord('fixture'), await notify('booking', 'fixture', { chatId: 'alternate' }),
      await sendLongMessage('x'.repeat(9000)), await notifyOperator('refund', 'fixture'),
      await sendMessage('fixture', { chat_id: 'override' })];
    for (const receipt of receipts) {
      expect(receipt).toMatchObject({ ok: false, status: 'suppressed', delivery: 'not_attempted', retryable: false });
      expect(receipt).not.toHaveProperty('messageId');
    }
    await expect(callBot('fixture-token', 'editMessageText', { chat_id: 'driver' })).rejects.toMatchObject({ code: 'PREVIEW_NOTIFICATION_SUPPRESSED', retryable: false });
    await expect(sendBotMessage('fixture-token', 'driver', 'fixture')).rejects.toMatchObject({ code: 'PREVIEW_NOTIFICATION_SUPPRESSED' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(['production', 'preview'])('preserves enabled Telegram, alternate chat and Discord behavior in %s', async runtime => {
    vi.stubEnv('VERCEL_ENV', runtime);
    if (runtime === 'preview') vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'false');
    const result = await notify('booking', 'fixture', { chatId: 'alternate' });
    expect(result).toMatchObject({ ok: true, delivery: 'sent', messageId: 7 });
    expect(network).toHaveBeenCalledTimes(2);
    const telegram = network.mock.calls.find(([url]) => String(url).includes('api.telegram.org'));
    expect(JSON.parse(telegram![1].body).chat_id).toBe('alternate');
  });
  it('keeps production low-level webhook messaging functional with the Preview flag present', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await sendBotMessage('fixture-token', 'driver', 'fixture');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['api/inquiry-submit.js', 'async function notifyInquiry(text) {'],
    ['api/modifyBooking.js', 'async function notifyTelegram(msg) {'],
    ['api/_crons/review-request.js', 'async function sendOperatorSummary('],
    ['api/_crons/refund-reminder.js', 'async function sendOperatorSummary('],
    ['api/_crons/preview-lead-recovery.js', 'async function sendOperatorSummary('],
  ])('keeps the guard first in the independent transport %s', (file, anchor) => {
    const source = readFileSync(file, 'utf8');
    const start = source.indexOf(anchor);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(source.indexOf('{', start + anchor.length - 1) + 1);
    // Destructured arguments in cron helpers have an earlier brace: use the body delimiter.
    const actual = anchor.endsWith('(') ? source.slice(source.indexOf(') {', start) + 3) : body;
    expect(actual.trimStart().startsWith('if (isPreviewOperatorSuppressed()) return suppressedOperatorReceipt();')).toBe(true);
  });
});
