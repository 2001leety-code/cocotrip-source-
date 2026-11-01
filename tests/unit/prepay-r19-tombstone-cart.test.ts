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

  it('a posted attempt with lookup CREATED stays UNKNOWN (no tombstone, no POST)', async () => {
    db.rows.set(LOCK, { ...inFlightLock(), claimUntil: 0 });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'CREATED' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'unknown' });
    expect(provider.calls.map((c) => c.method)).toEqual(['GET']);
  });
});
