import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  initAdminDb: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mocks.initAdminDb }));
vi.mock('../../api/_shared/log.js', () => ({ logger: mocks.logger }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (s: unknown) => String(s) }));
vi.mock('../../api/_shared/exchange-rate.js', () => ({ USD_TO_KRW: 1300 }));
vi.mock('../../api/_shared/escape.js', () => ({ escapeTelegram: (s: unknown) => String(s) }));

import { PREVIEW_SUPPRESSION_FLAGS, isPreviewSuppressed, isNotificationSuppressed } from '../../api/_shared/preview-notification-policy.js';
import { notify, notifyLong, sendDiscord } from '../../api/_shared/notify.js';
import { throttledTelegramAlert, __resetInMemoryThrottleForTests } from '../../api/_shared/telegram-throttle.js';
import { sendMessage, sendLongMessage } from '../../api/_telegram.js';

const FLAG = 'PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS';
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Result = Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

function asResult(v: unknown): Result {
  return v as Result;
}

function setEnv(vercelEnv: string, flag: string | undefined) {
  vi.stubEnv('VERCEL_ENV', vercelEnv);
  vi.stubEnv(FLAG, flag);
  vi.stubEnv('LLM_COMPARE_OFFLINE', '');
}

function expectSuppressed(v: unknown) {
  expect(v).toMatchObject({ ok: false, sent: false, status: 'suppressed', suppressed: true, reason: 'preview_policy', retryable: false, delivery: 'not_attempted' });
  expect(isNotificationSuppressed(v as Parameters<typeof isNotificationSuppressed>[0])).toBe(true);
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>(async () =>
    ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.invalid/hook');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fake-token');
  vi.stubEnv('TELEGRAM_CHAT_ID', '123');
  mocks.initAdminDb.mockReset();
  mocks.initAdminDb.mockReturnValue(null);
  mocks.logger.info.mockClear();
  mocks.logger.warn.mockClear();
  mocks.logger.error.mockClear();
  mocks.logger.debug.mockClear();
  __resetInMemoryThrottleForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('policy flags', () => {
  it('exports a unique flag list containing the operator flag once', () => {
    expect(new Set(PREVIEW_SUPPRESSION_FLAGS).size).toBe(PREVIEW_SUPPRESSION_FLAGS.length);
    expect(PREVIEW_SUPPRESSION_FLAGS.filter((f) => f === FLAG)).toHaveLength(1);
  });

  it('suppresses all preview operator channels regardless of flag value', () => {
    for (const ch of ['telegram', 'discord'] as const) {
      expect(isPreviewSuppressed(ch, { VERCEL_ENV: 'preview', [FLAG]: 'true' })).toBe(true);
      for (const v of ['false', 'TRUE', '1', 'true ', '']) expect(isPreviewSuppressed(ch, { VERCEL_ENV: 'preview', [FLAG]: v })).toBe(true);
      expect(isPreviewSuppressed(ch, { VERCEL_ENV: 'preview' })).toBe(true);
      for (const e of ['production', 'development', 'Preview']) expect(isPreviewSuppressed(ch, { VERCEL_ENV: e, [FLAG]: 'true' })).toBe(false);
    }
  });
});

describe('preview suppressed', () => {
  beforeEach(() => setEnv('preview', 'true'));

  it('direct sendDiscord makes no fetch', async () => {
    expectSuppressed(await sendDiscord('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notify with missing Telegram token still does not mirror', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const r = asResult(await notify('error', 'x'));
    expectSuppressed(r);
    expect(r.channel).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifyLong / sendLongMessage / sendMessage: zero calls and no delay', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const long = 'a'.repeat(9000);
    expectSuppressed(await notifyLong('report', long));
    expectSuppressed(await sendLongMessage(long));
    expectSuppressed(await sendMessage('x'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('throttle: no db init, no log, alerted false', async () => {
    const warn = vi.spyOn(console, 'warn');
    const r = asResult(await throttledTelegramAlert({ key: 'k', message: 'm' }));
    expectSuppressed(r);
    expect(r.alerted).toBe(false);
    expect(r.channel).toBe('error');
    expect(mocks.initAdminDb).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });
});

describe('throttle memory not mutated by suppressed call', () => {
  it('suppressed key does not consume dedup slot; production then dedups normally', async () => {
    setEnv('preview', 'true');
    expectSuppressed(await throttledTelegramAlert({ key: 'mem', message: 'm' }));
    expect(fetchMock).not.toHaveBeenCalled();

    setEnv('production', 'true');
    const first = asResult(await throttledTelegramAlert({ key: 'mem', message: 'm' }));
    expect(first.alerted).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchedUrls().some((u) => u.includes('/sendMessage'))).toBe(true);

    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = asResult(await throttledTelegramAlert({ key: 'mem', message: 'm' }));
    expect(second.alerted).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('not suppressed outside preview', () => {
  for (const env of ['production', 'development']) {
    it(`${env}: report channel delivers normally via fake fetch (with discord mirror)`, async () => {
      setEnv(env, 'true');
      const r = asResult(await notify('report', 'daily health'));
      expect(r.ok).toBe(true);
      expect(r.delivery).toBe('sent');
      const urls = fetchedUrls();
      expect(urls.some((u) => u.includes('/sendMessage'))).toBe(true);
      expect(urls).toContain('https://discord.invalid/hook');
    });
  }

  it('production: every entrypoint attempts delivery with short input', async () => {
    setEnv('production', 'true');
    const entrypoints: Array<() => Promise<unknown>> = [
      () => sendDiscord('x'),
      () => sendMessage('x'),
      () => sendLongMessage('short'),
      () => notify('error', 'x'),
      () => notifyLong('report', 'short'),
    ];
    for (const fn of entrypoints) {
      fetchMock.mockClear();
      const r: unknown = await fn();
      const isNotificationSuppressed = (v: unknown): boolean =>
        typeof v === 'object' && v !== null && (v as { suppressed?: unknown }).suppressed === true;
      expect(isNotificationSuppressed(r)).toBe(false);
      expect(fetchMock).toHaveBeenCalled();
    }
  });

  it('preview with empty flag: direct sendDiscord stays suppressed', async () => {
    setEnv('preview', '');
    expectSuppressed(await sendDiscord('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preview with flag fully unset: direct sendDiscord stays suppressed', async () => {
    setEnv('preview', undefined);
    expect(process.env[FLAG]).toBeUndefined();
    expectSuppressed(await sendDiscord('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LLM_COMPARE_OFFLINE behavior unchanged in production', async () => {
    setEnv('production', 'true');
    vi.stubEnv('LLM_COMPARE_OFFLINE', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await throttledTelegramAlert({ key: 'k', message: 'm' })).toEqual({ ok: true, alerted: false, suppressed: true });
    expect(mocks.initAdminDb).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

