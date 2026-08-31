import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildChatTelegramMessage } from '../../api/_shared/chat-telegram-message.js';
import { discordMirrorText, notify } from '../../api/_shared/notify.js';

const ENV_KEYS = [
  'DISCORD_WEBHOOK_URL',
  'DISCORD_MIRROR_INQUIRY_ENABLED',
  'TELEGRAM_INQUIRY_BOT_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const chatSource = readFileSync(resolve(process.cwd(), 'api/chat.js'), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
});

describe('chat Telegram inquiry formatting', () => {
  it('routes the production Telegram alert through the escaping formatter', () => {
    expect(chatSource).toContain("import { buildChatTelegramMessage } from './_shared/chat-telegram-message.js'");
    expect(chatSource).toMatch(/const telegramMsg = buildChatTelegramMessage\(\{/);
    expect(chatSource).not.toMatch(/<b>📨 고객 \([^\n]*\$\{message\}/);
  });

  it('escapes every customer/model-controlled value while preserving fixed Telegram markup', () => {
    const text = buildChatTelegramMessage({
      sessionId: 'sess_<fake>&',
      detectedLang: '<b>en</b>',
      customerMessage: '<a href="https://bad.example">customer</a> & more',
      customerTranslation: '<script>translated</script>',
      customerReply: '<b>model reply</b>',
      aiTranslation: '<i>model translation</i>',
      kst: '<time>',
    });

    expect(text).toContain('💬 <b>웹 채팅 문의</b>');
    expect(text).toContain('sess_&lt;fake&gt;&amp;');
    expect(text).toContain('&lt;b&gt;en&lt;/b&gt;');
    expect(text).toContain('&lt;a href="https://bad.example"&gt;customer&lt;/a&gt; &amp; more');
    expect(text).toContain('&lt;script&gt;translated&lt;/script&gt;');
    expect(text).toContain('&lt;b&gt;model reply&lt;/b&gt;');
    expect(text).toContain('&lt;i&gt;model translation&lt;/i&gt;');
    expect(text).toContain('&lt;time&gt;');
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<a href="https://bad.example">');
  });

  it('escapes escalation notes and keeps the translation-failure label fixed', () => {
    const text = buildChatTelegramMessage({
      escalate: true,
      customerMessage: 'hello <broken',
      customerTranslationFailed: true,
      customerReply: '<u>please wait</u>',
      internalReply: '<code>private model note</code>',
    });

    expect(text).toContain('긴급 — AI 미답변');
    expect(text).toContain('고객 ⚠️ 번역 실패');
    expect(text).toContain('hello &lt;broken');
    expect(text).toContain('&lt;u&gt;please wait&lt;/u&gt;');
    expect(text).toContain('&lt;code&gt;private model note&lt;/code&gt;');
    expect(text).not.toContain('<u>please wait</u>');
  });
});

describe('inquiry Discord mirror privacy policy', () => {
  const sensitive = 'name=Private Person email=private@example.com message=secret';

  it('blocks inquiry mirroring by default and for non-true values', () => {
    expect(discordMirrorText('inquiry', sensitive, {})).toBeNull();
    expect(discordMirrorText('inquiry', sensitive, { DISCORD_MIRROR_INQUIRY_ENABLED: 'false' })).toBeNull();
    expect(discordMirrorText('inquiry', sensitive, { DISCORD_MIRROR_INQUIRY_ENABLED: '1' })).toBeNull();
  });

  it('uses a fixed metadata-only pointer after explicit opt-in', () => {
    const mirrored = discordMirrorText('inquiry', sensitive, {
      DISCORD_MIRROR_INQUIRY_ENABLED: 'true',
    });

    expect(mirrored).toContain('고객 문의 도착');
    expect(mirrored).toContain('본문은 생략');
    expect(mirrored).not.toContain('Private Person');
    expect(mirrored).not.toContain('private@example.com');
    expect(mirrored).not.toContain('secret');
  });

  it('keeps non-inquiry channel mirrors unchanged', () => {
    expect(discordMirrorText('booking', sensitive, {})).toBe(sensitive);
  });

  it('does not call the Discord webhook for an inquiry without explicit opt-in', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook';
    process.env.TELEGRAM_INQUIRY_BOT_TOKEN = 'test-inquiry-token';
    process.env.TELEGRAM_CHAT_ID = 'test-admin-chat';
    delete process.env.DISCORD_MIRROR_INQUIRY_ENABLED;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    } as Response);

    await notify('inquiry', sensitive);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.telegram.org');
  });

  it('sends only the fixed redacted pointer to Discord after opt-in', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook';
    process.env.DISCORD_MIRROR_INQUIRY_ENABLED = 'true';
    process.env.TELEGRAM_INQUIRY_BOT_TOKEN = 'test-inquiry-token';
    process.env.TELEGRAM_CHAT_ID = 'test-admin-chat';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('api.telegram.org')) {
        return { json: async () => ({ ok: true, result: { message_id: 1 } }) } as Response;
      }
      return { ok: true } as Response;
    });

    await notify('inquiry', sensitive);

    const discordCall = fetchMock.mock.calls.find(([url]) => String(url).includes('discord.invalid'));
    expect(discordCall).toBeTruthy();
    const body = JSON.parse(String(discordCall?.[1]?.body || '{}'));
    expect(body.content).toContain('본문은 생략');
    expect(body.content).not.toContain('Private Person');
    expect(body.content).not.toContain('private@example.com');
    expect(body.content).not.toContain('secret');
  });
});
