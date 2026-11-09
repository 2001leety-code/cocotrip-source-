import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const m = vi.hoisted(() => ({
  initAdminDb: vi.fn(),
  callBot: vi.fn(),
  computeExpiryDate: vi.fn(() => new Date(0)),
  esc: vi.fn((s: string) => s),
}));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: m.initAdminDb }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => n),
    arrayUnion: vi.fn((...a: unknown[]) => a),
  },
}));
vi.mock('../../api/_shared/dispatch-sweep.js', () => ({ computeExpiryDate: m.computeExpiryDate }));
vi.mock('../../api/_shared/telegram-bot.js', () => ({ callBot: m.callBot }));
vi.mock('../../api/_shared/escape.js', () => ({ escapeTelegram: m.esc }));

import { sendDispatchToDriver, broadcastDispatchToDrivers } from '../../api/_shared/dispatch-helpers.js';
import {
  isPreviewSuppressed,
  operatorSuppressedReceipt,
  isNotificationSuppressed,
} from '../../api/_shared/preview-notification-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const fetchTrap = vi.fn(() => Promise.reject(new Error('fetch trap: no network allowed')));

function trapOpts(): Record<string, unknown> {
  const fail = (): never => {
    throw new Error('opts accessed while suppressed');
  };
  return new Proxy({}, { get: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail });
}

function setEnv(vercelEnv: string | undefined): void {
  vi.stubEnv('VERCEL_ENV', vercelEnv);
  vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
}

async function settle(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
}

