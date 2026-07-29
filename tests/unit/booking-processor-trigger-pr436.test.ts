/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PR #436 — Audit Y-H8 regression slot.
 *
 * Pre-fix: capturePaypalOrder + booking-confirm used
 *
 *   fetch(`${siteUrl}/api/booking-processor`, { ... })
 *     .catch(err => console.error(...));
 *
 * .catch only fires on network errors — HTTP 500/504/etc. return a
 * Response object so the .catch never runs. Result: user got "예약 확정"
 * success while downstream side-effects (Google Sheets, customer email,
 * voucher, Telegram channel #2) silently disappeared. Operator had to
 * manually run /api/admin-replay-booking-notifications, IF they noticed.
 *
 * Post-fix: api/_shared/booking-processor-trigger.js wraps the call with
 *   - 25s AbortController timeout
 *   - response.ok check (treats non-2xx as failure)
 *   - on ANY failure: persist to `pending_processor_retries/{orderID}` +
 *     fire operator Telegram alert
 *   - always resolves (caller fire-and-forget safe)
 *
 * A new `processor-retry-sweep` cron job (every 5min) retries pending
 * docs up to MAX_ATTEMPTS=5 then escalates to manual-intervention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  triggerBookingProcessor,
  PENDING_PROCESSOR_RETRIES_COLLECTION,
} from '../../api/_shared/booking-processor-trigger.js';

const captureSrc = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
const confirmSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/booking-confirm.js'),
  'utf8',
);
const cronSrc = readFileSync(
  resolve(process.cwd(), 'api/_crons/processor-retry-sweep.js'),
  'utf8',
);
const cronRunnerSrc = readFileSync(
  resolve(process.cwd(), 'api/cron-runner.js'),
  'utf8',
);
const vercelJsonSrc = readFileSync(
  resolve(process.cwd(), 'vercel.json'),
  'utf8',
);
const rulesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #436 Y-H8 — triggerBookingProcessor helper behavior', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  function makeDbMock() {
    const persisted: any[] = [];
    const docRef = (id: string) => ({
      set: vi.fn(async (data: any) => { persisted.push({ id, data }); }),
    });
    return {
      collection: vi.fn(() => ({ doc: docRef })),
      _persisted: persisted,
    };
  }

  it('returns ok on 2xx response and does NOT persist a retry', async () => {
    // 🔴 2026-07-29 (의미상 성공 계약): 2xx 만으로는 부족하다. 본문의 outcome 이 completed 여야
    //   성공으로 기록한다. booking-processor 는 내부 단계가 실패해도 200 을 주기 때문이다.
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, outcome: 'completed', data: {} }), { status: 200 },
    )) as any;
    const db = makeDbMock();
    const r = await triggerBookingProcessor({
      db: db as any,
      siteUrl: 'https://example',
      payload: { orderID: 'CT-X-001' },
      source: 'unit-test',
    });
    expect(r.ok).toBe(true);
    expect(db._persisted.length).toBe(0);
  });

  it('🔴 200 이지만 outcome 이 completed 가 아니면 retry 문서를 남긴다', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: false, outcome: 'retryable', data: { stepStatus: { loyalty: 'retryable' } } }),
      { status: 200 },
    )) as any;
    const db = makeDbMock();
    const r = await triggerBookingProcessor({
      db: db as any,
      siteUrl: 'https://example',
      payload: { orderID: 'CT-X-00R' },
      source: 'unit-test',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outcome-retryable');
    expect(db._persisted.length).toBe(1);
  });

  it('persists retry doc + invokes notify on 500 response (silent-fail bug regression)', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    const db = makeDbMock();
    const notify = vi.fn(async () => undefined);
    const r = await triggerBookingProcessor({
      db: db as any,
      siteUrl: 'https://example',
      payload: { orderID: 'CT-X-002', amount: '50' },
      source: 'unit-test',
      notify,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/^http-500$/);
      expect(r.status).toBe(500);
    }
    expect(db._persisted.length).toBe(1);
    expect(db._persisted[0].id).toBe('CT-X-002');
    expect(db._persisted[0].data.status).toBe('pending');
    // notify is fired-and-forgotten — we just check it was *called*.
    expect(notify).toHaveBeenCalledWith('booking', expect.stringContaining('booking-processor 실패'));
  });

  it('persists retry doc on network error (fetch throws)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('econnreset'); }) as any;
    const db = makeDbMock();
    const r = await triggerBookingProcessor({
      db: db as any,
      siteUrl: 'https://example',
      payload: { orderID: 'CT-X-003' },
      source: 'unit-test',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/network/);
    expect(db._persisted.length).toBe(1);
  });

  it('honours the timeoutMs argument (AbortController fires)', async () => {
    global.fetch = vi.fn((_, init: any) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as any;
    const db = makeDbMock();
    const r = await triggerBookingProcessor({
      db: db as any,
      siteUrl: 'https://example',
      payload: { orderID: 'CT-X-004' },
      source: 'unit-test',
      timeoutMs: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^timeout-30ms$/);
  });

  it('never throws even when invalid args are passed (caller fire-and-forget safe)', async () => {
    const r1 = await triggerBookingProcessor({} as any);
    expect(r1.ok).toBe(false);
    const r2 = await triggerBookingProcessor({ siteUrl: 'x' } as any);
    expect(r2.ok).toBe(false);
  });

  it('exports the retry-queue collection name as a stable constant', () => {
    expect(PENDING_PROCESSOR_RETRIES_COLLECTION).toBe('pending_processor_retries');
  });
});

