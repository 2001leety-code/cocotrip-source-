import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import refundMod from '../../api/_crons/refund-reminder.js';
import reviewMod from '../../api/_crons/review-request.js';
import recoveryMod from '../../api/_crons/preview-lead-recovery.js';
import * as policyMod from '../../api/_shared/preview-notification-policy.js';

type Rec = Record<string, unknown>;
type Doc = { id: string; data: Rec };
type Upd = { col: string; id: string; patch: Rec };
type Res = { statusCode: number; status: (c: number) => Res; json: (b: unknown) => Res; end: () => Res; setHeader: () => Res };
type Handler = (req: Rec, res: Res) => Promise<unknown>;
type Policy = {
  emailSuppressedReceipt: (...a: string[]) => Rec;
  operatorSuppressedReceipt: (channel: string, kind: string) => Rec;
  isPreviewSuppressed: (channel: string) => boolean;
  isNotificationSuppressed: (r: unknown) => boolean;
};

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendDiscord: vi.fn(),
  initAdminDb: vi.fn(),
  getPreviewFirebaseApp: vi.fn(),
  previewFirebaseErrorCode: vi.fn(),
  serverTimestamp: vi.fn(),
  isMarketingOptedOut: vi.fn(),
  buildUnsubscribeUrl: vi.fn(),
  db: { current: null as unknown },
}));

vi.mock('../../api/_send-email.js', () => ({ sendEmail: h.sendEmail }));
vi.mock('../../api/_shared/notify.js', () => ({ sendDiscord: h.sendDiscord }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: h.initAdminDb }));
vi.mock('../../api/_shared/preview-firebase-app.js', () => ({ getPreviewFirebaseApp: h.getPreviewFirebaseApp, previewFirebaseErrorCode: h.previewFirebaseErrorCode }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{ name: '[DEFAULT]' }], getApp: () => ({}), cert: () => ({}), initializeApp: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => h.db.current, FieldValue: { serverTimestamp: h.serverTimestamp } }));
vi.mock('../../api/_shared/marketing-optout.js', () => ({ isMarketingOptedOut: h.isMarketingOptedOut, buildUnsubscribeUrl: h.buildUnsubscribeUrl }));

const P = policyMod as unknown as Policy;
const refund = refundMod as unknown as Handler;
const review = reviewMod as unknown as Handler;
const recovery = recoveryMod as unknown as Handler;
const opReceipt = (): Rec => P.operatorSuppressedReceipt('telegram', 'operator-summary');

function match(actual: unknown, op: string, v: unknown): boolean {
  const a = actual as number, b = v as number;
  switch (op) {
    case '==': return (actual !== null && actual !== undefined ? actual : null) === (v !== null && v !== undefined ? v : null);
    case '>=': return a >= b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '<': return a < b;
    case 'in': return Array.isArray(v) && v.includes(actual);
    default: throw new Error(`unexpected fake query operator: ${op}`);
  }
}

function makeDb(cols: Record<string, Doc[]>) {
  const updates: Upd[] = [];
  const update = (col: string, d: Doc) => async (patch: Rec) => { updates.push({ col, id: d.id, patch }); Object.assign(d.data, patch); };
  const query = (col: string, filters: Array<[string, string, unknown]>, lim: number): Rec => ({
    where: (f: string, op: string, v: unknown) => query(col, [...filters, [f, op, v]], lim),
    orderBy: () => query(col, filters, lim),
    limit: (n: number) => query(col, filters, n),
    get: async () => {
      const docs = (cols[col] !== null && cols[col] !== undefined ? cols[col] : [])
        .filter((d) => filters.every(([f, op, v]) => match(d.data[f], op, v)))
        .slice(0, lim)
        .map((d) => ({ id: d.id, exists: true, data: () => ({ ...d.data }), ref: { id: d.id, update: update(col, d) } }));
      return { size: docs.length, empty: docs.length === 0, docs, forEach: (fn: (x: unknown) => void) => docs.forEach(fn) };
    },
  });
  const db = {
    collection: (c: string) => ({
      ...query(c, [], Infinity),
      doc: (id: string) => {
        const dFound = (cols[c] !== null && cols[c] !== undefined ? cols[c] : []).find((x) => x.id === id);
        const d = dFound !== null && dFound !== undefined ? dFound : { id, data: {} };
        return { id, update: update(c, d) };
      },
    }),
  };
  return { db, updates };
}

