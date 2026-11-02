/**
 * 2026-11-01 B6-1 r20 — 서버(capturePaypalOrder 핸들러 수준, 완전 오프라인).
 *   1) 묘비는 같은 주문 증명(쿠키·소유자)이 있는 요청만 — 증명 없는 첫 capture 의 미결제 = 기록 삭제(피해자 승인 뒤 결제 정상).
 *   2) 일시 오류(플래너 사전 확인 503·쿠폰 트랜잭션 인프라 예외) = 묘비 없음, claim 만 해제(같은 주문 재시도 가능), 원문 비노출.
 *   3) 쿠폰 사업 거절만 최종. 미결제 확정 + 쿠폰 해제 = 한 트랜잭션(실패 = 둘 다 그대로, UNKNOWN) — 묘비 주문에 묶인 쿠폰 0.
 *   6) 확인 GET 이 captured 인데 그 사이 기록이 생겼으면 그 기록 기준 응답·운영자 알림 없음.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie, CLAIM_LEASE_MS } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  processor: vi.fn(), alert: vi.fn(async () => {}), notifyOperator: vi.fn(async () => {}),
  discountV2: false, prepayOn: false, coverage: vi.fn(),
}));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.invalid` }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' }), resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/ai-planner-policy.js', () => ({ checkAiPlannerCouponPolicy: () => ({ ok: true }) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: vi.fn(), fetchServerSlotCapacity: vi.fn(async () => ({ ok: true, capacity: 10 })), readSlotFields: () => null }));
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: vi.fn(async () => ({ ok: true })), KNOWN_GLOBAL_PROMO_CODES: [] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: vi.fn() }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: effects.notifyOperator }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => effects.discountV2 }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));
vi.mock('../../api/_shared/prepay-coverage.js', () => ({
  checkPrepayCoverage: (...a: unknown[]) => effects.coverage(...a), loadPrepayFoodIndex: async () => [],
  isPrepayCheckedProduct: () => effects.prepayOn, startDateTooSoon: () => null, PREPAY_INPUT_VERSION: 1,
}));

import handler from '../../api/capturePaypalOrder.js';

const ORDER = 'OFFLINE-R20-SINGLE';
const LOCK = `used_paypal_orders/${ORDER}`;
const COUPON = 'users/buyer-uid/coupons/C1';
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const body = { orderID: ORDER, product: 'airport_seoul_central', paxCount: 2, userEmail: 'buyer@example.invalid', language: 'en' };
const couponBody = { ...body, couponDocId: 'C1', couponUserId: 'buyer-uid' };
const asBuyer = { cookie, authorization: 'Bearer buyer-uid' };

async function call(b: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  effects.discountV2 = false; effects.prepayOn = false; effects.coverage.mockReturnValue({ ok: true });
  db = memoryDb();
  effects.store.db = db.db;
  db.rows.set(`paypal_order_snapshots/${ORDER}`, {
    productType: 'airport_seoul_central', expectedUSD: '100.00', expectedKRW: 135000, expectedCurrency: 'USD', usdRate: 1350,
    passengers: 2, dateStart: '2026-12-01', recoveryDigest: cap.digest, ownerUid: 'owner-uid',
    prepayInput: { version: 1, startDate: '2099-12-01' }, prepayInputVersion: 1,
  });
  provider = providerFetch([]);
  vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});

describe('r20-1 — only a request with same-order proof can void an order', () => {
  it('no cookie / owner: first capture on a not-yet-approved order → 422 → attempt deleted (no tombstone); the owner pays after approving', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } } });
    const attacker = await call(body, {});
    expect(attacker.status).toBe(409);
    expect(attacker.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED' });
    expect(db.rows.has(LOCK)).toBe(false);
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const owner = await call(body);
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({ ok: true, finalized: true });
  });
  it('with the checkout cookie: the same decline → tombstone (order_voided afterwards)', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } } });
    await call(body);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', reason: 'ORDER_NOT_APPROVED' });
    expect((await call(body)).body).toMatchObject({ evidence: 'order_voided' });
  });
  it('with the authenticated owner (no cookie) → tombstone', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    await call(body, { authorization: 'Bearer owner-uid' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured' });
  });
});

describe('r20-2 — temporary failures never void the order', () => {
  it('planner pre-capture check unavailable → 503, no tombstone, claim released; the same order is retried and paid once the check works', async () => {
    effects.prepayOn = true;
    effects.coverage.mockImplementationOnce(() => { throw new Error('index load timeout'); });
    const first = await call(body);
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({ code: 'ORDER_CHECK_UNAVAILABLE' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'none', claimUntil: 0 });
    expect(provider.calls).toHaveLength(0);
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const retry = await call(body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, finalized: true });
  });
  it('coupon transaction infrastructure error → 503 COUPON_CHECK_UNAVAILABLE (no Firestore text), no tombstone, claim released', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: false });
    db.failNext(COUPON);
    const first = await call(couponBody, asBuyer);
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({ code: 'COUPON_CHECK_UNAVAILABLE' });
    expect(JSON.stringify(first.body)).not.toMatch(/OFFLINE_INJECTED|users\//);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'none', claimUntil: 0 });
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: false });
  });
});

describe('r20-3 — coupons: business rejection is final; release is atomic with the void', () => {
  it('COUPON_ALREADY_USED (another order) → 409, order voided (proof), the other order\'s coupon untouched', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: true, usedOrderID: 'OTHER-ORDER' });
    const out = await call(couponBody, asBuyer);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: 'COUPON_ALREADY_USED' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', reason: 'coupon-COUPON_ALREADY_USED' });
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: true, usedOrderID: 'OTHER-ORDER' });
  });
  it('provider decline after the coupon was reserved → tombstone and coupon release in one transaction (coupon free again)', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: false });
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    const out = await call(couponBody, asBuyer);
    expect(out.status).toBe(409);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured' });
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: false, usedOrderID: null, pendingCapture: false });
  });
  it('the release write failing aborts the whole transaction → 202 UNKNOWN, no tombstone, coupon still reserved for this order (never bound to a voided order)', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: false });
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    db.failNextMatching((path, value) => path === COUPON && !!value && value.isUsed === false);
    const out = await call(couponBody, asBuyer);
    expect(out.status).toBe(202);
    expect(db.rows.get(LOCK)!.status).not.toBe('void_not_captured');
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: true });
  });
});

describe('r20-6 — a captured lookup re-reads the record before alerting', () => {
  it('the record was created and finalized by another tab during the PayPal read → its confirmation is replayed, no "record lost" alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      db.rows.set(LOCK, { status: 'captured', flow: 'single', environment: 'live', finalized: true, bookingDurable: true, captureVerified: { captureID: 'C1' }, finalResponse: { status: 200, body: { ok: true, finalized: true, data: { orderID: ORDER } } } });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'COMPLETED' }) };
    }));
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, finalized: true, replayed: true, data: { orderID: ORDER } });
    expect(effects.alert).not.toHaveBeenCalled();
  });
  it('an in-flight record appears → 202 pending (in progress), no alert; still absent → the critical alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', intent: { body: {} }, captureState: 'posted', claimToken: 'w', claimUntil: Date.now() + CLAIM_LEASE_MS });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'COMPLETED' }) };
    }));
    const inFlight = await call({ orderID: ORDER, reconcile: true });
    expect(inFlight.status).toBe(202);
    expect(inFlight.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', inProgress: true });
    expect(effects.alert).not.toHaveBeenCalled();
    db.rows.delete(LOCK);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'COMPLETED' }) })));
    await call({ orderID: ORDER, reconcile: true });
    expect(effects.alert).toHaveBeenCalledWith(expect.objectContaining({ key: `single-absent-captured-${ORDER}`, severity: 'critical' }));
  });
});

// ── r21 ─────────────────────────────────────────────────────────────────────────────────────────────────
const bookingRow = () => db.rows.get(`bookings/${ORDER}`) as Record<string, unknown> | undefined;
const posts = () => provider.calls.filter((c) => c.method === 'POST').length;

describe('r21-2 — taking over a record that never POSTed (captureState none) is a NEW attempt', () => {
  it('coupon-transient → 503; meanwhile another order takes the coupon → the retry is COUPON_ALREADY_USED (final), no POST, no booking', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: false });
    db.failNext(COUPON);
    expect((await call(couponBody, asBuyer)).status).toBe(503);
    db.rows.set(COUPON, { isUsed: true, usedOrderID: 'ORDER-Y' });
    const retry = await call(couponBody, asBuyer);
    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({ code: 'COUPON_ALREADY_USED' });
    expect(posts()).toBe(0);
    expect(bookingRow()).toBeUndefined();
    expect(db.rows.get(COUPON)).toMatchObject({ usedOrderID: 'ORDER-Y' });
  });
  it('coupon-transient → 503 → the automatic same-order check hits the coupon error again → 503 again (never "continue without coupon"), no POST', async () => {
    effects.discountV2 = true;
    db.rows.set(COUPON, { isUsed: false });
    db.failNext(COUPON);
    expect((await call(couponBody, asBuyer)).status).toBe(503);
    db.failNext(COUPON);
    const check = await call({ orderID: ORDER, reconcile: true }, asBuyer);
    expect(check.status).toBe(503);
    expect(check.body).toMatchObject({ code: 'COUPON_CHECK_UNAVAILABLE' });
    expect(posts()).toBe(0);
    expect(effects.notifyOperator).not.toHaveBeenCalledWith('coupon-race', expect.stringContaining('복구 중'));
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: false });
  });
  it('the retry of a POST-less record uses THIS request\'s intent (memo / email), not the saved one', async () => {
    effects.prepayOn = true;
    effects.coverage.mockImplementationOnce(() => { throw new Error('index down'); });
    expect((await call({ ...body, memo: 'FIRST' })).status).toBe(503);
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'none', intent: { body: { memo: 'FIRST' } } });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const retry = await call({ ...body, memo: 'SECOND', userEmail: 'second@example.invalid' });
    expect(retry.status).toBe(200);
    expect(bookingRow()).toMatchObject({ memo: 'SECOND', userEmail: 'second@example.invalid' });
  });
  it('a record that already POSTed keeps the saved intent (replay contract unchanged)', async () => {
    db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, intent: { version: 1, body: { ...body, memo: 'SAVED', product: 'airport_seoul_central' }, uid: null }, captureState: 'posted', claimToken: 'old', claimUntil: 0, stages: {} });
    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ ...body, memo: 'TAMPERED' });
    expect(out.status).toBe(200);
    expect(bookingRow()).toMatchObject({ memo: 'SAVED' });
  });
});

describe('r21-3 — an unproven request\'s temporary failure deletes its record', () => {
  it('planted-intent: a stranger (no cookie) hits a coupon infrastructure error → 503 and the record is deleted; the owner then pays with HIS data', async () => {
    effects.discountV2 = true;
    db.rows.set('users/attacker/coupons/X', { isUsed: false });
    db.failNext('users/attacker/coupons/X');
    const stranger = await call({ ...body, memo: 'planted', userEmail: 'attacker@evil.invalid', couponDocId: 'X', couponUserId: 'attacker' }, { authorization: 'Bearer attacker' });
    expect(stranger.status).toBe(503);
    expect(db.rows.has(LOCK)).toBe(false);
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const owner = await call({ ...body, memo: 'mine' });
    expect(owner.status).toBe(200);
    expect(bookingRow()).toMatchObject({ memo: 'mine', userEmail: 'buyer@example.invalid' });
    expect(JSON.stringify(bookingRow())).not.toMatch(/attacker|planted/);
  });
  it('unproven-503: a cookie-less guest whose planner check was unavailable can retry the same order (no DUPLICATE_ORDER trap)', async () => {
    effects.prepayOn = true;
    effects.coverage.mockImplementationOnce(() => { throw new Error('index down'); });
    const first = await call(body, {});
    expect(first.status).toBe(503);
    expect(db.rows.has(LOCK)).toBe(false);
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const retry = await call(body, {});
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, finalized: true });
  });
  it('a proven request\'s temporary failure keeps the record (claim released) — unchanged', async () => {
    effects.prepayOn = true;
    effects.coverage.mockImplementationOnce(() => { throw new Error('index down'); });
    await call(body);
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'none', claimUntil: 0 });
  });
});

describe('r21-4 — the re-read after a captured lookup can fail', () => {
  it('reread-fail: 202 CAPTURED ("do not pay again") + a conservative alert, never a 500 with Firestore text', async () => {
    let armed = false;
    const realCollection = db.db.collection.bind(db.db);
    db.db.collection = ((name: string) => {
      const col = realCollection(name);
      if (name !== 'used_paypal_orders') return col;
      return { doc: (id: string) => { const d = col.doc(id); return { ...d, get: async () => { if (armed) throw new Error('14 UNAVAILABLE: injected lock read failure'); return d.get(); } }; } };
    }) as typeof db.db.collection;
    vi.stubGlobal('fetch', vi.fn(async () => { armed = true; return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'COMPLETED' }) }; }));
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED' });
    expect(JSON.stringify(out.body)).not.toMatch(/UNAVAILABLE|injected/);
    expect(effects.alert).toHaveBeenCalledWith(expect.objectContaining({ key: `single-absent-captured-${ORDER}`, context: expect.objectContaining({ reason: 'reread-failed' }) }));
  });
});
