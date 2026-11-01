/**
 * 2026-11-01 B6-1 r25 — capturePaypalOrder: POST 전 기록('none')의 입력을 증명 있는 요청이 교체할 때 옛 입력의 쿠폰 예약 정리.
 *   옛 쿠폰 A 가 이 주문으로 선점돼 있고 새 입력이 A 를 유지하지 않으면, 입력 교체와 같은 트랜잭션에서 A 해제.
 *   같은 쿠폰 유지 = 그대로(재선점 멱등) · 다른 주문이 쥔 쿠폰 = 안 건드림 · 형식이 잘못된 옛 id = 해제 시도 없음 ·
 *   교체 트랜잭션 실패 = 둘 다 원상(UNKNOWN 202).
 *   main 비교: main 은 저장 입력을 그대로 재생해 A 만 다룬다(새 입력 B 로 교체하지 않음) — 교체는 r21·r22 에서 생긴 경로.
 * r25-3: 기록 없음 + PayPal GET 404 RESOURCE_NOT_FOUND = 미결제(묘비 409, main 과 같음). 기록 있는 주문의 404 는 그대로(UNKNOWN).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  processor: vi.fn(), alert: vi.fn(async () => {}), notifyOperator: vi.fn(async () => {}),
  token: vi.fn(async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' })),
}));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.invalid` }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: effects.token, resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/ai-planner-policy.js', () => ({ checkAiPlannerCouponPolicy: () => ({ ok: true }) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: vi.fn(), fetchServerSlotCapacity: vi.fn(async () => ({ ok: true, capacity: 10 })), readSlotFields: () => null }));
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: vi.fn(async () => ({ ok: true })), KNOWN_GLOBAL_PROMO_CODES: [] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: vi.fn() }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: effects.notifyOperator }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true, delivery: 'sent' })) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => true }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));

import handler from '../../api/capturePaypalOrder.js';

const ORDER = 'OFFLINE-R25-SINGLE';
const LOCK = `used_paypal_orders/${ORDER}`;
const UID = 'owner-uid';
const A = `users/${UID}/coupons/CA`;
const B = `users/${UID}/coupons/CB`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const headers = { cookie, authorization: `Bearer ${UID}` };
const body = { orderID: ORDER, product: 'airport_seoul_central', paxCount: 2, userEmail: 'buyer@example.invalid', language: 'en' };
const APPROVED = { method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } };
const CAPTURED = { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } };

async function call(b: Record<string, unknown>) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}
// A POST-less record (captureState 'none', claim expired) whose earlier input reserved coupon A for this order.
const recordWithA = (couponDocId = 'CA') => ({
  status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, userEmail: 'buyer@example.invalid', product: 'airport_seoul_central',
  intent: { version: 1, body: { ...body, memo: 'first try' }, uid: UID, coupon: { couponDocId, couponUserId: UID } },
  intentProven: true, captureState: 'none', claimToken: 'old', claimUntil: 0, stages: {},
});
const posts = () => provider.calls.filter((c) => c.method === 'POST').length;

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb();
  effects.store.db = db.db;
  db.rows.set(`paypal_order_snapshots/${ORDER}`, {
    productType: 'airport_seoul_central', expectedUSD: '100.00', expectedKRW: 135000, expectedCurrency: 'USD', usdRate: 1350,
    passengers: 2, dateStart: '2026-12-01', recoveryDigest: cap.digest, ownerUid: UID,
  });
  db.rows.set(LOCK, recordWithA());
  db.rows.set(A, { isUsed: true, usedOrderID: ORDER, pendingCapture: true });
  db.rows.set(B, { isUsed: false });
  provider = providerFetch([]);
  vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});

describe('r25 — replacing a POST-less input releases the coupon the old input reserved', () => {
  it('A reserved → interrupted → same order retried with B → success: A released, B spent (main never had B: only A)', async () => {
    provider.push(APPROVED, CAPTURED);
    const out = await call({ ...body, couponDocId: 'CB', couponUserId: UID });
    expect(out.status).toBe(200);
    expect(posts()).toBe(1);
    expect(db.rows.get(A)).toMatchObject({ isUsed: false, usedOrderID: null, pendingCapture: false });
    expect(db.rows.get(B)).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: false });
  });
  it('retried with B and B is refused (revoked) → the order ends with A and B both unused', async () => {
    db.rows.set(B, { isUsed: false, isRevoked: true });
    const out = await call({ ...body, couponDocId: 'CB', couponUserId: UID });
    expect(out.status).toBe(409);
    expect(posts()).toBe(0);
    expect(db.rows.get(A)).toMatchObject({ isUsed: false, usedOrderID: null });
    expect(db.rows.get(B)).toMatchObject({ isUsed: false });
  });
  it('retried with the same coupon A → A is kept and spent once by this order (no release in between)', async () => {
    let atReplace: unknown = null;
    const realTx = db.db.runTransaction.bind(db.db);
    db.db.runTransaction = (async (cb: Parameters<typeof realTx>[0]) => {
      const out = await realTx(cb);
      if (atReplace === null && (db.rows.get(LOCK) as Record<string, unknown>).intent && JSON.stringify(db.rows.get(LOCK)).includes('"memo":"retry"')) atReplace = { ...db.rows.get(A) };
      return out;
    }) as typeof db.db.runTransaction;
    provider.push(APPROVED, CAPTURED);
    const out = await call({ ...body, memo: 'retry', couponDocId: 'CA', couponUserId: UID });
    expect(out.status).toBe(200);
    expect(atReplace).toMatchObject({ isUsed: true, usedOrderID: ORDER }); // never released by the replace
    expect(db.rows.get(A)).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: false });
    expect(db.rows.get(B)).toEqual({ isUsed: false });
  });
  it('the old coupon now held by ANOTHER order is never touched', async () => {
    db.rows.set(A, { isUsed: true, usedOrderID: 'OTHER-ORDER', pendingCapture: false });
    provider.push(APPROVED, CAPTURED);
    const out = await call({ ...body, couponDocId: 'CB', couponUserId: UID });
    expect(out.status).toBe(200);
    expect(db.rows.get(A)).toEqual({ isUsed: true, usedOrderID: 'OTHER-ORDER', pendingCapture: false });
  });
  it('a malformed old coupon id → no release attempt; the retry still succeeds', async () => {
    db.rows.set(LOCK, recordWithA('x/y'));
    provider.push(APPROVED, CAPTURED);
    const out = await call({ ...body, couponDocId: 'CB', couponUserId: UID });
    expect(out.status).toBe(200);
    expect(db.rows.get(A)).toMatchObject({ isUsed: true, usedOrderID: ORDER }); // CA was not the saved id — untouched
  });
  it('the replace transaction fails → nothing changes (old input, A reserved, B unused) and the answer is 202 UNKNOWN', async () => {
    db.failNextMatching((path, value) => path === LOCK && !!value && !!value.intent);
    const out = await call({ ...body, couponDocId: 'CB', couponUserId: UID });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(posts()).toBe(0);
    expect(JSON.stringify(db.rows.get(LOCK))).toMatch(/first try/);
    expect(db.rows.get(A)).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: true });
    expect(db.rows.get(B)).toEqual({ isUsed: false });
  });
  it('a retry with no coupon at all also releases A', async () => {
    provider.push(APPROVED, CAPTURED);
    const out = await call(body);
    expect(out.status).toBe(200);
    expect(db.rows.get(A)).toMatchObject({ isUsed: false, usedOrderID: null });
  });
});

// r25-3: no attempt record + PayPal GET 404 RESOURCE_NOT_FOUND = nonpayment (main: 409). Was: 202 "checking" forever (pointer stuck).
describe('r25-3 — absent record and PayPal 404', () => {
  const NOT_FOUND = { method: 'GET', reply: { status: 404, body: { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' } } };
  it('no record + 404 RESOURCE_NOT_FOUND → 409 order_voided and a tombstone (still-absent transaction path)', async () => {
    db.rows.delete(LOCK);
    provider.push(NOT_FOUND);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ evidence: 'order_voided' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', reason: 'no_attempt_record' });
    expect(posts()).toBe(0);
  });
  it('no record + a 404 that is not RESOURCE_NOT_FOUND → 202 UNKNOWN, nothing written (unchanged)', async () => {
    db.rows.delete(LOCK);
    provider.push({ method: 'GET', reply: { status: 404, body: { name: 'SOMETHING_ELSE' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(db.rows.has(LOCK)).toBe(false);
  });
  it('a record that already POSTed + GET 404 → 202 UNKNOWN, record kept (unchanged — as on main)', async () => {
    db.rows.set(LOCK, { ...recordWithA(), captureState: 'posted' });
    provider.push(NOT_FOUND);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'unknown' });
    expect(posts()).toBe(0);
  });
});
