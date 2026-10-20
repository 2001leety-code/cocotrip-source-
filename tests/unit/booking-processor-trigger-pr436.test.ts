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
import {
  acquirePaymentAttempt,
  persistBookingsAtomically,
} from '../../api/_shared/payment-fulfillment-recovery.js';

/** In-memory Firestore: transaction writes are staged and committed only when the callback resolves. */
function memoryDb() {
  const store = new Map<string, any>();
  const isPlain = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const mergeDeep = (base: any, patch: any): any => {
    if (!isPlain(base)) return { ...patch };
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(base[k]) ? mergeDeep(base[k], v) : v;
    return out;
  };
  const read = (path: string) => {
    const data = store.get(path);
    return { exists: !!data, data: () => (data ? structuredClone(data) : undefined) };
  };
  const write = (path: string, data: any, merge = false) => { store.set(path, merge ? mergeDeep(store.get(path), data) : { ...data }); };
  const db = {
    _store: store,
    _transactions: 0,
    collection: (name: string) => ({
      doc: (id: string) => ({ __path: `${name}/${id}`, get: async () => read(`${name}/${id}`) }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      db._transactions += 1;
      const staged: Array<() => void> = [];
      const result = await fn({
        get: async (ref: any) => read(ref.__path),
        set: (ref: any, data: any, opts?: any) => { staged.push(() => write(ref.__path, data, !!(opts && opts.merge))); },
        update: (ref: any, data: any) => { staged.push(() => write(ref.__path, data, true)); },
        delete: (ref: any) => { staged.push(() => { store.delete(ref.__path); }); },
      });
      staged.forEach((commit) => commit());
      return result;
    },
  };
  return db;
}

async function claimedAttempt(db: ReturnType<typeof memoryDb>, orderID: string) {
  const acquired: any = await acquirePaymentAttempt({
    db, orderID, flow: 'single', environment: 'live', requestKey: `${orderID}-cap`, intent: { version: 1, body: {} },
  });
  expect(acquired.kind).toBe('claimed');
  return acquired.attempt;
}

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

  // 2026-10-10: 예약 + 재처리 intent 저장은 인라인 batch 에서 공유 트랜잭션 헬퍼
  //   persistBookingsAtomically 로 이동했다. 계약(한 번에 저장 → 그 뒤에만 processor 를 await)은
  //   그대로이며, 헬퍼 동작은 아래 행위 테스트가, 호출 순서는 이 소스 단언이 고정한다.
  it('capture는 예약과 재처리 intent를 공유 트랜잭션으로 저장한 뒤 processor를 await한다', () => {
    const persistCall = captureSrc.indexOf('persistBookingsAtomically(');
    const okGate = captureSrc.indexOf('if (!bookingWriteOk)');
    const triggerCall = captureSrc.indexOf('await triggerBookingProcessor({');
    expect(persistCall).toBeGreaterThan(-1);
    expect(okGate).toBeGreaterThan(persistCall);
    expect(triggerCall).toBeGreaterThan(okGate);
    // 저장 실패 분기는 processor 호출 전에 응답을 끝낸다(유령 예약/후속처리 금지).
    expect(captureSrc.slice(okGate, triggerCall)).toMatch(/return res\.end/);
    // 같은 트랜잭션 호출에 예약 문서와 processor payload(= intent) 가 함께 들어간다.
    const persistArgs = captureSrc.slice(persistCall, okGate);
    expect(persistArgs).toMatch(/bookingDocPayload/);
    expect(persistArgs).toMatch(/processorPayload/);
    expect(captureSrc).not.toMatch(/void\s+triggerBookingProcessor\s*\(/);
    expect(captureSrc).toMatch(/processorStatus:\s*['"]pending['"]/);
    expect(captureSrc).toMatch(
      /await\s+triggerBookingProcessor\s*\(\s*\{[\s\S]*?timeoutMs:\s*45_000[\s\S]*?\}\s*\)/,
    );
  });

  it('persistBookingsAtomically: 예약 문서와 pending 재처리 intent 를 한 트랜잭션으로 저장', async () => {
    const db = memoryDb();
    const attempt = await claimedAttempt(db, 'CT-ATOM-1');
    const before = db._transactions;
    const result: any = await persistBookingsAtomically({
      db, attempt, timestamp: 'TS', lockPatch: { captureID: 'CAP-1' },
      bookings: [{ orderID: 'CT-ATOM-1', doc: { status: 'CONFIRMED', processorStatus: 'pending' }, payload: { orderID: 'CT-ATOM-1' }, source: 'capturePaypalOrder' }],
    });
    expect(db._transactions - before).toBe(1);
    // 2026-10-10 held-intent contract: a NEW intent is durable but NOT runnable ('held') until the capture
    //   handler settles the mandatory slot/promo checks and releases it to 'pending' (cron selects pending only).
    expect(result.retryStatus).toEqual({ 'CT-ATOM-1': 'held' });
    expect(db._store.get('bookings/CT-ATOM-1')).toMatchObject({ status: 'CONFIRMED', processorStatus: 'pending' });
    expect(db._store.get(`${PENDING_PROCESSOR_RETRIES_COLLECTION}/CT-ATOM-1`)).toMatchObject({
      status: 'held', heldReason: 'awaiting_mandatory_checks', attempts: 0, payload: { orderID: 'CT-ATOM-1' }, source: 'capturePaypalOrder',
    });
    expect(db._store.get('used_paypal_orders/CT-ATOM-1')).toMatchObject({ bookingDurable: true, status: 'captured', captureID: 'CAP-1' });
  });

  it('persistBookingsAtomically: 기존 예약/종결된 intent 를 덮어쓰지 않고 그 상태를 돌려준다 (재처리 재발송 방지)', async () => {
    const db = memoryDb();
    const attempt = await claimedAttempt(db, 'CT-ATOM-2');
    db._store.set('bookings/CT-ATOM-2', { status: 'CONFIRMED', processorStatus: 'completed' });
    db._store.set(`${PENDING_PROCESSOR_RETRIES_COLLECTION}/CT-ATOM-2`, { status: 'done', attempts: 2 });
    const result: any = await persistBookingsAtomically({
      db, attempt, timestamp: 'TS',
      bookings: [{ orderID: 'CT-ATOM-2', doc: { status: 'CONFIRMED', processorStatus: 'pending' }, payload: {}, source: 'capturePaypalOrder' }],
    });
    expect(result.retryStatus).toEqual({ 'CT-ATOM-2': 'done' });
    expect(result.created).toEqual([]);
    expect(db._store.get('bookings/CT-ATOM-2')).toEqual({ status: 'CONFIRMED', processorStatus: 'completed' });
    expect(db._store.get(`${PENDING_PROCESSOR_RETRIES_COLLECTION}/CT-ATOM-2`)).toEqual({ status: 'done', attempts: 2 });
  });

  it('persistBookingsAtomically: claim 을 잃으면 예약도 intent 도 쓰지 않는다 (all-or-nothing)', async () => {
    const db = memoryDb();
    const attempt = await claimedAttempt(db, 'CT-ATOM-3');
    db._store.set('used_paypal_orders/CT-ATOM-3', { ...db._store.get('used_paypal_orders/CT-ATOM-3'), claimToken: 'other-worker' });
    await expect(persistBookingsAtomically({
      db, attempt, timestamp: 'TS',
      bookings: [{ orderID: 'CT-ATOM-3', doc: { status: 'CONFIRMED' }, payload: {}, source: 'capturePaypalOrder' }],
    })).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(db._store.has('bookings/CT-ATOM-3')).toBe(false);
    expect(db._store.has(`${PENDING_PROCESSOR_RETRIES_COLLECTION}/CT-ATOM-3`)).toBe(false);
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