const booking = (n: number, tourDate: string): Doc => ({
  id: `b${n}`,
  data: { status: 'CONFIRMED', bookingRef: `TEST-${n}`, payerEmail: `test${n}@example.invalid`, payerName: 'Test', tourDate, amountUSD: '100', productName: 'Test', pax: 1 },
});
const lead = (n: number): Doc => ({
  id: `l${n}`,
  data: { createdAtMs: Date.now() - 2 * 86400000, recoveryEmailSentAtMs: null, convertedAtMs: null, emailLower: `test${n}@example.invalid`, language: 'en' },
});

type Case = { name: string; handler: Handler; file: string; seed: (n: number) => Record<string, Doc[]>; summaryOnDry: boolean; enableVar?: string };
const many = (fx: (n: number) => Doc, n: number): Doc[] => Array.from({ length: n }, (_, i) => fx(i + 1));
const cases: Case[] = [
  { name: 'refund-reminder', handler: refund, file: 'refund-reminder.js', seed: (n) => ({ bookings: many((i) => booking(i, '2026-11-13'), n) }), summaryOnDry: false },
  { name: 'review-request', handler: review, file: 'review-request.js', seed: (n) => ({ bookings: many((i) => booking(i, '2026-11-08'), n) }), summaryOnDry: true, enableVar: 'REVIEW_REQUEST_ENABLED' },
  { name: 'preview-lead-recovery', handler: recovery, file: 'preview-lead-recovery.js', seed: (n) => ({ preview_leads: many(lead, n), bookings: [] }), summaryOnDry: true, enableVar: 'PREVIEW_RECOVERY_ENABLED' },
];

function seedDb(c: Case, n: number) {
  const cols = c.seed(n);
  const fake = makeDb(cols);
  h.db.current = fake.db;
  const docs = Object.values(cols).flat();
  return { ...fake, docs, snapshot: JSON.stringify(docs) };
}

async function run(handler: Handler, query: Rec = {}) {
  const out: { status?: number; body?: Rec } = {};
  const res: Res = {
    statusCode: 200,
    status(c) { out.status = c; res.statusCode = c; return res; },
    json(b) { out.body = b as Rec; return res; },
    end() { return res; },
    setHeader() { return res; },
  };
  await handler({ method: 'GET', query, headers: {} }, res);
  return { status: out.status !== null && out.status !== undefined ? out.status : res.statusCode, body: out.body !== null && out.body !== undefined ? out.body : {} };
}

let fetchMock: ReturnType<typeof vi.fn>;
let spies: Array<ReturnType<typeof vi.spyOn>> = [];
const logs = (): string => spies.flatMap((s) => s.mock.calls).map((a) => a.map(String).join(' ')).join('\n');
const transportCalls = (): number => fetchMock.mock.calls.length + h.sendDiscord.mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T03:00:00Z'));
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const env: Record<string, string> = {
    VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: 'true', PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true',
    REVIEW_REQUEST_ENABLED: 'true', PREVIEW_RECOVERY_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: 'fake',
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  for (const fn of [h.sendEmail, h.sendDiscord, h.initAdminDb, h.getPreviewFirebaseApp, h.previewFirebaseErrorCode, h.serverTimestamp, h.isMarketingOptedOut, h.buildUnsubscribeUrl]) fn.mockReset();
  h.sendEmail.mockResolvedValue(undefined);
  h.sendDiscord.mockResolvedValue(undefined);
  h.initAdminDb.mockImplementation(() => h.db.current);
  h.getPreviewFirebaseApp.mockImplementation(() => (h.db.current ? {} : null));
  h.previewFirebaseErrorCode.mockReturnValue('test-error');
  h.serverTimestamp.mockReturnValue('__server_ts__');
  h.isMarketingOptedOut.mockReturnValue(false);
  h.buildUnsubscribeUrl.mockReturnValue('https://test.invalid/unsub');
  spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.db.current = null;
});

