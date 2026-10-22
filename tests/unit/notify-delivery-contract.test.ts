/**
 * notify() `delivery` 계약 (2026-10-23) — 기존 ok/channel/error 는 그대로, 재발송 판단용 필드 추가.
 *   sent / skipped(토큰·chat 없음) / rejected(HTTP 4xx + ok:false) / unknown(5xx·fetch 예외·파싱 실패)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify } from '../../api/_shared/notify.js';

const ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOOKING_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DISCORD_WEBHOOK_URL'];
const saved: Record<string, string | undefined> = {};
let consoleSpies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
  process.env.TELEGRAM_CHAT_ID = 'chat-1';
  consoleSpies = [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  consoleSpies.forEach((s) => s.mockRestore());
});

function telegram(status: number, json: () => Promise<unknown>) {
  global.fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json })) as never;
}

describe('notify delivery', () => {
  it('sent — Telegram ok:true', async () => {
    telegram(200, async () => ({ ok: true, result: { message_id: 7 } }));
    const r = await notify('booking', 'hi');
    expect(r).toMatchObject({ ok: true, channel: 'booking', delivery: 'sent', messageId: 7 });
  });

  it('skipped — token or chat id missing (nothing sent)', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    global.fetch = vi.fn() as never;
    const r = await notify('booking', 'hi');
    expect(r).toMatchObject({ ok: false, channel: 'booking', error: 'no_token_or_chat', delivery: 'skipped' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejected — HTTP 4xx + ok:false', async () => {
    telegram(400, async () => ({ ok: false, description: 'Bad Request: chat not found' }));
    const r = await notify('booking', 'hi');
    expect(r).toMatchObject({ ok: false, error: 'Bad Request: chat not found', delivery: 'rejected' });
  });

  it('unknown — HTTP 4xx without an explicit ok:false (null / {} / { ok: null })', async () => {
    for (const body of [null, {}, { ok: null }]) {
      telegram(400, async () => body);
      expect((await notify('booking', 'hi')).delivery, JSON.stringify(body)).toBe('unknown');
    }
    telegram(400, async () => ({ ok: false, description: 'chat not found' }));
    expect((await notify('booking', 'hi')).delivery).toBe('rejected');
  });

  it('unknown — HTTP 5xx, fetch exception, unreadable JSON', async () => {
    telegram(502, async () => ({ ok: false, description: 'Bad Gateway' }));
    expect((await notify('booking', 'hi')).delivery).toBe('unknown');

    global.fetch = vi.fn(async () => { throw new Error('socket hang up'); }) as never;
    expect(await notify('booking', 'hi')).toMatchObject({ ok: false, error: 'socket hang up', delivery: 'unknown' });

    telegram(200, async () => { throw new SyntaxError('Unexpected end of JSON input'); });
    expect(await notify('booking', 'hi')).toMatchObject({ ok: false, delivery: 'unknown' });
  });
});
