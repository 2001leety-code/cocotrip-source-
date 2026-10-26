/**
 * 2026-10-26 — notify(): Telegram 이 HTML 파싱 실패("can't parse entities")로 거절하면 같은 텍스트를 평문으로 1회 재전송.
 *   배경: 알림 본문의 이스케이프 안 된 `<`("0% < 30%") 때문에 실패 알림 자체가 운영자에게 안 갔다. 실호출 0(fetch 스텁).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../../api/_shared/notify.js';

type Call = { url: string; body: Record<string, unknown> };
const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ERROR_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DISCORD_WEBHOOK_URL'] as const;
const saved: Record<string, string | undefined> = {};
let calls: Call[] = [];

function stubTelegram(replies: Array<{ status: number; body: unknown }>) {
  calls = [];
  const queue = [...replies];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init && init.body)) });
    const r = queue.shift() || { status: 500, body: null };
    return { status: r.status, ok: r.status < 300, json: async () => r.body };
  }));
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
  delete process.env.TELEGRAM_ERROR_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = 'fake-chat';
  delete process.env.DISCORD_WEBHOOK_URL; // 디스코드 미러 no-op
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const TEXT = '🟡 <b>Plan 다양성 미달 (B-18)</b>\n\nlocal_tag 비율 0% (0/9) < 30% 목표 (B-18)';

describe('notify — parse-entities fallback', () => {
  it('(a) HTML parse rejection → one plain-text resend (no parse_mode, same text) → sent + fallbackPlain', async () => {
    stubTelegram([
      { status: 400, body: { ok: false, description: 'Bad Request: can\'t parse entities: Unsupported start tag "" at byte offset 68' } },
      { status: 200, body: { ok: true, result: { message_id: 1 } } },
    ]);
    const r = await notify('error', TEXT);
    expect(calls).toHaveLength(2);
    expect(calls[0].body.parse_mode).toBe('HTML');
    expect(calls[1].body).not.toHaveProperty('parse_mode');
    expect(calls[1].body.text).toBe(calls[0].body.text);
    expect(calls[1].body.chat_id).toBe('fake-chat');
    expect(r).toMatchObject({ ok: true, channel: 'error', delivery: 'sent', fallbackPlain: true, messageId: 1 });
  });

  it('(b) another 4xx rejection is not retried → one call, rejected', async () => {
    stubTelegram([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
    const r = await notify('error', TEXT);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, delivery: 'rejected', error: 'Bad Request: chat not found' });
  });

  it('(c) first send succeeds → one call, no fallbackPlain', async () => {
    stubTelegram([{ status: 200, body: { ok: true, result: { message_id: 7 } } }]);
    const r = await notify('error', TEXT);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, delivery: 'sent', messageId: 7 });
    expect(r).not.toHaveProperty('fallbackPlain');
  });

  it('a plain resend that is also rejected falls back to the existing rejected path', async () => {
    stubTelegram([
      { status: 400, body: { ok: false, description: "Bad Request: can't parse entities: x" } },
      { status: 400, body: { ok: false, description: 'Bad Request: message is too long' } },
    ]);
    const r = await notify('error', TEXT);
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, delivery: 'rejected', error: 'Bad Request: message is too long' });
  });
});