describe.each(cases)('$name full handler with mocked external deps (not E2E; no network/DB)', (c) => {
  it('2 eligible + suppressed email receipts: no writes, suppressed receipt, no operator summary', async () => {
    const receipt = P.emailSuppressedReceipt();
    h.sendEmail.mockResolvedValue(receipt);
    const { updates } = seedDb(c, 2);
    const { status, body } = await run(c.handler);
    expect(status).toBe(200);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(0);
    expect(h.serverTimestamp).not.toHaveBeenCalled();
    expect(body).toMatchObject({ sentCount: 0, errorCount: 0, suppressedCount: 2 });
    expect(body.emailNotification).toEqual(receipt);
    expect(body).not.toHaveProperty('operatorNotification');
    expect(transportCalls()).toBe(0);
    expect(logs()).not.toMatch(/sent:|send failed:/);
    expect(spies[1]).not.toHaveBeenCalled();
    expect(spies[2]).not.toHaveBeenCalled();
  });

  it('repeat run with same fixtures: 4 attempts, markers unchanged, no retry claim', async () => {
    h.sendEmail.mockResolvedValue(P.emailSuppressedReceipt());
    const { updates, docs, snapshot } = seedDb(c, 2);
    await run(c.handler);
    const second = await run(c.handler);
    expect(h.sendEmail).toHaveBeenCalledTimes(4);
    expect(updates).toHaveLength(0);
    expect(JSON.stringify(docs)).toBe(snapshot);
    expect(second.body).toMatchObject({ sentCount: 0, suppressedCount: 2 });
  });

  it('mixed normal/suppressed/throw: sent1 error1 suppressed1, only normal marker written', async () => {
    const receipt = P.emailSuppressedReceipt();
    h.sendEmail.mockReset()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(receipt)
      .mockRejectedValueOnce(new Error('synthetic failure'));
    const { updates, docs } = seedDb(c, 3);
    const { body } = await run(c.handler);
    expect(h.sendEmail).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ sentCount: 1, errorCount: 1, suppressedCount: 1 });
    expect(body.emailNotification).toEqual(receipt);
    expect(body.operatorNotification).toEqual(opReceipt());
    expect(updates.map((u) => u.id)).toEqual([docs[0].id]);
    expect(transportCalls()).toBe(0);
  });

  it('dryRun query: no sends/writes, no email receipt fields, summary per existing flow', async () => {
    const { updates } = seedDb(c, 2);
    const { body } = await run(c.handler, { dryRun: 'true' });
    expect(body.dryRun).toBe(true);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(body).not.toHaveProperty('suppressedCount');
    expect(body).not.toHaveProperty('emailNotification');
    if (c.summaryOnDry) expect(body.operatorNotification).toEqual(opReceipt());
    else expect(body).not.toHaveProperty('operatorNotification');
    expect(transportCalls()).toBe(0);
  });

  it.each(['production', 'development'])('%s + operator flag true: legacy counts/writes/transport, no receipt fields', async (envName) => {
    vi.stubEnv('VERCEL_ENV', envName);
    const { updates } = seedDb(c, 2);
    const { body } = await run(c.handler);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ sentCount: 2, errorCount: 0 });
    expect(updates).toHaveLength(2);
    for (const k of ['suppressedCount', 'emailNotification', 'operatorNotification']) expect(body).not.toHaveProperty(k);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.sendDiscord).toHaveBeenCalledTimes(1);
  });

  if (c.enableVar) {
    const enableVar = c.enableVar;
    it('disabled env forces dryRun with existing summary behavior', async () => {
      vi.stubEnv(enableVar, 'false');
      const { updates } = seedDb(c, 2);
      const { body } = await run(c.handler);
      expect(body).toMatchObject({ enabled: false, dryRun: true });
      expect(h.sendEmail).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
      expect(body.operatorNotification).toEqual(opReceipt());
    });
  }

  it('static: suppression guard is first statement of sendOperatorSummary, params destructured', () => {
    const src = extract(c.file);
    const lines = src.split('\n');
    expect(lines[0]).toMatch(/^async function sendOperatorSummary\(\{[^}]*\}\) \{$/);
    const guard = "if (isPreviewSuppressed('telegram')) return operatorSuppressedReceipt('telegram', 'operator-summary');";
    expect(lines[1].trim()).toBe(guard);
    const gi = src.indexOf(guard);
    for (const marker of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'fetch(', 'sendDiscord(']) {
      const i = src.indexOf(marker);
      if (i >= 0) expect(gi).toBeLessThan(i);
    }
  });
});

it('recovery returns 200 without DB and sends nothing', async () => {
  h.db.current = null;
  h.getPreviewFirebaseApp.mockReturnValue(null);
  h.initAdminDb.mockReturnValue(null);
  const { status } = await run(recovery);
  expect(status).toBe(200);
  expect(h.sendEmail).not.toHaveBeenCalled();
});

