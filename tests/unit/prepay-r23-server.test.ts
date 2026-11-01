/**
 * 2026-11-01 B6-1 r23 — capturePaypalOrder 핸들러 수준(완전 오프라인).
 *   1) ROLL: r22 이전 기록(intentProven 칸 없음)은 main 처럼 재생 — 쿠폰 포함(쿠폰은 정상 사용 처리).
 *   2) S1(명시적 intentProven:false) 삭제 때 그 기록 입력이 선점한 쿠폰도 같은 트랜잭션에서 해제 — 다른 주문이 쥔 쿠폰은 안 풂.
 *   3) noPost('posted' 저장 실패 = PayPal 에 POST 0회) + 무증명 = 기록 삭제(+쿠폰 해제) 503 · 증명 있으면 기존 202 UNKNOWN ·
 *      이미 posted 였던 기록은 삭제하지 않음(앞선 POST 가 날아갔을 수 있다).
 *   main 비교: main 은 1) 과 같이 재생, 2) 는 S1 이 없어 외부인 입력으로 재생(쿠폰은 사용 처리), 3) 은 'unknown' 으로 남아 소유자
 *   확인 때 외부인 입력이 재생된다(r22 가 약속한 정리 범위).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  processor: vi.fn(), alert: vi.fn(async () => {}), notifyOperator: vi.fn(async () => {}),
  discountV2: false,
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
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => effects.discountV2 }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));

import handler from '../../api/capturePaypalOrder.js';

const ORDER = 'OFFLINE-R23-SINGLE';
const LOCK = `used_paypal_orders/${ORDER}`;
const COUPON = 'users/victim/coupons/C1';
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const body = { orderID: ORDER, product: 'airport_seoul_central', paxCount: 2, userEmail: 'buyer@example.invalid', language: 'en' };
const APPROVED = { method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } };

async function call(b: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}
const noneLock = (extra: Record<string, unknown> = {}) => ({
  status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, userEmail: 'attacker@evil.invalid', product: 'airport_seoul_central',
  intent: { version: 1, body: { ...body, userEmail: 'attacker@evil.invalid', memo: 'planted' }, uid: 'attacker', coupon: { couponDocId: 'C1', couponUserId: 'victim' } },
  captureState: 'none', claimToken: 'old', claimUntil: 0, stages: {}, ...extra,
});
const posts = () => provider.calls.filter((c) => c.method === 'POST').length;
const failPostedWrite = () => db.failNextMatching((path, value) => path === LOCK && !!value && value.captureState === 'posted');

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  effects.discountV2 = false;
  db = memoryDb();
  effects.store.db = db.db;
  db.rows.set(`paypal_order_snapshots/${ORDER}`, {
    productType: 'airport_seoul_central', expectedUSD: '100.00', expectedKRW: 135000, expectedCurrency: 'USD', usdRate: 1350,
    passengers: 2, dateStart: '2026-12-01', recoveryDigest: cap.digest, ownerUid: 'owner-uid',
  });
  provider = providerFetch([]);
  vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});

describe('r23-1/2 — S1 and the coupon its input reserved', () => {
  it('ROLL + coupon: a record written before r22 (no intentProven) is replayed like main — booked, the coupon ends spent', async () => {
    effects.discountV2 = true;
    const legacy = noneLock({ intent: { version: 1, body: { ...body, memo: 'owner-before-rollout' }, uid: null, coupon: { couponDocId: 'C1', couponUserId: 'victim' } } });
    delete (legacy as Record<string, unknown>).intentProven;
    db.rows.set(LOCK, legacy);
    db.rows.set(COUPON, { isUsed: true, usedOrderID: ORDER, pendingCapture: true });
    provider.push(APPROVED, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(posts()).toBe(1);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ memo: 'owner-before-rollout' });
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: false });
  });
  it('an r22 record (intentProven:false) is still blocked, and its reserved coupon is released in the same delete (main: replayed, coupon spent)', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false }));
    db.rows.set(COUPON, { isUsed: true, usedOrderID: ORDER, pendingCapture: true });
    provider.push(APPROVED);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ evidence: 'order_voided' });
    expect(posts()).toBe(0);
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: false, usedOrderID: null, pendingCapture: false });
  });
  it('a coupon held by ANOTHER order is never released by that delete', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false }));
    db.rows.set(COUPON, { isUsed: true, usedOrderID: 'OTHER-ORDER', pendingCapture: false });
    provider.push(APPROVED);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(db.rows.get(COUPON)).toEqual({ isUsed: true, usedOrderID: 'OTHER-ORDER', pendingCapture: false });
  });
  it('a malformed saved coupon id releases nothing (no coupon path built) — the record is still deleted', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false, intent: { version: 1, body, uid: null, coupon: { couponDocId: 'x/y', couponUserId: 'victim' } } }));
    db.rows.set(COUPON, { isUsed: true, usedOrderID: ORDER, pendingCapture: true });
    provider.push(APPROVED);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(db.rows.get(COUPON)).toMatchObject({ isUsed: true, usedOrderID: ORDER });
  });
});

describe('r23-3 — the "posted" write before the POST fails (noPost)', () => {
  it('unproven: zero PayPal calls, 503, record deleted → the owner\'s later check replays none of the stranger\'s input', async () => {
    failPostedWrite();
    const out = await call({ ...body, userEmail: 'attacker@evil.invalid', memo: 'planted' }, {});
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    expect(provider.calls).toHaveLength(0);
    expect(db.rows.has(LOCK)).toBe(false);
    // main: the record stays 'unknown' and this check replays the planted input (GET APPROVED → POST → booking 'planted').
    provider.push(APPROVED);
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(409);
    expect(check.body).toMatchObject({ evidence: 'order_voided' });
    expect(posts()).toBe(0);
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    expect(JSON.stringify(db.rows.get(LOCK))).not.toMatch(/planted|attacker/);
  });
  it('unproven with a coupon: the coupon it pre-locked is released in the same delete', async () => {
    effects.discountV2 = true;
    db.rows.set('users/attacker/coupons/C9', { isUsed: false });
    let atFailure: unknown = null;
    db.failNextMatching((path, value) => {
      const hit = path === LOCK && !!value && value.captureState === 'posted';
      if (hit) atFailure = { ...db.rows.get('users/attacker/coupons/C9') };
      return hit;
    });
    const out = await call({ ...body, couponDocId: 'C9', couponUserId: 'attacker' }, { authorization: 'Bearer attacker' });
    expect(atFailure).toMatchObject({ isUsed: true, usedOrderID: ORDER, pendingCapture: true }); // really pre-locked first
    expect(out.status).toBe(503);
    expect(db.rows.has(LOCK)).toBe(false);
    expect(db.rows.get('users/attacker/coupons/C9')).toMatchObject({ isUsed: false });
    expect(posts()).toBe(0);
  });
  it('proven (cookie): unchanged — 202 UNKNOWN, record kept as unknown, no POST', async () => {
    failPostedWrite();
    const out = await call(body);
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'unknown', intentProven: true });
    expect(posts()).toBe(0);
  });
  it('the delete itself fails → the existing UNKNOWN path (202, record kept)', async () => {
    failPostedWrite();
    db.failNextMatching((path, value) => path === LOCK && value === undefined);
    const out = await call(body, {});
    expect(out.status).toBe(202);
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'unknown' });
  });
  // The delete branch also requires captureState 'none' at claim (an older 'posted' record may have a POST in flight); an
  //   unproven request never takes over an existing record in the first place — both entry points leave it untouched.
  it.each([
    ['check', { orderID: ORDER, reconcile: true }],
    ['capture', { ...body, memo: 'planted' }],
  ])('an unproven %s never touches an existing "posted" record (no POST, record kept)', async (_kind, b) => {
    db.rows.set(LOCK, noneLock({ intentProven: false, captureState: 'posted', claimUntil: Date.now() + 60_000 }));
    provider.push(APPROVED);
    failPostedWrite();
    await call(b, {});
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'posted', status: 'pending' });
    expect(posts()).toBe(0);
  });
});