function normalOpts(): Record<string, unknown> {
  return {
    orderID: 'TEST-ORDER-1',
    booking: { bookingRef: 'TEST-ORDER-1' },
    driverId: 'drv-test',
    driverChatId: '0',
    driverBotToken: 'test-token-not-real',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchTrap);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('dispatch helpers under preview suppression', () => {
  it('sendDispatchToDriver returns real suppressed receipt with zero side effects', async () => {
    setEnv('preview');
    expect(isPreviewSuppressed('telegram')).toBe(true);
    const r = await sendDispatchToDriver(trapOpts());
    expect(r).toEqual(operatorSuppressedReceipt('telegram', 'driverDispatch'));
    expect(isNotificationSuppressed(r)).toBe(true);
    expect(m.initAdminDb).not.toHaveBeenCalled();
    expect(m.callBot).not.toHaveBeenCalled();
    expect(m.esc).not.toHaveBeenCalled();
    expect(m.computeExpiryDate).not.toHaveBeenCalled();
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it('broadcastDispatchToDrivers returns aggregate with skipped recipient lookup and no total', async () => {
    setEnv('preview');
    const r = await broadcastDispatchToDrivers(trapOpts());
    expect(r).toEqual({
      ...operatorSuppressedReceipt('telegram', 'driverBroadcast'),
      sent: 0,
      failed: 0,
      errors: [],
      recipientLookup: 'skipped',
    });
    expect(isNotificationSuppressed(r)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(r, 'total')).toBe(false);
    expect(m.initAdminDb).not.toHaveBeenCalled();
    expect(m.callBot).not.toHaveBeenCalled();
    expect(fetchTrap).not.toHaveBeenCalled();
  });
});

describe.each([
  { label: 'production', env: 'production' },
  { label: 'development', env: 'development' },
  { label: 'unset', env: undefined },
])('dispatch helpers not suppressed when VERCEL_ENV=$label', ({ env }) => {
  it('sendDispatchToDriver reaches DB init (unavailable branch)', async () => {
    setEnv(env);
    expect(isPreviewSuppressed('telegram')).toBe(false);
    m.initAdminDb.mockReturnValue(null);
    const r = await settle(() => sendDispatchToDriver(normalOpts()));
    expect(m.initAdminDb).toHaveBeenCalled();
    expect(isNotificationSuppressed(r)).toBe(false);
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it('broadcastDispatchToDrivers reaches DB init (unavailable branch)', async () => {
    setEnv(env);
    m.initAdminDb.mockReturnValue(null);
    const r = await settle(() => broadcastDispatchToDrivers(normalOpts()));
    expect(m.initAdminDb).toHaveBeenCalled();
    expect(isNotificationSuppressed(r)).toBe(false);
    expect(fetchTrap).not.toHaveBeenCalled();
  });
});

describe('booking-processor Step 3.5 (bounded real source)', () => {
  const src = readFileSync(resolve(here, '../../api/booking-processor.js'), 'utf8').replace(/\r\n/g, '\n');
  const BEGIN = '// @@STEP35_DISPATCH_BEGIN';
  const END = '// @@STEP35_DISPATCH_END';
  const NEEDLE = "await import('./_shared/dispatch-helpers.js')";

  type Step35 = (...args: unknown[]) => Promise<void>;

  function buildStep35(): Step35 {
    const s = src.indexOf(BEGIN);
    const e = src.indexOf(END);
    expect(s).toBeGreaterThan(-1);
    expect(e).toBeGreaterThan(s);
    expect(src.indexOf(BEGIN, s + 1)).toBe(-1);
    expect(src.indexOf(END, e + 1)).toBe(-1);
    let body = src.slice(s + BEGIN.length, e);
    expect(body.split(NEEDLE).length).toBe(2);
    body = body.replace(NEEDLE, 'await __importDispatch()');
    expect(body.includes('import(')).toBe(false);
    expect(/\bimport\b/.test(body)).toBe(false);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => Step35;
    return new AsyncFunction(
      'process',
      'booking',
      'results',
      'console',
      'isPreviewSuppressed',
      'operatorSuppressedReceipt',
      '__importDispatch',
      body,
    );
  }

  function makeDeps() {
    const broadcast = vi.fn(async () => ({ ok: true, sent: 1, failed: 0, errors: [] as string[] }));
    const importer = vi.fn(async () => ({ broadcastDispatchToDrivers: broadcast }));
    const quiet = { log: vi.fn(), error: vi.fn() };
    return { broadcast, importer, quiet };
  }

  it('enabled + preview: no import, no call, suppressed step, receipt merged', async () => {
    setEnv('preview');
    const step = buildStep35();
    const { broadcast, importer, quiet } = makeDeps();
    const existing = operatorSuppressedReceipt('telegram', 'otherChannel');
    const results: Record<string, unknown> = {
      steps: {} as Record<string, string>,
      notificationSuppression: { other: existing },
    };
    await step(
      { env: { AUTO_DISPATCH_BROADCAST: '1' } },
      { bookingRef: 'TEST-ORDER-1' },
      results,
      quiet,
      isPreviewSuppressed,
      operatorSuppressedReceipt,
      importer,
    );
    expect(importer).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(m.initAdminDb).not.toHaveBeenCalled();
    expect((results.steps as Record<string, string>).dispatchBroadcast).toBe('suppressed: preview_policy');
    const ns = results.notificationSuppression as Record<string, unknown>;
    expect(ns.other).toEqual(existing);
    expect(ns.dispatchBroadcast).toEqual(operatorSuppressedReceipt('telegram', 'dispatchBroadcast'));
    expect(isNotificationSuppressed(ns.dispatchBroadcast)).toBe(true);
  });

  it('disabled (explicit empty env): untouched even in preview', async () => {
    setEnv('preview');
    const step = buildStep35();
    const { importer, quiet } = makeDeps();
    const results: Record<string, unknown> = { steps: {} as Record<string, string> };
    await step({ env: {} }, { bookingRef: 'X' }, results, quiet, isPreviewSuppressed, operatorSuppressedReceipt, importer);
    expect(importer).not.toHaveBeenCalled();
    expect(results).toEqual({ steps: {} });
  });

  it('enabled + production: normal branch imports and calls', async () => {
    setEnv('production');
    const step = buildStep35();
    const { broadcast, importer, quiet } = makeDeps();
    const results: Record<string, unknown> = { steps: {} as Record<string, string> };
    const booking = { bookingRef: 'TEST-ORDER-2' };
    await step({ env: { AUTO_DISPATCH_BROADCAST: '1' } }, booking, results, quiet, isPreviewSuppressed, operatorSuppressedReceipt, importer);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ orderID: 'TEST-ORDER-2', booking });
    expect((results.steps as Record<string, string>).dispatchBroadcast).toBe('sent=1 failed=0');
    expect(Object.prototype.hasOwnProperty.call(results, 'notificationSuppression')).toBe(false);
  });

  it('enabled + production + missing bookingRef: unchanged skip', async () => {
    setEnv('production');
    const step = buildStep35();
    const { importer, quiet } = makeDeps();
    const results: Record<string, unknown> = { steps: {} as Record<string, string> };
    await step({ env: { AUTO_DISPATCH_BROADCAST: '1' } }, {}, results, quiet, isPreviewSuppressed, operatorSuppressedReceipt, importer);
    expect(importer).not.toHaveBeenCalled();
    expect((results.steps as Record<string, string>).dispatchBroadcast).toBe('skip: no bookingRef');
  });
});