function extract(file: string): string {
  const src = readFileSync(resolve(process.cwd(), 'api/_crons', file), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function sendOperatorSummary(');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

type SummaryFn = (args: Rec) => Promise<unknown>;
function loadSummary(file: string, env: Record<string, string | undefined>) {
  let reads = 0;
  const fakeEnv = new Proxy({ ...env }, {
    get(t, k) {
      if (typeof k === 'string' && /TELEGRAM|DISCORD|WEBHOOK/.test(k)) reads++;
      return Reflect.get(t, k);
    },
  });
  const localFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const localDiscord = vi.fn(async () => undefined);
  const localConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const factory = new Function(
    'process', 'fetch', 'sendDiscord', 'console', 'isPreviewSuppressed', 'operatorSuppressedReceipt', 'isNotificationSuppressed',
    `return (${extract(file)});`,
  ) as (...deps: unknown[]) => SummaryFn;
  const fn = factory({ env: fakeEnv }, localFetch, localDiscord, localConsole, P.isPreviewSuppressed, P.operatorSuppressedReceipt, P.isNotificationSuppressed);
  return { fn, localFetch, localDiscord, localConsole, reads: () => reads };
}

const summaryArgs: Rec = {
  targetDate: '2026-11-13', matchedCount: 1, sentCount: 1, skippedCount: 0,
  optOutSkipCount: 0, convertedCount: 0, errorCount: 0, dryRun: false,
};

describe.each(cases.map((c) => c.file))('sendOperatorSummary boundary (%s, lexical extraction, local only)', (file) => {
  it('preview suppressed: guard returns before any arg formatting (toString sentinel untouched)', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
    let formatted = 0;
    const sentinel = {
      toString: () => { formatted++; return 'SENTINEL'; },
      valueOf: () => { formatted++; return 0; },
      [Symbol.toPrimitive]: () => { formatted++; return 'SENTINEL'; },
    };
    const args: Rec = Object.fromEntries(Object.keys(summaryArgs).map((k) => [k, sentinel]));
    const { fn, localFetch, localDiscord, localConsole, reads } = loadSummary(file, {
      VERCEL_ENV: 'preview', PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true', TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: 'fake',
    });
    const result = await fn(args);
    expect(result).toEqual(opReceipt());
    expect(formatted).toBe(0);
    expect(reads()).toBe(0);
    expect(localFetch).not.toHaveBeenCalled();
    expect(localDiscord).not.toHaveBeenCalled();
    expect(localConsole.log).not.toHaveBeenCalled();
    expect(localConsole.error).not.toHaveBeenCalled();
    expect(localConsole.warn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.sendDiscord).not.toHaveBeenCalled();
  });

  it('production + missing token/chat: legacy behavior preserved (refund/review no Discord, recovery Discord once)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
    const { fn, localDiscord } = loadSummary(file, {
      VERCEL_ENV: 'production', PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true',
    });
    const result = await fn(summaryArgs);
    expect(P.isNotificationSuppressed(result)).toBe(false);
    expect(localDiscord).toHaveBeenCalledTimes(file === 'preview-lead-recovery.js' ? 1 : 0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.sendDiscord).not.toHaveBeenCalled();
  });

  const scenarios: Array<{ env: string; flag: string | undefined; suppressed: boolean }> = [
    { env: 'preview', flag: 'true', suppressed: true },
    { env: 'production', flag: 'true', suppressed: false },
    { env: 'development', flag: 'true', suppressed: false },
    { env: 'preview', flag: undefined, suppressed: false },
    { env: 'preview', flag: 'false', suppressed: false },
  ];

  it.each(scenarios)('VERCEL_ENV=$env flag=$flag suppressed=$suppressed', async ({ env, flag, suppressed }) => {
    vi.stubEnv('VERCEL_ENV', env);
    vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', flag !== null && flag !== undefined ? flag : '');
    if (flag === undefined) delete process.env.PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS;
    const { fn, localFetch, localDiscord, reads } = loadSummary(file, {
      VERCEL_ENV: env, PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: flag, TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: 'fake',
    });
    const result = await fn(summaryArgs);
    if (suppressed) {
      expect(result).toEqual(opReceipt());
      expect(reads()).toBe(0);
      expect(localFetch).not.toHaveBeenCalled();
      expect(localDiscord).not.toHaveBeenCalled();
    } else {
      expect(reads()).toBeGreaterThan(0);
      expect(localFetch.mock.calls.length + localDiscord.mock.calls.length).toBeGreaterThan(0);
      expect(P.isNotificationSuppressed(result)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.sendDiscord).not.toHaveBeenCalled();
  });
});
