// tests/unit/preview-operator-consumers-20261109.test.ts
// NOTE: The operator-alerts helper and policy are imported for real. The modifyBooking, inquiry-submit,
// and cron consumer checks are STATIC SOURCE / LEXICAL HARNESS tests that evaluate bounded source
// extracts with injected stubs. They are NOT full E2E: no full business modules, network, DB or vendors.
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const { sendDiscordMock } = vi.hoisted(() => ({ sendDiscordMock: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/notify.js', () => ({ sendDiscord: sendDiscordMock }));

import * as policy from '../../api/_shared/preview-notification-policy.js';
import { notifyOperator, notifyOperatorLong } from '../../api/_shared/operator-alerts.js';

type Rec = Record<string, unknown>;
type PolicyT = {
  isPreviewSuppressed: (c: string) => boolean;
  operatorSuppressedReceipt: (c: string, cat: string) => Rec;
  isNotificationSuppressed: (r: unknown) => boolean;
};
type Sender = (cat: string, body: unknown, opts?: unknown) => Promise<unknown>;
type AnyAsync = (...a: unknown[]) => Promise<unknown>;
type EnvVal = Parameters<typeof vi.stubEnv>[1];
const { isPreviewSuppressed, operatorSuppressedReceipt, isNotificationSuppressed } = policy as unknown as PolicyT;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => AnyAsync;
const src = (p: string) => readFileSync(new URL(`../../api/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function countOf(s: string, needle: string) {
  return s.split(needle).length - 1;
}
function extractFn(file: string, anchor: string) {
  const s = src(file);
  expect(countOf(s, anchor)).toBe(1);
  const start = s.indexOf(anchor);
  const end = s.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end + 2);
}
function extractBlock(file: string, anchor: string, ends: string[]) {
  const s = src(file);
  expect(countOf(s, anchor)).toBe(1);
  const start = s.indexOf(anchor);
  const cands = ends.map((e) => s.indexOf(e, start)).filter((i) => i > start);
  expect(cands.length).toBeGreaterThan(0);
  return s.slice(start, Math.min(...cands));
}

let fetchMock: { mock: { calls: unknown[][] } } & ((...a: unknown[]) => Promise<unknown>);
const okFetch = () =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '{}' }));
const mkConsole = () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() });
const throwingBody = {
  toString() { throw new Error('stringified'); },
  toJSON() { throw new Error('jsonified'); },
};
const TOKEN_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
function mkProcess() {
  const reads: string[] = [];
  const env = new Proxy(process.env, {
    get(t, k, r) { if (typeof k === 'string' && TOKEN_KEYS.includes(k)) reads.push(k); return Reflect.get(t, k, r); },
    has(t, k) { if (typeof k === 'string' && TOKEN_KEYS.includes(k)) reads.push(k); return Reflect.has(t, k); },
    getOwnPropertyDescriptor(t, k) { if (typeof k === 'string' && TOKEN_KEYS.includes(k)) reads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const proc = new Proxy(process, { get(t, k) { return k === 'env' ? env : Reflect.get(t, k, t); } });
  return { proc, reads };
}

function setPreview() {
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(isPreviewSuppressed('telegram')).toBe(true);
}

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
  vi.stubEnv('TELEGRAM_CHAT_ID', 'chat');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
  fetchMock = okFetch();
  vi.stubGlobal('fetch', fetchMock);
  sendDiscordMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('operator-alerts (real module)', () => {
  const bodies: [string, unknown][] = [
    ['short', 'hi'],
    ['long', 'x'.repeat(9000)],
    ['null', null],
    ['throwing', throwingBody],
  ];
  for (const fn of [notifyOperator, notifyOperatorLong] as unknown as Sender[]) {
    for (const [name, body] of bodies) {
      it(`${fn.name} preview suppresses ${name} body`, async () => {
        setPreview();
        vi.useFakeTimers();
        const r = await fn('todo', body);
        expect(r).toEqual(operatorSuppressedReceipt('telegram', 'todo'));
        expect(isNotificationSuppressed(r)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sendDiscordMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      });
    }
    it(`${fn.name} preview suppresses invalid category`, async () => {
      setPreview();
      const r = await fn('bogus-cat' as Parameters<Sender>[0], 'hi');
      expect(isNotificationSuppressed(r)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendDiscordMock).not.toHaveBeenCalled();
    });
    it(`${fn.name} preview suppresses without reading body length or options`, async () => {
      setPreview();
      const timerSpy = vi.spyOn(globalThis, 'setTimeout');
      const sentinel = { get length(): number { throw new Error('length read'); }, toString() { throw new Error('stringified'); } };
      const trap = () => { throw new Error('options read'); };
      const opts = new Proxy({}, { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
      const r = await fn('todo', sentinel, opts);
      expect(r).toEqual(operatorSuppressedReceipt('telegram', 'todo'));
      expect(isNotificationSuppressed(r)).toBe(true);
      expect(timerSpy).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendDiscordMock).not.toHaveBeenCalled();
    });
  }

  for (const flag of [undefined, 'false', 'TRUE', '1', ' true', 'true ']) {
    it(`preview with flag=${JSON.stringify(flag)} delivers normally`, async () => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', flag as EnvVal);
      expect(isPreviewSuppressed('telegram')).toBe(false);
      const r = (await notifyOperator('todo', 'hi')) as Rec;
      expect(r.ok).toBe(true);
      expect(isNotificationSuppressed(r)).toBe(false);
      expect(fetchMock).toHaveBeenCalled();
      expect(sendDiscordMock).toHaveBeenCalled();
    });
  }

  for (const env of ['production', 'development', undefined, 'Preview ', 'staging']) {
    it(`normal send for VERCEL_ENV=${String(env)}`, async () => {
      if (env === undefined) vi.stubEnv('VERCEL_ENV', undefined as unknown as EnvVal);
      else vi.stubEnv('VERCEL_ENV', env);
      expect(isPreviewSuppressed('telegram')).toBe(false);
      const r = (await notifyOperator('todo', 'hi')) as Rec;
      expect(r.ok).toBe(true);
      expect(isNotificationSuppressed(r)).toBe(false);
      expect(fetchMock).toHaveBeenCalled();
      expect(sendDiscordMock).toHaveBeenCalled();
    });
  }

  it('long body chunks with 300ms timer', async () => {
    vi.useFakeTimers();
    const p = notifyOperatorLong('todo', 'y'.repeat(9000));
    await vi.runAllTimersAsync();
    const r = (await p) as Rec;
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('remote error preserved', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'bad' }), text: async () => 'bad' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = (await notifyOperator('todo', 'hi')) as Rec;
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad');
    expect(r.category).toBe('todo');
    expect(isNotificationSuppressed(r)).toBe(false);
  });

  it('missing credentials preserved', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    const r = await notifyOperator('todo', 'hi');
    expect(r).toEqual({ ok: false, category: 'todo', error: 'no_token_or_chat' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('unexported senders (lexical harness, NOT full E2E)', () => {
  const build = (code: string, name: string, deps: Rec): AnyAsync =>
    new Function(...Object.keys(deps), `${code}\nreturn ${name};`)(...Object.values(deps)) as AnyAsync;

  const deps = (extra: Rec = {}): Rec => ({
    isPreviewSuppressed, operatorSuppressedReceipt, sendDiscord: sendDiscordMock,
    fetch: fetchMock, console: mkConsole(), process, TELEGRAM_API: 'https://api.telegram.org', ...extra,
  });

  it('modifyBooking notifyTelegram suppresses before mirror/stringify', async () => {
    const p = mkProcess();
    const f = build(extractFn('modifyBooking.js', 'async function notifyTelegram(msg) {'), 'notifyTelegram', deps({ process: p.proc }));
    setPreview();
    const r = await f(throwingBody);
    expect(r).toEqual(operatorSuppressedReceipt('telegram', 'telegram'));
    expect(p.reads).toEqual([]);
    expect(sendDiscordMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('modifyBooking notifyTelegram normal mirrors + fetches, returns undefined', async () => {
    const f = build(extractFn('modifyBooking.js', 'async function notifyTelegram(msg) {'), 'notifyTelegram', deps({ fetch: fetchMock }));
    const r = await f('hello');
    expect(r).toBeUndefined();
    expect(sendDiscordMock).toHaveBeenCalledWith('hello');
    expect(fetchMock).toHaveBeenCalled();
  });
  it('inquiry notifyInquiry suppresses before resolver', async () => {
    const resolveInquiryChannel = vi.fn(() => ({ token: 't', chatId: 'c', tokenSource: 'a', chatSource: 'b' }));
    const f = build(extractFn('inquiry-submit.js', 'async function notifyInquiry(text) {'), 'notifyInquiry', deps({ resolveInquiryChannel }));
    setPreview();
    const r = await f(throwingBody);
    expect(r).toEqual(operatorSuppressedReceipt('telegram', 'inquiry'));
    expect(resolveInquiryChannel).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendDiscordMock).not.toHaveBeenCalled();
  });
  it('inquiry notifyInquiry normal resolves + fetches', async () => {
    const resolveInquiryChannel = vi.fn(() => ({ token: 't', chatId: 'c', tokenSource: 'a', chatSource: 'b' }));
    const f = build(extractFn('inquiry-submit.js', 'async function notifyInquiry(text) {'), 'notifyInquiry', deps({ resolveInquiryChannel, fetch: fetchMock }));
    await f('hello');
    expect(resolveInquiryChannel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('cron consumer blocks (lexical harness, NOT full E2E)', () => {
  const receipt = () => operatorSuppressedReceipt('telegram', 'todo');
  const inert = () => ({
    material: { name: 'mat' }, draft: { variants: [1, 2] },
    agg: { revenue: { count: 1 }, errors: { total: 0 }, customer: { newTickets: 0 } },
    found: [1, 2], totalCount: 2, collectionMissing: false,
    data: { unprocessedStaleCount: 0, staleItems: [], scanIncomplete: false }, msg: 'm',
  });
  const run = async (file: string, anchor: string, result: unknown, sender = 'notifyOperatorLong') => {
    const block = extractBlock(file, anchor, ['\n}', '\n  } catch']);
    const c = mkConsole();
    const env: Rec = { ...inert(), console: c, isNotificationSuppressed, [sender]: vi.fn(async () => result), notifyOperator: vi.fn(async () => result) };
    const out = await new AsyncFunction(...Object.keys(env), block)(...Object.values(env));
    return { out: out as Rec, c, send: env[sender] };
  };

  for (const file of ['_crons/content-draft.js', '_crons/morning-briefing.js']) {
    const anchor = "const result = await notifyOperatorLong('todo', msg, { skipPrefix: true });";
    it(`${file} suppressed`, async () => {
      const rc = receipt();
      const { out, c } = await run(file, anchor, rc);
      expect(out).toEqual({ statusCode: 200, body: 'suppressed', notification: rc });
      expect(c.error).not.toHaveBeenCalled();
    });
    it(`${file} success/failure legacy`, async () => {
      const ok = await run(file, anchor, { ok: true, result: { message_id: 1 } });
      expect(ok.out.statusCode !== null && ok.out.statusCode !== undefined ? ok.out.statusCode : 200).toBe(200);
      expect(ok.out.body).not.toBe('suppressed');
      const bad = await run(file, anchor, { ok: false, error: 'boom' });
      expect(bad.out).toEqual({ statusCode: 500, body: 'send-fail:boom' });
    });
    it(`${file} HTTP line forwards receipt only on suppression`, () => {
      const line = 'return res.status(r.statusCode || 200).json({ ok: (r.statusCode || 200) < 400, body: r.body, ...(isNotificationSuppressed(r.notification) ? { notification: r.notification } : {}) });';
      expect(countOf(src(file.replace('_crons/', '_crons/')), line)).toBe(1);
      const f = new Function('r', 'res', 'isNotificationSuppressed', line);
      const mk = () => { const res = {} as { status: unknown; json: unknown }; res.status = vi.fn(() => res); res.json = vi.fn((x: unknown) => x); return res; };
      const rc = receipt();
      const res1 = mk();
      f({ statusCode: 200, body: 'suppressed', notification: rc }, res1, isNotificationSuppressed);
      expect(res1.json).toHaveBeenCalledWith({ ok: true, body: 'suppressed', notification: rc });
      const res2 = mk();
      f({ statusCode: 500, body: 'send-fail:x', notification: { ok: false } }, res2, isNotificationSuppressed);
      expect(res2.status).toHaveBeenCalledWith(500);
      expect(res2.json).toHaveBeenCalledWith({ ok: false, body: 'send-fail:x' });
    });
  }

  for (const [file, cat] of [['_crons/dispatch-reminder.js', 'dispatch'], ['_crons/operator-todo-reminder.js', 'todo']]) {
    const anchor = `const result = await notifyOperatorLong('${cat}', msg);`;
    it(`${file} suppressed`, async () => {
      const rc = operatorSuppressedReceipt('telegram', cat);
      const { out, c } = await run(file, anchor, rc);
      const body = (out.body !== null && out.body !== undefined ? out.body : out) as Rec;
      expect(body.notified).toBe(false);
      expect(body.notifyError).toBeNull();
      expect(body.notification).toEqual(rc);
      expect(c.error).not.toHaveBeenCalled();
    });
    it(`${file} success/failure legacy`, async () => {
      const ok = await run(file, anchor, { ok: true, result: { message_id: 1 } });
      const ob = (ok.out.body !== null && ok.out.body !== undefined ? ok.out.body : ok.out) as Rec;
      expect(ob.notified).toBe(true);
      expect(ob.notifyError).toBeNull();
      expect(ob.notification).toBeUndefined();
      const bad = await run(file, anchor, { ok: false, error: 'boom' });
      const bb = (bad.out.body !== null && bad.out.body !== undefined ? bad.out.body : bad.out) as Rec;
      expect(bb.notified).toBe(false);
      expect(bb.notifyError).toBe('boom');
      expect(bb.notification).toBeUndefined();
    });
  }

  const dAnchor = 'const notifyResult = await sendLongMessage(msg);';
  it('daily-report suppressed', async () => {
    const rc = receipt();
    const { out, c } = await run('_crons/daily-report.js', dAnchor, rc, 'sendLongMessage');
    expect(out).toEqual({ statusCode: 200, body: 'suppressed', notification: rc });
    expect(c.log).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
  });
  it('daily-report success legacy', async () => {
    const { out, c, send } = await run('_crons/daily-report.js', dAnchor, undefined, 'sendLongMessage');
    expect(send).toHaveBeenCalledWith('m');
    expect(out?.body).not.toBe('suppressed');
    expect(c.log).toHaveBeenCalled();
  });
});
