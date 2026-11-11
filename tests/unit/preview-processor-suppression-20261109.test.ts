import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPreviewSuppressed,
  emailSuppressedReceipt,
  sheetsSuppressedReceipt,
} from '../../api/_shared/preview-notification-policy.js';
import {
  STEP,
  stepFromClaimReason,
  stepFromFinalize,
  overallOutcome,
} from '../../api/_shared/processor-outcome.js';
import { CLAIM } from '../../api/_shared/booking-idempotency.js';

// Only bounded source segments are executed, with every outgoing dependency injected
// as a mock parameter. Full processor/handler modules are never imported.
type AsyncFn = (...a: unknown[]) => Promise<unknown>;
type AsyncCtor = new (...args: string[]) => AsyncFn;
const AsyncFunction = Object.getPrototypeOf(async function () { /* ctor */ }).constructor as AsyncCtor;

const NULLISH = '?'.repeat(2);
const proc = readFileSync(resolve(__dirname, '../../api/booking-processor.js'), 'utf8').replace(/\r\n/g, '\n');
const core = readFileSync(resolve(__dirname, '../../api/_ai_core/handlerCore.js'), 'utf8').replace(/\r\n/g, '\n');

function slice(src: string, start: string, end: string, max: number, includeEnd = false): string {
  const a = src.indexOf(start);
  if (a < 0) throw new Error('slice start not found: ' + start);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error('slice end not found: ' + end);
  const s = src.slice(a, includeEnd ? b + end.length : b);
  if (s.length >= max) throw new Error('slice too large (' + s.length + '): ' + start);
  return s;
}

const sheetsSeg = slice(proc, '  let sheetsRowHint = null;', '      // 비치명적 오류 — 계속 진행\n    }\n  }\n', 6000, true);
const step6to7Seg = slice(proc, '  // ── Step 6:', '  // PREVIEW-SUPPRESSION-TEST:STEP7-END', 16000);
const responseSeg = slice(core, '    if (!streamingResponseSent) {', '    } else {', 3000) + '    }\n';
const finalSpreadSeg = slice(proc, '...(results.notificationSuppression', '),', 300, true);

const ENV_KEYS = ['VERCEL_ENV', 'PREVIEW_EMAIL_SUPPRESS', 'PREVIEW_SHEETS_SUPPRESS'] as const;
type EnvKey = (typeof ENV_KEYS)[number];
function setEnv(v: Partial<Record<EnvKey, string | undefined>>): void {
  for (const k of ENV_KEYS) vi.stubEnv(k, (k in v ? v[k] : undefined) as unknown as string);
}
beforeEach(() => { setEnv({}); });
afterEach(() => { vi.unstubAllEnvs(); });

type Results = {
  bookingRef: string;
  steps: Record<string, unknown>;
  stepStatus: Record<string, unknown>;
  notificationSuppression?: Record<string, unknown>;
};

const quiet = { log(): void { /* */ }, warn(): void { /* */ }, error(): void { /* */ }, info(): void { /* */ } };

type RunOpts = { voucherClaimed?: boolean; voucherReason?: string; sendError?: unknown; ambiguous?: boolean };

async function runProcessor(opts: RunOpts = {}) {
  const calls: string[] = [];
  const rec = (name: string, ret: unknown) => async (): Promise<unknown> => { calls.push(name); return ret; };
  const results: Results = { bookingRef: 'TEST-REF', steps: {}, stepStatus: {} };
  const deps: Record<string, unknown> = {
    results,
    orderID: 'order-test',
    booking: { fake: true },
    storedBooking: null,
    isGuestManagedBooking: (): boolean => false,
    stepGuards: { skipSheets: false, skipVoucher: false },
    CLAIM,
    STEP,
    BOOKING_STEP_MARKERS: { sheets: 'sheets', voucher: 'voucher' },
    isPreviewSuppressed,
    sheetsSuppressedReceipt,
    emailSuppressedReceipt,
    claimBookingStep: async (_id: string, marker: string): Promise<unknown> => {
      calls.push('claim:' + marker);
      if (marker !== 'voucher') return { claimed: true };
      return opts.voucherClaimed ? { claimed: true } : { claimed: false, reason: opts.voucherReason || CLAIM.ALREADY_COMPLETED };
    },
    completeBookingStep: async (_id: string, marker: string): Promise<string> => { calls.push('complete:' + marker); return 'completed'; },
    releaseBookingStep: async (_id: string, marker: string): Promise<void> => { calls.push('release:' + marker); },
    stepFromClaimReason,
    stepFromFinalize,
    appendBooking: rec('appendBooking', { appendedRow: 7, deduped: false }),
    updateBookingStatus: rec('updateBookingStatus', undefined),
    generateConfirmationEmail: rec('generateConfirmationEmail', 'x'),
    generateVoucherText: rec('generateVoucherText', 'x'),
    buildDefaultConfirmationEmail: (): string => { calls.push('buildDefault'); return 'x'; },
    sendBookingConfirmation: async (): Promise<unknown> => {
      calls.push('sendBookingConfirmation');
      if (opts.sendError) throw opts.sendError;
      return undefined;
    },
    isAmbiguousSendError: (): boolean => opts.ambiguous === true,
    markOutcomeUnknown: rec('markOutcomeUnknown', undefined),
    notify: async (): Promise<void> => { calls.push('notify'); },
    escapeTelegram: (s: unknown): string => String(s),
    stepDb: (): null => { calls.push('stepDb'); return null; },
    initAdminDb: (): null => { calls.push('initAdminDb'); return null; },
    walletUrl: '', itineraryData: null, language: 'en', payerEmail: 'redacted', pdfBuffer: null,
    console: quiet,
    fetch: async (): Promise<never> => { throw new Error('network denied in test'); },
  };
  const names = Object.keys(deps);
  const fn = new AsyncFunction(...names, sheetsSeg + step6to7Seg + '\nreturn results;');
  await fn(...names.map((k) => deps[k]));
  return { results, calls };
}

