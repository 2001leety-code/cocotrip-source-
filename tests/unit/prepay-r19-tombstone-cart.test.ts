/**
 * 2026-11-01 B6-1 r19 — 서버 묘비(void tombstone), 장바구니(captureCartOrder). 핸들러 수준, 완전 오프라인.
 *   단건과 같은 계약: 확인(absent) → PayPal GET → 여전히 없을 때만 묘비 → order_voided / capture 먼저면 기존 기록 경로 /
 *   충돌 재시도 / 묘비 뒤 provider·OAuth 0회 / captured·조회 실패 = 묘비 없음 / 묘비 쓰기 실패 = UNKNOWN.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie, CLAIM_LEASE_MS } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  token: vi.fn(async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' })),
  processor: vi.fn(), alert: vi.fn(async () => {}),
}));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: effects.token, resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => true }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: vi.fn(), readSlotFields: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));

import handler from '../../api/captureCartOrder.js';

const ORDER = 'OFFLINE-R19-CART';
const LOCK = `used_paypal_orders/${ORDER}`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('cart', ORDER, cap.secret).split(';')[0];
const snapshot = {
  orderID: ORDER, status: 'created', totalKRW: 135000, usdAmount: '100.00', usdRate: 1350, recoveryDigest: cap.digest, ownerUid: null,
  lines: [{ lineId: 'L0', productType: 'airport_seoul_central', amountKRW: 135000, amountUSD: '100.00', booking: { dateStart: '2026-12-01', passengers: 2 } }],
};
async function call(b: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}
const inFlightLock = (captureState = 'posted') => ({ status: 'pending', flow: 'cart', environment: 'live', requestKey: `${ORDER}-cart-cap`, intent: { version: 1, body: { userEmail: '', lineCount: 1 } }, captureState, claimToken: 'w', claimUntil: Date.now() + CLAIM_LEASE_MS, stages: {} });
const approvedFetch = (onGet?: () => void) => vi.fn(async () => { if (onGet) onGet(); return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'APPROVED' }) }; });

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(); effects.store.db = db.db;
  db.rows.set(`cart_orders/${ORDER}`, { ...snapshot });
  provider = providerFetch([]); vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});

describe('r19 cart — tombstone contract', () => {
  it('check first: GET → tombstone → order_voided; then the capture is refused with zero provider and OAuth calls, no booking', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(409);
    expect(check.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', evidence: 'order_voided', retryable: false, flow: 'cart' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', captureState: 'not_captured', reason: 'no_attempt_record', flow: 'cart' });
    effects.token.mockClear(); provider.calls.length = 0;
    const capture = await call({ orderID: ORDER, userEmail: 'buyer@example.invalid' });
    expect(capture.status).toBe(409);
    expect(capture.body).toMatchObject({ evidence: 'order_voided' });
    expect(provider.calls).toHaveLength(0);
    expect(effects.token).not.toHaveBeenCalled();
    expect(db.rows.has(`carts/${ORDER}`)).toBe(false);
    expect(db.rows.has(`bookings/${ORDER}__L0`)).toBe(false);
  });

  it('capture first (record in flight) → the check answers 202 in progress, no tombstone', async () => {
    db.rows.set(LOCK, inFlightLock());
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(check.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', inProgress: true });
    expect(db.rows.get(LOCK)!.status).toBe('pending');
  });

  it('race during the PayPal read: the capture record appears → 202 UNKNOWN, no tombstone', async () => {
    vi.stubGlobal('fetch', approvedFetch(() => db.rows.set(LOCK, inFlightLock('none'))));
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(db.rows.get(LOCK)!.status).toBe('pending');
  });

  it('transaction conflict retry: aborted first void attempt + concurrent capture commit → retry writes no tombstone', async () => {
    const realTx = db.db.runTransaction.bind(db.db);
    let armed = false; let aborted = false;
    db.db.runTransaction = (async (cb: Parameters<MemoryDb['runTransaction']>[0]) => {
      if (armed && !aborted) {
        aborted = true;
        await realTx(async (tx) => cb({ ...tx, set: () => {}, update: () => {}, delete: () => {} }));
        db.rows.set(LOCK, inFlightLock());
      }
      return realTx(cb);
    }) as MemoryDb['runTransaction'];
    vi.stubGlobal('fetch', approvedFetch(() => { armed = true; }));
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(aborted).toBe(true);
    expect(check.status).toBe(202);
    expect(db.rows.get(LOCK)!.status).toBe('pending');
  });

  it('absent + PayPal COMPLETED → no tombstone, 202 CAPTURED + operator alert; lookup failure → 202 UNKNOWN', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'COMPLETED' } } });
    expect((await call({ orderID: ORDER, reconcile: true })).body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED' });
    expect(effects.alert).toHaveBeenCalledWith(expect.objectContaining({ key: `cart-absent-captured-${ORDER}` }));
    provider.push({ method: 'GET', throwName: 'TimeoutError' });
    expect((await call({ orderID: ORDER, reconcile: true })).body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.has(LOCK)).toBe(false);
  });

  it('decline with the void write failing → 202 UNKNOWN, record kept', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    db.failNextMatching((path, value) => path === LOCK && !!value && value.status === 'void_not_captured');
    const out = await call({ orderID: ORDER });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending' });
  });

  // r20-1: knowing a cart orderID (no cookie / owner) must not void it — the unproven decline only deletes its attempt.
  it('r20: an unproven first capture that is declined deletes its attempt (no tombstone); the owner then pays the approved order', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } } });
    const attacker = await call({ orderID: ORDER }, {});
    expect(attacker.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED' });
    expect(db.rows.has(LOCK)).toBe(false);
    provider.push({ method: 'POST', reply: { status: 201, body: { id: ORDER, status: 'COMPLETED', payer: { email_address: 'payer@example.invalid', name: { given_name: 'P', surname: 'Q' } }, purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } }] } }] } } });
    const owner = await call({ orderID: ORDER, userEmail: 'buyer@example.invalid' });
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({ ok: true, finalized: true });
  });

  // r21-4: the re-read after a captured lookup fails → 202 CAPTURED + conservative alert, never a 500 with Firestore text.
  it('r21: reread-fail on a captured lookup → 202 CAPTURED + alert (reason reread-failed)', async () => {
    let armed = false;
    const realCollection = db.db.collection.bind(db.db);
    db.db.collection = ((name: string) => {
      const col = realCollection(name);
      if (name !== 'used_paypal_orders') return col;
      return { doc: (id: string) => { const d = col.doc(id); return { ...d, get: async () => { if (armed) throw new Error('14 UNAVAILABLE: injected'); return d.get(); } }; } };
    }) as typeof db.db.collection;
    vi.stubGlobal('fetch', vi.fn(async () => { armed = true; return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'COMPLETED' }) }; }));
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED' });
    expect(JSON.stringify(out.body)).not.toMatch(/UNAVAILABLE/);
    expect(effects.alert).toHaveBeenCalledWith(expect.objectContaining({ key: `cart-absent-captured-${ORDER}`, context: expect.objectContaining({ reason: 'reread-failed' }) }));
  });
  // r21-2/3 (cart): OAuth failure = transient. Proven → claim released, the retry (new attempt before any POST) uses ITS input;
  //   unproven → the record is deleted (nothing of a stranger left).
  it('r21: proven OAuth failure keeps a POST-less record; the retry is a new attempt with this request\'s email', async () => {
    effects.token.mockRejectedValueOnce(new Error('oauth down'));
    await call({ orderID: ORDER, userEmail: 'first@example.invalid' });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'none', claimUntil: 0, intent: { body: { userEmail: 'first@example.invalid' } } });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: { id: ORDER, status: 'COMPLETED', payer: { email_address: 'payer@example.invalid', name: { given_name: 'P', surname: 'Q' } }, purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } }] } }] } } });
    const retry = await call({ orderID: ORDER, userEmail: 'second@example.invalid' });
    expect(retry.status).toBe(200);
    expect(db.rows.get(`carts/${ORDER}`)).toMatchObject({ userEmail: 'second@example.invalid' });
  });
  it('r21: unproven OAuth failure deletes the record', async () => {
    effects.token.mockRejectedValueOnce(new Error('oauth down'));
    await call({ orderID: ORDER, userEmail: 'stranger@evil.invalid' }, {});
    expect(db.rows.has(LOCK)).toBe(false);
  });

  // r22 S1/S3 (cart): a same-order check never replays an input written without proof; tombstone failure = 202; fixed outer text.
  it('r22: check on a POST-less unproven cart record → no POST, record deleted, absent path (GET APPROVED → order_voided)', async () => {
    db.rows.set(LOCK, { ...inFlightLock('none'), claimUntil: 0, intentProven: false, intent: { version: 1, body: { userEmail: 'stranger@evil.invalid', lineCount: 1 }, uid: 'stranger' } });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.body).toMatchObject({ evidence: 'order_voided' });
    expect(provider.calls.map((c) => c.method)).toEqual(['GET']);
    expect(db.rows.has(`carts/${ORDER}`)).toBe(false);
    expect(JSON.stringify(db.rows.get(LOCK))).not.toMatch(/stranger/);
  });
  it('r22: the void transaction failing on an absent check → 202 UNKNOWN', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    db.failNextMatching((path, value) => path === LOCK && !!value && value.status === 'void_not_captured');
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ paymentStatus: 'CAPTURE_UNKNOWN' });
  });
  it('r22: an unexpected exception answers a fixed text (the original only in the log)', async () => {
    effects.token.mockRejectedValueOnce(new Error('oauth down: secret-internal'));
    const out = await call({ orderID: ORDER });
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toMatch(/secret-internal/);
  });

  it('a posted attempt with lookup CREATED stays UNKNOWN (no tombstone, no POST)', async () => {
    db.rows.set(LOCK, { ...inFlightLock(), claimUntil: 0 });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'CREATED' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'unknown' });
    expect(provider.calls.map((c) => c.method)).toEqual(['GET']);
  });
});
