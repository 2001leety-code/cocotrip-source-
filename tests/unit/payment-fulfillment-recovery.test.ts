import { describe, expect, it, vi } from 'vitest';
import {
  omitUndefined, newCheckoutCapability, checkoutCookie, hasCheckoutCapability, isSameOrderAuthorized, classifyCaptureResponse,
  classifyOrderLookup, acquirePaymentAttempt, persistBookingsAtomically, makeRetryPersister, recordProcessorResult,
  reconcileCapture, findUnfinishedCheckout, validateIntent, discardAttempt,
} from '../../api/_shared/payment-fulfillment-recovery.js';

// Offline in-memory Firestore: reads before writes, atomic commit, injectable write failure.
type Row = Record<string, unknown>;
type SetOptions = { merge?: boolean };
type Snapshot = { exists: boolean; data: () => Row };
type DocRef = {
  path: string;
  id: string | undefined;
  get: () => Promise<Snapshot>;
  set: (value: Row, options?: SetOptions) => Promise<void>;
  update: (value: Row) => Promise<void>;
  delete: () => Promise<void>;
  collection: (name: string) => { doc: (id: string) => DocRef };
};
type Tx = {
  get: (ref: DocRef) => Promise<Snapshot>;
  set: (ref: DocRef, value: Row, options?: SetOptions) => void;
  update: (ref: DocRef, value: Row) => void;
  delete: (ref: DocRef) => void;
};
/** Shape of a claimed acquirePaymentAttempt result as these tests read it. */
type ClaimedAttempt = { kind: string; attempt: { recovering: boolean; lock: Row } & Row };
function memoryDb(failPath = '') {
  const rows = new Map<string, Row>();
  let shouldFail = !!failPath;
  const check = (path: string) => { if (shouldFail && path.startsWith(failPath)) { shouldFail = false; throw new Error('OFFLINE_INJECTED_WRITE_FAILURE'); } };
  const apply = (path: string, value: Row, merge: boolean) => rows.set(path, merge ? { ...rows.get(path), ...value } : { ...value });
  const docRef = (path: string): DocRef => ({
    path, id: path.split('/').pop(),
    get: async () => ({ exists: rows.has(path), data: () => ({ ...rows.get(path) }) }),
    set: async (v: Row, o?: SetOptions) => { check(path); apply(path, v, !!o?.merge); },
    update: async (v: Row) => { check(path); apply(path, v, true); },
    delete: async () => { rows.delete(path); },
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
    runTransaction: async <T>(cb: (tx: Tx) => Promise<T>): Promise<T> => {
      const writes: { path: string; value?: Row; merge?: boolean; del?: boolean }[] = [];
      const tx: Tx = {
        get: async (ref) => { expect(writes).toHaveLength(0); return ref.get(); },
        set: (ref, value, o) => writes.push({ path: ref.path, value, merge: !!o?.merge }),
        update: (ref, value) => writes.push({ path: ref.path, value, merge: true }),
        delete: (ref) => writes.push({ path: ref.path, del: true }),
      };
      const result = await cb(tx);
      for (const w of writes) check(w.path);
      for (const w of writes) {
        if (w.del) rows.delete(w.path);
        else apply(w.path, w.value!, !!w.merge);
      }
      return result;
    },
  };
  return { db, rows };
}
const SENTINEL = { __sentinel: 'serverTimestamp', methodName: 'FieldValue.serverTimestamp' };
Object.setPrototypeOf(SENTINEL, { kind: 'FieldValue' });
const base = { orderID: 'OFFLINE-ORDER', flow: 'single' as const, environment: 'live', requestKey: 'OFFLINE-ORDER-cap' };
const intent = { version: 1, body: { product: 'fixture', userEmail: 'f@example.invalid' }, uid: 'uid-1' };

describe('payment-fulfillment-recovery helper (offline)', () => {
  it('omitUndefined drops undefined but preserves Firestore sentinel objects', () => {
    const out = omitUndefined({ a: undefined, nested: { b: undefined, ts: SENTINEL, list: [undefined, 1] }, ts: SENTINEL });
    expect(out).toEqual({ nested: { ts: SENTINEL, list: [null, 1] }, ts: SENTINEL });
    expect(out.ts).toBe(SENTINEL);
  });

  it('validateIntent rejects oversize input before any capture', () => {
    expect(() => validateIntent({ body: { blob: 'x'.repeat(800_000) } })).toThrow(/too large/);
    expect(() => validateIntent({})).toThrow(/invalid/);
  });

  it('capability cookie authorizes only the original browser or the owner uid', () => {
    const cap = newCheckoutCapability();
    const req = { headers: { cookie: checkoutCookie('single', 'O1', cap.secret).split(';')[0] } };
    expect(hasCheckoutCapability(req, 'single', 'O1', cap.digest)).toBe(true);
    expect(hasCheckoutCapability(req, 'cart', 'O1', cap.digest)).toBe(false);
    expect(hasCheckoutCapability({ headers: {} }, 'single', 'O1', cap.digest)).toBe(false);
    const snapshot = { recoveryDigest: cap.digest, ownerUid: 'owner' };
    expect(isSameOrderAuthorized({ req: { headers: {} }, flow: 'single', orderID: 'O1', snapshot, verifiedUid: 'owner' })).toBe(true);
    expect(isSameOrderAuthorized({ req: { headers: {} }, flow: 'single', orderID: 'O1', snapshot, verifiedUid: 'other' })).toBe(false);
    expect(isSameOrderAuthorized({ req: { headers: {} }, flow: 'single', orderID: 'O1', snapshot: {}, verifiedUid: null })).toBe(true);
  });

  it('provider responses: only a narrow 422 decline proves nonpayment; timeout/5xx/bad JSON/401/403/404/409/429/ALREADY_CAPTURED never do', () => {
    expect(classifyCaptureResponse({ status: 500, body: { name: 'INTERNAL' }, parseError: null }, 'O').state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 201, body: null, parseError: 'bad' }, 'O').state).toBe('unknown');
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(classifyCaptureResponse({ status, body: { name: 'X', details: [{ issue: 'INVALID_REQUEST' }] }, parseError: null }, 'O').state, `http ${status}`).toBe('unknown');
    }
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'INVALID_RESOURCE_ID' }] }, parseError: null }, 'O').state).toBe('unknown');
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, parseError: null }, 'O').state).toBe('already_captured');
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] }, parseError: null }, 'O').state).toBe('not_captured');
    expect(classifyCaptureResponse({ status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] }, parseError: null }, 'O').state).toBe('not_captured');
    expect(classifyCaptureResponse({ status: 201, body: { id: 'O', status: 'COMPLETED' }, parseError: null }, 'O').state).toBe('captured');
    expect(classifyOrderLookup({ id: 'O', status: 'APPROVED' }, 'O').state).toBe('approved');
    expect(classifyOrderLookup({ id: 'O', status: 'VOIDED' }, 'O').state).toBe('not_captured');
    expect(classifyOrderLookup({ id: 'X', status: 'COMPLETED' }, 'O').state).toBe('unknown');
  });

  it('attempt record: first claim stores intent; replay keeps saved intent; live claim => in_progress; finalized replays', async () => {
    const { db, rows } = memoryDb();
    const first = await acquirePaymentAttempt({ db, ...base, intent, nowMs: 1000 });
    expect(first.kind).toBe('claimed');
    expect(rows.get('used_paypal_orders/OFFLINE-ORDER')).toMatchObject({ intent, flow: 'single', captureState: 'none' });
    const busy = await acquirePaymentAttempt({ db, ...base, intent: { body: { product: 'CHANGED' } }, nowMs: 2000 });
    expect(busy.kind).toBe('in_progress');
    const later = await acquirePaymentAttempt({ db, ...base, intent: { body: { product: 'CHANGED' } }, nowMs: 1000 + 130_000 });
    expect(later.kind).toBe('claimed');
    expect((later as ClaimedAttempt).attempt.recovering).toBe(true);
    expect((later as ClaimedAttempt).attempt.lock.intent).toEqual(intent);
    expect((await acquirePaymentAttempt({ db, ...base, flow: 'cart', intent, nowMs: 300_000 })).kind).toBe('cross_flow');
    rows.set('used_paypal_orders/OFFLINE-ORDER', { ...rows.get('used_paypal_orders/OFFLINE-ORDER'), finalized: true });
    expect((await acquirePaymentAttempt({ db, ...base, intent, nowMs: 400_000 })).kind).toBe('finalized');
  });

  it('without same-order proof an existing record is neither adopted nor re-claimed; a reconcile never creates a record', async () => {
    const { db, rows } = memoryDb();
    expect((await acquirePaymentAttempt({ db, ...base, intent, nowMs: 1, createIfMissing: false })).kind).toBe('absent');
    expect(rows.has('used_paypal_orders/OFFLINE-ORDER')).toBe(false);
    await acquirePaymentAttempt({ db, ...base, intent, nowMs: 1 });
    const before = JSON.stringify(rows.get('used_paypal_orders/OFFLINE-ORDER'));
    expect((await acquirePaymentAttempt({ db, ...base, intent: { body: { product: 'X' } }, nowMs: 500_000, allowRecovery: false })).kind).toBe('unauthorized');
    expect(JSON.stringify(rows.get('used_paypal_orders/OFFLINE-ORDER'))).toBe(before);
    rows.set('used_paypal_orders/OFFLINE-ORDER', { status: 'pending', createdAtMs: 1 });
    expect((await acquirePaymentAttempt({ db, ...base, intent, nowMs: 500_000, allowRecovery: false })).kind).toBe('unauthorized');
    expect(rows.get('used_paypal_orders/OFFLINE-ORDER')).toEqual({ status: 'pending', createdAtMs: 1 });
  });

  it('legacy locks keep the old duplicate answer; a captured legacy lock is never re-captured', async () => {
    const { db, rows } = memoryDb();
    rows.set('used_paypal_orders/OFFLINE-ORDER', { status: 'captured', createdAtMs: 1 });
    expect((await acquirePaymentAttempt({ db, ...base, intent, nowMs: 100_000 })).kind).toBe('duplicate');
    rows.set('used_paypal_orders/OFFLINE-ORDER', { status: 'pending', createdAtMs: 90_000 });
    expect((await acquirePaymentAttempt({ db, ...base, intent, nowMs: 100_000 })).kind).toBe('duplicate');
  });

  it('reconcile: recovering attempt GETs first and replays a COMPLETED order without a POST; APPROVED posts once', async () => {
    const { db } = memoryDb();
    const acquired = (await acquirePaymentAttempt({ db, ...base, intent, nowMs: 1 })) as ClaimedAttempt;
    const attempt = { ...acquired.attempt, recovering: true };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'OFFLINE-ORDER', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C1', status: 'COMPLETED' }] } }] }) }; }));
    const postCapture = vi.fn();
    const r = await reconcileCapture({ attempt, orderID: 'OFFLINE-ORDER', baseUrl: 'https://offline.invalid', accessToken: 't', postCapture });
    expect(r.state).toBe('captured');
    expect(postCapture).not.toHaveBeenCalled();
    expect(calls[0]).toContain('/v2/checkout/orders/OFFLINE-ORDER');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'OFFLINE-ORDER', status: 'APPROVED' }) })));
    postCapture.mockResolvedValue({ status: 201, body: { id: 'OFFLINE-ORDER', status: 'COMPLETED' }, parseError: null });
    expect((await reconcileCapture({ attempt, orderID: 'OFFLINE-ORDER', baseUrl: 'https://offline.invalid', accessToken: 't', postCapture })).state).toBe('captured');
    expect(postCapture).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('offline'), { name: 'TimeoutError' }); }));
    expect((await reconcileCapture({ attempt, orderID: 'OFFLINE-ORDER', baseUrl: 'https://offline.invalid', accessToken: 't', postCapture })).state).toBe('unknown');
    expect(postCapture).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('persistBookingsAtomically commits nothing when any write fails, then replays without replacing existing docs', async () => {
    const { db, rows } = memoryDb('pending_processor_retries/');
    const acquired = (await acquirePaymentAttempt({ db, ...base, intent, nowMs: 1 })) as ClaimedAttempt;
    const args = { db, attempt: acquired.attempt, timestamp: 'TS', lockPatch: { captureVerified: { captureID: 'C1' } },
      bookings: [{ orderID: 'OFFLINE-ORDER', doc: { status: 'CONFIRMED', createdAt: SENTINEL }, payload: { orderID: 'OFFLINE-ORDER' }, source: 'test' }],
      parents: [{ ref: db.collection('carts').doc('OFFLINE-ORDER'), data: { status: 'CONFIRMED' } }] };
    await expect(persistBookingsAtomically(args)).rejects.toThrow('OFFLINE_INJECTED_WRITE_FAILURE');
    expect(rows.has('bookings/OFFLINE-ORDER')).toBe(false);
    expect(rows.has('carts/OFFLINE-ORDER')).toBe(false);
    expect(rows.get('used_paypal_orders/OFFLINE-ORDER')!.bookingDurable).toBeUndefined();
    rows.set('pending_processor_retries/OFFLINE-ORDER', { status: 'done', attempts: 3 });
    const result = await persistBookingsAtomically(args);
    expect(result.retryStatus['OFFLINE-ORDER']).toBe('done');
    expect(rows.get('bookings/OFFLINE-ORDER')!.createdAt).toBe(SENTINEL);
    expect(rows.get('pending_processor_retries/OFFLINE-ORDER')).toEqual({ status: 'done', attempts: 3 });
    expect(rows.get('used_paypal_orders/OFFLINE-ORDER')).toMatchObject({ bookingDurable: true, status: 'captured', captureVerified: { captureID: 'C1' } });
    await expect(discardAttempt(acquired.attempt)).rejects.toThrow('cannot be discarded');
  });

  it('retry persister and processor result never reset attempts or terminal/manual states', async () => {
    const { db, rows } = memoryDb();
    rows.set('pending_processor_retries/A', { status: 'manual-intervention', attempts: 4, payload: { orderID: 'A', amount: '1.00' }, stepStatus: { email: 'outcome_unknown' } });
    rows.set('pending_processor_retries/B', { status: 'pending', attempts: 2, payload: { orderID: 'B' } });
    rows.set('bookings/A', { processorStatus: 'completed' });
    const persist = makeRetryPersister({ db, timestamp: 'TS' });
    await persist('A', { orderID: 'A', amount: 'NEW' }, 'http-500', { status: 'pending', outcome: 'retryable', retryDocId: 'A' });
    expect(rows.get('pending_processor_retries/A')).toMatchObject({ status: 'manual-intervention', attempts: 4, payload: { amount: '1.00' }, staleResultIgnored: true });
    await persist('B', { orderID: 'B' }, 'timeout', { status: 'pending', outcome: 'retryable', retryDocId: 'B' });
    expect(rows.get('pending_processor_retries/B')).toMatchObject({ status: 'pending', attempts: 2, lastFailureReason: 'timeout' });
    await recordProcessorResult({ db, orderID: 'A', retryDocId: 'A', result: { ok: false, docStatus: 'pending', reason: 'late' }, timestamp: 'TS' });
    expect(rows.get('pending_processor_retries/A')!.status).toBe('manual-intervention');
    expect(rows.get('bookings/A')!.processorStatus).toBe('completed');
    await recordProcessorResult({ db, orderID: 'B', retryDocId: 'B', result: { ok: true, outcome: 'completed' }, timestamp: 'TS' });
    expect(rows.get('pending_processor_retries/B')).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('findUnfinishedCheckout blocks new orders only for this browser capability while the capture is unresolved', async () => {
    const { db, rows } = memoryDb();
    const cap = newCheckoutCapability();
    const req = { headers: { cookie: checkoutCookie('cart', 'K1', cap.secret).split(';')[0] } };
    expect(await findUnfinishedCheckout({ db, req })).toBeNull();
    rows.set('used_paypal_orders/K1', { status: 'pending', intent, captureState: 'unknown' });
    rows.set('cart_orders/K1', { recoveryDigest: cap.digest });
    expect(await findUnfinishedCheckout({ db, req })).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', orderID: 'K1', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', retryable: false });
    rows.set('cart_orders/K1', { recoveryDigest: newCheckoutCapability().digest });
    expect(await findUnfinishedCheckout({ db, req })).toBeNull();
    rows.set('cart_orders/K1', { recoveryDigest: cap.digest });
    rows.set('used_paypal_orders/K1', { status: 'captured', intent, bookingDurable: true });
    expect(await findUnfinishedCheckout({ db, req })).toBeNull();
    await expect(findUnfinishedCheckout({ db: null, req })).rejects.toThrow(/unavailable/);
  });
});