function expectStringSteps(r: Results): void {
  for (const v of Object.values(r.steps)) expect(typeof v).toBe('string');
}

describe('policy flags (real isPreviewSuppressed)', () => {
  it.each([undefined, '', 'false', 'yes-please', 'true'])('preview suppresses all channels with flag %s', (value) => {
    setEnv({ VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: value, PREVIEW_SHEETS_SUPPRESS: value });
    expect(isPreviewSuppressed('email')).toBe(true);
    expect(isPreviewSuppressed('sheets')).toBe(true);
  });
  it.each(['production', 'development'])('%s with flags true never suppresses', (env) => {
    setEnv({ VERCEL_ENV: env, PREVIEW_EMAIL_SUPPRESS: 'true', PREVIEW_SHEETS_SUPPRESS: 'true' });
    expect(isPreviewSuppressed('email')).toBe(false);
    expect(isPreviewSuppressed('sheets')).toBe(false);
  });
  it('receipts are explicit', () => {
    expect(emailSuppressedReceipt()).toMatchObject({ status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', sent: false, delivery: 'not_attempted' });
    expect(sheetsSuppressedReceipt('append')).toMatchObject({ status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', write: 'not_attempted' });
  });
});

describe('booking-processor segments', () => {
  it('normal: email generators, send and completion run; no receipts', async () => {
    setEnv({ VERCEL_ENV: 'production' });
    const { results, calls } = await runProcessor({ voucherClaimed: true });
    expect(calls).toContain('claim:sheets');
    expect(calls).toContain('claim:voucher');
    expect(calls).toContain('sendBookingConfirmation');
    expect(calls).toContain('complete:voucher');
    expect(calls.some((c) => c === 'generateConfirmationEmail' || c === 'buildDefault')).toBe(true);
    expect(calls.indexOf('claim:voucher')).toBeLessThan(calls.indexOf('sendBookingConfirmation'));
    expect(calls.indexOf('sendBookingConfirmation')).toBeLessThan(calls.indexOf('complete:voucher'));
    expect(calls).toContain('generateVoucherText');
    expect(results.steps.email).toBe('ok');
    expect(results.steps.voucherStatus).toBe('ok');
    expect(calls).not.toContain('release:voucher');
    expect(results.notificationSuppression).toBeUndefined();
    expectStringSteps(results);
  });

  it('both suppressed: zero calls, explicit receipts', async () => {
    setEnv({ VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: 'true', PREVIEW_SHEETS_SUPPRESS: 'true' });
    const { results, calls } = await runProcessor({ voucherClaimed: true });
    expect(calls).toEqual([]);
    expectStringSteps(results);
    expect(results.steps.voucherStatus).toBe('suppressed: preview_policy');
    expect(results.stepStatus.sheets).toBe(STEP.SKIPPED);
    expect(results.stepStatus.email).toBe(STEP.SKIPPED);
    expect(results.notificationSuppression).toEqual({
      sheets: sheetsSuppressedReceipt('append'),
      email: emailSuppressedReceipt(),
      sheetsUpdate: sheetsSuppressedReceipt('update_status'),
    });
  });

  it.each(['email', 'sheets'])('only %s flag present still suppresses all preview deliveries', async (channel) => {
    setEnv({ VERCEL_ENV: 'preview', ...(channel === 'email' ? { PREVIEW_EMAIL_SUPPRESS: 'true' } : { PREVIEW_SHEETS_SUPPRESS: 'true' }) });
    const { results, calls } = await runProcessor({ voucherClaimed: true });
    expect(calls).toEqual([]);
    expect(results.notificationSuppression).toEqual({
      sheets: sheetsSuppressedReceipt('append'),
      email: emailSuppressedReceipt(),
      sheetsUpdate: sheetsSuppressedReceipt('update_status'),
    });
    expectStringSteps(results);
  });

  it('unknown claim preserves OUTCOME_UNKNOWN (notify mocked)', async () => {
    setEnv({ VERCEL_ENV: 'production' });
    const { results, calls } = await runProcessor({ voucherReason: CLAIM.OUTCOME_UNKNOWN });
    expect(calls).toContain('notify');
    expect(results.stepStatus.email).toBe(STEP.OUTCOME_UNKNOWN);
    expect(calls).not.toContain('sendBookingConfirmation');
    expect(results.notificationSuppression).toBeUndefined();
    expectStringSteps(results);
  });

  it('ambiguous send error: no release, null stepDb/initAdminDb only', async () => {
    setEnv({ VERCEL_ENV: 'production' });
    const { results, calls } = await runProcessor({ voucherClaimed: true, sendError: new Error('socket hang up'), ambiguous: true });
    expect(calls).toContain('sendBookingConfirmation');
    expect(calls).not.toContain('release:voucher');
    expect(calls).not.toContain('complete:voucher');
    expect(calls).toContain('stepDb');
    expect(calls).toContain('initAdminDb');
    expect(calls).not.toContain('markOutcomeUnknown');
    expect(results.stepStatus.email).toBe(STEP.OUTCOME_UNKNOWN);
    expectStringSteps(results);
  });

  it('final data spread (extracted) is conditional', () => {
    const build = new Function('results', 'return { ' + finalSpreadSeg.replace(/,$/, '') + ' };') as (r: Results) => Record<string, unknown>;
    expect('notificationSuppression' in build({ bookingRef: 'r', steps: {}, stepStatus: {} })).toBe(false);
    const receipt = { email: emailSuppressedReceipt() };
    expect(build({ bookingRef: 'r', steps: {}, stepStatus: {}, notificationSuppression: receipt }).notificationSuppression).toEqual(receipt);
  });
});

describe('overallOutcome with explicit loyalty', () => {
  const base = { sheets: STEP.SKIPPED, email: STEP.SKIPPED };
  it('completed', () => { expect(overallOutcome({ ...base, loyalty: STEP.COMPLETED })).toBe('completed'); });
  it('retryable', () => { expect(overallOutcome({ ...base, loyalty: STEP.RETRYABLE })).toBe('retryable'); });
  it('outcome unknown -> manual_intervention', () => { expect(overallOutcome({ ...base, loyalty: STEP.OUTCOME_UNKNOWN })).toBe('manual_intervention'); });
});

async function runResponse(email: string) {
  let body = '';
  const deps: Record<string, unknown> = {
    streamingResponseSent: false,
    buildAdminDebug: (): null => null,
    gate: null, PLANNER_MODE: 'x', abDecision: null, identifierForBucketing: null,
    blockModeUsed: null, blocksUsed: null, useStreaming: false, itinerary: { days: [] },
    res: { writeHead(): void { /* */ }, end(s: string): void { body = s; } },
    CORS: {},
    _ok: (d: unknown): unknown => ({ success: true, data: d }),
    planId: 'p1', planUrl: 'u', email,
    vehicle: 'staria_8', VEHICLE_LABELS: { staria_8: 'Staria' }, priceKRW: 1, priceUSD: 1,
    isPreviewSuppressed,
    emailSuppressedReceipt,
  };
  const names = Object.keys(deps);
  await new AsyncFunction(...names, responseSeg)(...names.map((k) => deps[k]));
  return JSON.parse(body) as { data: Record<string, unknown> };
}

describe('handlerCore normal response', () => {
  it('suppressed: emailSent false + receipt', async () => {
    setEnv({ VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: 'true' });
    const r = await runResponse('a@b.c');
    expect(r.data.emailSent).toBe(false);
    expect(r.data.emailDelivery).toEqual(emailSuppressedReceipt());
  });
  it('suppressed with empty email: explicit policy receipt', async () => {
    setEnv({ VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: 'true' });
    const r = await runResponse('');
    expect(r.data.emailSent).toBe(false);
    expect(r.data.emailDelivery).toEqual(emailSuppressedReceipt());
  });
  it('not suppressed: legacy shape', async () => {
    setEnv({ VERCEL_ENV: 'production', PREVIEW_EMAIL_SUPPRESS: 'true' });
    const r = await runResponse('a@b.c');
    expect(r.data.emailSent).toBe(true);
    expect('emailDelivery' in r.data).toBe(false);
  });
});

describe('source regression', () => {
  it('gates precede claims', () => {
    const sg = proc.indexOf("isPreviewSuppressed('sheets')");
    const eg = proc.indexOf("isPreviewSuppressed('email')");
    expect(sg).toBeGreaterThan(-1);
    expect(eg).toBeGreaterThan(-1);
    expect(sg).toBeLessThan(proc.indexOf('claimBookingStep(orderID, BOOKING_STEP_MARKERS.sheets)'));
    expect(eg).toBeLessThan(proc.indexOf('claimBookingStep(orderID, BOOKING_STEP_MARKERS.voucher)'));
  });
  it('no nullish coalescing in tested segments', () => {
    for (const s of [sheetsSeg, step6to7Seg, responseSeg, finalSpreadSeg]) expect(s.includes(NULLISH)).toBe(false);
  });
});