describe('PR #436 Y-H8 — wire-up across endpoints + cron + infra', () => {
  it('capturePaypalOrder imports the helper and no longer uses raw fetch().catch', () => {
    expect(captureSrc).toMatch(
      /import\s*\{[^}]*triggerBookingProcessor[^}]*\}\s*from\s*['"]\.\/_shared\/booking-processor-trigger\.js['"]/,
    );
    expect(captureSrc).toMatch(/triggerBookingProcessor\s*\(/);
    // Regression guard: no inline silent-failure fetch on /api/booking-processor
    const silentFetch = /fetch\(\s*`?\$\{[^}]*\}\/api\/booking-processor`?[\s\S]*?\}\s*\)\s*\.\s*catch\(/;
    expect(captureSrc).not.toMatch(silentFetch);
  });

  it('capture는 예약과 재처리 intent를 한 batch에 저장한 뒤 processor를 await한다', () => {
    const bookingWrite = captureSrc.indexOf("batch.set(db.collection('bookings').doc(orderID)");
    const retryWrite = captureSrc.indexOf('PENDING_PROCESSOR_RETRIES_COLLECTION');
    const triggerCall = captureSrc.indexOf('await triggerBookingProcessor({');
    expect(bookingWrite).toBeGreaterThan(-1);
    expect(retryWrite).toBeGreaterThan(-1);
    expect(triggerCall).toBeGreaterThan(bookingWrite);
    expect(captureSrc).not.toMatch(/void\s+triggerBookingProcessor\s*\(/);
    expect(captureSrc).toMatch(/processorStatus:\s*['"]pending['"]/);
  });

  it('booking-confirm imports the helper and no longer uses raw fetch().catch', () => {
    expect(confirmSrc).toMatch(
      /import\s*\{[^}]*triggerBookingProcessor[^}]*\}\s*from\s*['"]\.\/booking-processor-trigger\.js['"]/,
    );
    expect(confirmSrc).toMatch(/triggerBookingProcessor\s*\(/);
    const silentFetch = /fetch\(\s*`?\$\{[^}]*\}\/api\/booking-processor`?[\s\S]*?\}\s*\)\s*\.\s*catch\(/;
    expect(confirmSrc).not.toMatch(silentFetch);
  });

  it('cron-runner registers the processor-retry-sweep job', () => {
    expect(cronRunnerSrc).toMatch(/processorRetrySweep|processor-retry-sweep/);
    expect(cronRunnerSrc).toMatch(/['"]processor-retry-sweep['"]\s*:\s*processorRetrySweep/);
  });

  it('vercel.json schedules processor-retry-sweep every 5 minutes', () => {
    const json = JSON.parse(vercelJsonSrc);
    const cron = json.crons.find((c: any) => c.path?.includes('processor-retry-sweep'));
    expect(cron, 'processor-retry-sweep cron must be registered').toBeTruthy();
    expect(cron.schedule).toBe('*/5 * * * *');
  });

  it('firestore.rules locks down pending_processor_retries (server-only)', () => {
    expect(rulesSrc).toMatch(
      /match\s+\/pending_processor_retries\/\{orderID\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false/,
    );
  });

  it('cron sweep escalates after MAX_ATTEMPTS and notifies operator', () => {
    expect(cronSrc).toMatch(/MAX_ATTEMPTS\s*=\s*5/);
    expect(cronSrc).toMatch(/manual-intervention/);
    expect(cronSrc).toMatch(/notify\s*\(\s*['"]booking['"]/);
  });
});
