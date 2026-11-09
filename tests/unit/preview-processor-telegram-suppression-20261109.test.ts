import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPreviewSuppressed,
  operatorSuppressedReceipt,
} from '../../api/_shared/preview-notification-policy.js';

const START = '// @@STEP3_TELEGRAM_STATE_START@@';
const END = '// @@STEP3_TELEGRAM_STATE_END@@';
const IMPORT_TOKEN = "await import('firebase-admin/firestore')";

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function extractSegment(): string {
  const raw = readFileSync(resolve(process.cwd(), 'api/booking-processor.js'), 'utf8').replace(/\r\n/g, '\n');
  expect(countOf(raw, START)).toBe(1);
  expect(countOf(raw, END)).toBe(1);
  const segment = raw.slice(raw.indexOf(START), raw.indexOf(END) + END.length);
  expect(countOf(segment, IMPORT_TOKEN)).toBe(1);
  const replaced = segment.replace(IMPORT_TOKEN, 'await __importFirestore()');
  expect(countOf(replaced, 'import(')).toBe(0);
  expect(/\bimport\s*\(/.test(replaced)).toBe(false);
  return replaced;
}

type Result = { ok?: boolean; delivery?: string; error?: string };
type SendFn = (b: unknown) => Promise<Result>;
type Results = { steps: Record<string, string>; notificationSuppression?: Record<string, unknown> };
type Env = Record<string, string | undefined> | undefined;

const PARAMS = [
  'orderID', 'booking', 'results', 'claimBookingStep', 'releaseBookingStep', 'completeStep',
  'markOutcomeUnknown', 'stepDb', 'BOOKING_STEP_MARKERS', 'sendDispatchAlert', 'sendBookingPaymentAlert',
  'isPreviewSuppressed', 'operatorSuppressedReceipt', '__importFirestore', 'console',
];

const AsyncFunction = Object.getPrototypeOf(async function () { /* noop */ }).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<void>;

const realIsSuppressed = isPreviewSuppressed as unknown as (ch: string, env: unknown) => boolean;
const realReceipt = operatorSuppressedReceipt as unknown as (...a: unknown[]) => Record<string, unknown>;

function policyFor(env: Env): (ch: string) => boolean {
  return (ch: string) => realIsSuppressed(ch, env);
}

interface Harness {
  results: Results;
  claim: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  unknown: ReturnType<typeof vi.fn>;
  stepDb: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  payment: ReturnType<typeof vi.fn>;
  importFs: ReturnType<typeof vi.fn>;
  receiptSpy: ReturnType<typeof vi.fn>;
}

let fetchTrap: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchTrap = vi.fn(() => { throw new Error('fetch must not be called'); });
  vi.stubGlobal('fetch', fetchTrap);
});
afterEach(() => {
  expect(fetchTrap).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

async function run(opts: {
  env: Env;
  claimed?: boolean;
  dispatchImpl?: SendFn;
  paymentImpl?: SendFn;
  results?: Results;
}): Promise<Harness> {
  const results: Results = opts.results ? opts.results : { steps: {} };
  const claimed = opts.claimed === undefined ? true : opts.claimed;
  const okSend: SendFn = async () => ({ ok: true, delivery: 'sent' });
  const h: Harness = {
    results,
    claim: vi.fn(async () => (claimed ? { claimed: true } : { claimed: false, reason: 'already_done' })),
    release: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    unknown: vi.fn(async () => undefined),
    stepDb: vi.fn(() => ({ fake: 'db' })),
    dispatch: vi.fn(opts.dispatchImpl ? opts.dispatchImpl : okSend),
    payment: vi.fn(opts.paymentImpl ? opts.paymentImpl : okSend),
    importFs: vi.fn(async () => ({ FieldValue: { fake: 'FieldValue' } })),
    receiptSpy: vi.fn((...a: unknown[]) => realReceipt(...a)),
  };
  const quietConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fn = new AsyncFunction(...PARAMS, extractSegment());
  await fn(
    'ORDER-TEST', { id: 'b' }, results, h.claim, h.release, h.complete, h.unknown, h.stepDb,
    { telegramDispatch: 'tgDispatch', telegramPayment: 'tgPayment' },
    h.dispatch, h.payment, policyFor(opts.env), h.receiptSpy, h.importFs, quietConsole,
  );
  return h;
}

const PREVIEW: Env = { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true', VERCEL_ENV: 'preview' };

describe('Step3 telegram preview suppression', () => {
  it('preview: zero claims/sends/DB, string status, receipts preserved', async () => {
    const prior = { email: { sent: false }, sheets: { sent: false } };
    const h = await run({ env: PREVIEW, results: { steps: {}, notificationSuppression: { ...prior } } });
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.payment).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.unknown).not.toHaveBeenCalled();
    expect(h.stepDb).not.toHaveBeenCalled();
    expect(h.importFs).not.toHaveBeenCalled();
    expect(typeof h.results.steps.telegram).toBe('string');
    expect(h.results.steps.telegram).toBe('suppressed: preview_policy');
    const ns = h.results.notificationSuppression as Record<string, unknown>;
    expect(ns.email).toEqual(prior.email);
    expect(ns.sheets).toEqual(prior.sheets);

    expect(h.receiptSpy).toHaveBeenCalledTimes(2);
    const expected = h.receiptSpy.mock.calls.map((args) => realReceipt(...args));
    const tg = ns.telegram as Record<string, Record<string, unknown>>;
    expect(tg).toEqual({ dispatch: expected[0], payment: expected[1] });
    for (const r of [tg.dispatch, tg.payment]) {
      expect(r).toHaveProperty('transport');
      expect(r).toHaveProperty('channel');
      expect(r.transport).toBe('telegram');
      expect(r.sent).toBe(false);
      expect(r).not.toHaveProperty('kind');
      expect(r).not.toHaveProperty('logicalChannel');
    }
    expect(tg.dispatch.channel).not.toEqual(tg.payment.channel);
  });

  it('preview without prior suppression object creates one', async () => {
    const h = await run({ env: PREVIEW });
    const ns = h.results.notificationSuppression as Record<string, unknown>;
    expect(Object.keys(ns)).toEqual(['telegram']);
  });

  const normalEnvs: Array<[string, Env]> = [
    ['production', { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true', VERCEL_ENV: 'production' }],
    ['development', { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true', VERCEL_ENV: 'development' }],
    ['missing flag', { VERCEL_ENV: 'preview' }],
    ['invalid flag TRUE', { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'TRUE', VERCEL_ENV: 'preview' }],
    ['invalid flag trailing space', { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true ', VERCEL_ENV: 'preview' }],
    ['flag false', { PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'false', VERCEL_ENV: 'preview' }],
    ['unset', {}],
    ['missing env', undefined],
  ];
  for (const [name, env] of normalEnvs) {
    it(`${name}: normal sent -> complete`, async () => {
      const h = await run({ env });
      expect(h.claim).toHaveBeenCalledTimes(2);
      expect(h.dispatch).toHaveBeenCalledTimes(1);
      expect(h.payment).toHaveBeenCalledTimes(1);
      expect(h.complete).toHaveBeenCalledTimes(2);
      expect(h.release).not.toHaveBeenCalled();
      expect(h.unknown).not.toHaveBeenCalled();
      expect(h.receiptSpy).not.toHaveBeenCalled();
      expect(h.results.steps.telegram).toBe('ok');
      expect(h.results.notificationSuppression).toBeUndefined();
    });
  }

  it('rejected/skipped -> release', async () => {
    const h = await run({
      env: {},
      dispatchImpl: async () => ({ ok: false, delivery: 'rejected' }),
      paymentImpl: async () => ({ ok: false, delivery: 'skipped' }),
    });
    expect(h.release).toHaveBeenCalledTimes(2);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.unknown).not.toHaveBeenCalled();
    expect(h.results.steps.telegram).toBe('partial: dispatch=rejected payment=skipped');
  });

  it('unknown/throw -> quarantine, no release', async () => {
    const h = await run({
      env: {},
      dispatchImpl: async () => ({ ok: false, delivery: 'unknown', error: 'timeout' }),
      paymentImpl: async () => { throw new Error('boom'); },
    });
    expect(h.unknown).toHaveBeenCalledTimes(2);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.results.steps.telegram).toBe('partial: dispatch=unknown payment=unknown');
  });

  it('unclaimed -> no send', async () => {
    const h = await run({ env: {}, claimed: false });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.payment).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
    expect(h.unknown).not.toHaveBeenCalled();
    expect(h.results.steps.telegram).toBe('skip: dispatch=skip:already_done payment=skip:already_done');
  });
});

