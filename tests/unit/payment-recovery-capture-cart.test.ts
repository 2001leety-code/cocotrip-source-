/**
 * captureCartOrder — recovery contract, handler level, fully offline (all boundaries mocked).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, TS, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({ store: { db: null as MemoryDb | null }, processor: vi.fn(), slotConfirm: vi.fn(), alert: vi.fn(async () => {}) }));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' }), resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => true }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: effects.slotConfirm, readSlotFields: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));

import handler from '../../api/captureCartOrder.js';

const ORDER = 'OFFLINE-CART-1';
const LOCK = `used_paypal_orders/${ORDER}`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('cart', ORDER, cap.secret).split(';')[0];
const snapshot = {
  orderID: ORDER, status: 'created', totalKRW: 202500, usdAmount: '150.00', usdRate: 1350, recoveryDigest: cap.digest, ownerUid: null,
  lines: [
    { lineId: 'L0', productType: 'airport_seoul_central', amountKRW: 135000, amountUSD: '100.00', booking: { dateStart: '2026-12-01', passengers: 2, memo: 'LINE0' } },
    { lineId: 'L1', productType: 'charter_dmz', amountKRW: 67500, amountUSD: '50.00', booking: { dateStart: '2026-12-02', passengers: 3, memo: 'LINE1' } },
  ],
};
async function call(body: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body, headers }, res);
  return res.state;
}

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(); effects.store.db = db.db;
  db.rows.set(`cart_orders/${ORDER}`, { ...snapshot });
  provider = providerFetch([]); vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});

describe('captureCartOrder — parent + every stable child + each intent commit together', () => {
  it('mandatory batch failure => 202 finalized:false and zero fan-out; replay persists all children atomically and dispatches each line once', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '150.00') } });
    db.failNext('carts/'); db.failNext('carts/'); db.failNext('carts/');
    const first = await call({ orderID: ORDER, userEmail: 'buyer@example.invalid' });
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', bookingStatus: 'BOOKING_RECOVERY_PENDING', finalized: false, flow: 'cart' });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.has(`bookings/${ORDER}__L0`)).toBe(false);
    expect(db.rows.has(`bookings/${ORDER}__L1`)).toBe(false);
    expect(db.rows.get(`cart_orders/${ORDER}`).status).toBe('created');
    expect(db.rows.get(LOCK)).toMatchObject({ captureVerified: { captureID: 'CAP-1', amountMinor: 15000 } });

    const retry = await call({ orderID: ORDER, userEmail: 'someone-else@example.invalid', reconcile: true });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, finalized: true, data: { orderID: ORDER, lineCount: 2, amount: '150.00' } });
    expect(provider.calls).toHaveLength(1);
    expect(db.rows.get(`bookings/${ORDER}__L0`)).toMatchObject({ parentOrderID: ORDER, lineId: 'L0', amountUSD: '100.00', memo: 'LINE0', captureID: 'CAP-1', createdAt: TS });
    expect(db.rows.get(`bookings/${ORDER}__L1`)).toMatchObject({ parentOrderID: ORDER, lineId: 'L1', amountUSD: '50.00', memo: 'LINE1' });
    expect(db.rows.get(`bookings/${ORDER}__L0`).userEmail).toBeUndefined(); // cart-child refund guard preserved
    expect(db.rows.get(`pending_processor_retries/${ORDER}__L0`)).toMatchObject({ status: 'done', retryDocId: `${ORDER}__L0`, payload: { orderID: `${ORDER}__L0`, userEmail: 'buyer@example.invalid' } });
    expect(db.rows.get(`pending_processor_retries/${ORDER}__L1`)).toMatchObject({ status: 'done' });
    expect(db.rows.get(`carts/${ORDER}`)).toMatchObject({ status: 'CONFIRMED', lineCount: 2, userEmail: 'buyer@example.invalid' });
    expect(db.rows.get(`cart_orders/${ORDER}`)).toMatchObject({ status: 'captured', captureID: 'CAP-1' });
    expect(effects.processor).toHaveBeenCalledTimes(2);
    expect(effects.processor.mock.calls.map((c) => (c[0] as { retryDocId: string }).retryDocId).sort()).toEqual([`${ORDER}__L0`, `${ORDER}__L1`]);

    expect((await call({ orderID: ORDER })).body).toMatchObject({ replayed: true, finalized: true });
    expect(effects.processor).toHaveBeenCalledTimes(2);
  });

  it('capture timeout => 202 unknown, lock kept; reconcile GETs first and finalizes without a second POST', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    expect((await call({ orderID: ORDER })).body).toMatchObject({ paymentStatus: 'CAPTURE_UNKNOWN', finalized: false, retryable: false });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'unknown', requestKey: `${ORDER}-cart-cap` });
    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '150.00') } });
    expect((await call({ orderID: ORDER, reconcile: true })).status).toBe(200);
    expect(provider.calls.map((c) => c.method)).toEqual(['POST', 'GET']);
    expect(provider.calls[0].headers['PayPal-Request-Id']).toBe(`${ORDER}-cart-cap`);
  });

  it('replay dispatches only lines whose intent is still open and preserves terminal child records', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '150.00') } });
    db.failNext('carts/'); db.failNext('carts/'); db.failNext('carts/');
    expect((await call({ orderID: ORDER })).status).toBe(202);
    const terminal = { status: 'manual-intervention', attempts: 2, payload: { orderID: `${ORDER}__L0` }, stepStatus: { email: 'outcome_unknown' } };
    db.rows.set(`pending_processor_retries/${ORDER}__L0`, terminal);
    expect((await call({ orderID: ORDER, reconcile: true })).status).toBe(200);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.processor.mock.calls[0][0].retryDocId).toBe(`${ORDER}__L1`);
    expect(db.rows.get(`pending_processor_retries/${ORDER}__L0`)).toEqual(terminal);
  });

  it('allows the first capture without the capability cookie (cookie-blocked browsers can pay), but refuses recovery by bare orderID', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    expect((await call({ orderID: ORDER }, {})).status).toBe(202);
    expect(provider.calls).toHaveLength(1);
    const before = JSON.stringify(db.rows.get(LOCK));
    const again = await call({ orderID: ORDER }, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_ORDER');
    expect((await call({ orderID: ORDER, reconcile: true }, {})).status).toBe(403);
    expect(JSON.stringify(db.rows.get(LOCK))).toBe(before);
    expect(provider.calls).toHaveLength(1);
  });

  it('a definitive decline releases the record; a reconcile with no record is NOT_CAPTURED evidence', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } } });
    expect((await call({ orderID: ORDER })).body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', retryable: true });
    expect(db.rows.has(LOCK)).toBe(false);
    expect((await call({ orderID: ORDER, reconcile: true })).body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', evidence: 'no_attempt_record' });
    expect(provider.calls).toHaveLength(1);
  });
});
