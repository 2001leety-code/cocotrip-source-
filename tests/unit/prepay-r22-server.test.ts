/**
 * 2026-11-01 B6-1 r22 — 서버 단순화(capturePaypalOrder 핸들러 수준 + 공용 함수, 완전 오프라인).
 *   S1) 시도 기록의 입력에 intentProven(그 입력을 쓴 요청의 같은 주문 증명)을 같은 쓰기에서 저장. 같은 주문 확인(입력 없음)은 증명 없이
 *       쓰인 POST 전 입력을 재생하지 않는다 — 기록 삭제 후 absent 경로(PayPal GET → 묘비/결제됨/UNKNOWN), 삭제 실패 = UNKNOWN,
 *       posted 기록은 그대로 복구 경로.
 *   6) 증명 없는 요청의 acquire 뒤·POST 전 예외 = 기록 삭제, couponDocId 형식 검사는 acquire 전.
 *   S2) 입력은 `intent` 필드 통째 교체(이전 입력의 하위 칸이 남지 않음), stages 는 그대로.
 *   S3) 묘비 트랜잭션 실패 = 202 UNKNOWN, 바깥 catch = 고정 문구(원문은 로그만).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb } from './helpers/payment-recovery-fixture';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { newCheckoutCapability, checkoutCookie, replaceAttemptIntent } from '../../api/_shared/payment-fulfillment-recovery.js';

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

const ORDER = 'OFFLINE-R22-SINGLE';
const LOCK = `used_paypal_orders/${ORDER}`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const body = { orderID: ORDER, product: 'airport_seoul_central', paxCount: 2, userEmail: 'buyer@example.invalid', language: 'en' };
const FIXED = 'Payment could not be processed right now — please try again or contact us.';

async function call(b: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}
const noneLock = (extra: Record<string, unknown> = {}) => ({
  status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, userEmail: 'attacker@evil.invalid', product: 'airport_seoul_central',
  intent: { version: 1, body: { ...body, userEmail: 'attacker@evil.invalid', memo: 'planted', customerPhone: '+0000' }, uid: 'attacker' },
  captureState: 'none', claimToken: 'old', claimUntil: 0, stages: {}, ...extra,
});
const posts = () => provider.calls.filter((c) => c.method === 'POST').length;

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

describe('S1 — intentProven is written with the input; a same-order check never replays an unproven input', () => {
  it('the first capture stores intentProven with its input (cookie → true, no proof → false)', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    await call(body);
    expect(db.rows.get(LOCK)).toMatchObject({ intentProven: true, intent: { body: { userEmail: 'buyer@example.invalid' } } });
    db.rows.delete(LOCK);
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    await call(body, {});
    expect(db.rows.get(LOCK)).toMatchObject({ intentProven: false });
  });
  it('owner\'s check on a POST-less unproven record: no POST, no booking — record deleted, then the absent path (GET APPROVED → tombstone → order_voided)', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false }));
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ evidence: 'order_voided' });
    expect(posts()).toBe(0);
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', reason: 'no_attempt_record' });
    expect(JSON.stringify(db.rows.get(LOCK))).not.toMatch(/planted|attacker/);
  });
  // r23 (ROLL): the opposite of r22 — a record written before r22 (no intentProven field, e.g. by main during the rollout) is
  //   replayed exactly like main does (main: GET + POST → 200 booking). Only an explicit false is unproven.
  it('a record written before r22 (no intentProven field) is replayed like main: GET + POST → 200 booking', async () => {
    const legacy = noneLock({ intent: { version: 1, body: { ...body, memo: 'owner-before-rollout' }, uid: null } }); delete (legacy as Record<string, unknown>).intentProven;
    db.rows.set(LOCK, legacy);
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(posts()).toBe(1);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ memo: 'owner-before-rollout' });
  });
  it('the delete failing → 202 UNKNOWN (record kept, no POST)', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false }));
    db.failNextMatching((path, value) => path === LOCK && value === undefined);
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'none' });
    expect(provider.calls).toHaveLength(0);
  });
  it('a POSTED unproven record is never deleted — the normal recovery (GET → recorded payment) runs', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: false, captureState: 'posted' }));
    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(db.rows.get(LOCK)).toMatchObject({ captureVerified: { captureID: 'CAP-1' } });
  });
  it('a proven POST-less record is replayed by the check as before (intentProven:true)', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: true, intent: { version: 1, body: { ...body, memo: 'mine' }, uid: null } }));
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ memo: 'mine' });
  });
});

describe('6 — unproven exceptions before the POST; coupon id format', () => {
  it('couponDocId "x/y" → 400 COUPON_INVALID before any attempt record', async () => {
    effects.discountV2 = true;
    const out = await call({ ...body, couponDocId: 'x/y', couponUserId: 'attacker' }, { authorization: 'Bearer attacker' });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ code: 'COUPON_INVALID' });
    expect(db.rows.has(LOCK)).toBe(false);
  });
  it('an unexpected exception after the claim (unproven) → fixed-text 500 and the record is deleted (no stranger input left)', async () => {
    effects.discountV2 = true;
    const realCollection = db.db.collection.bind(db.db);
    db.db.collection = ((name: string) => { if (name === 'users') throw new Error('Value for argument "documentPath" must point to a document'); return realCollection(name); }) as typeof db.db.collection;
    const out = await call({ ...body, memo: 'planted', couponDocId: 'C1', couponUserId: 'attacker' }, { authorization: 'Bearer attacker' });
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ code: 'INTERNAL_ERROR', error: FIXED });
    expect(JSON.stringify(out.body)).not.toMatch(/documentPath/);
    expect(db.rows.has(LOCK)).toBe(false);
  });
  it('the same exception on a PROVEN request keeps the record (claim) — unchanged', async () => {
    effects.discountV2 = true;
    const realCollection = db.db.collection.bind(db.db);
    db.db.collection = ((name: string) => { if (name === 'users') throw new Error('boom'); return realCollection(name); }) as typeof db.db.collection;
    const out = await call({ ...body, couponDocId: 'C1', couponUserId: 'buyer-uid' }, { cookie, authorization: 'Bearer buyer-uid' });
    expect(out.status).toBe(500);
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'none', intentProven: true });
  });
  it('an OAuth failure message never reaches the customer (fixed text)', async () => {
    effects.token.mockRejectedValueOnce(new Error('oauth down: client secret invalid'));
    const out = await call(body);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ error: FIXED });
  });
});

describe('S2 — the input is replaced WHOLE; stages are kept', () => {
  it('replaceAttemptIntent drops every sub-field of the previous input and keeps stages', async () => {
    const mem = memoryDb();
    const ref = mem.db.collection('used_paypal_orders').doc(ORDER);
    mem.rows.set(LOCK, { captureState: 'none', claimToken: 't', intent: { body: { memo: 'A', customerPhone: 'P1', tourTime: '09:00' } }, intentProven: false, stages: { slot: { state: 'done' } } });
    await replaceAttemptIntent({ db: mem.db, ref, claimToken: 't' } as never, { intent: { body: { memo: 'B' } }, userEmail: 'b@example.invalid', intentProven: true });
    expect(mem.rows.get(LOCK)!.intent).toEqual({ body: { memo: 'B' } });
    expect(mem.rows.get(LOCK)).toMatchObject({ intentProven: true, userEmail: 'b@example.invalid', stages: { slot: { state: 'done' } } });
  });
  it('replaceAttemptIntent refuses a record that already POSTed or whose claim changed', async () => {
    const mem = memoryDb();
    const ref = mem.db.collection('used_paypal_orders').doc(ORDER);
    mem.rows.set(LOCK, { captureState: 'posted', claimToken: 't', intent: { body: { memo: 'A' } } });
    await expect(replaceAttemptIntent({ db: mem.db, ref, claimToken: 't' } as never, { intent: { body: {} } })).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    mem.rows.set(LOCK, { captureState: 'none', claimToken: 'other', intent: { body: { memo: 'A' } } });
    await expect(replaceAttemptIntent({ db: mem.db, ref, claimToken: 't' } as never, { intent: { body: {} } })).rejects.toMatchObject({ code: 'CLAIM_LOST' });
  });
  it('handler: a proven retry of a POST-less record leaves none of the earlier phone / time in the booking', async () => {
    db.rows.set(LOCK, noneLock({ intentProven: true, intent: { version: 1, body: { ...body, memo: 'A', customerPhone: 'P1', tourTime: '07:00' }, uid: null } }));
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } }, { method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    const out = await call({ ...body, memo: 'B' });
    expect(out.status).toBe(200);
    const booking = db.rows.get(`bookings/${ORDER}`) as Record<string, unknown>;
    expect(booking.memo).toBe('B');
    expect(booking.customerPhone).not.toBe('P1');
    expect(booking.tourTime).not.toBe('07:00');
  });
  it('fake Firestore update() replaces a map field wholesale (like real Firestore), set(merge) still merges', async () => {
    const fake = createFakeFirestore({ 'x/1': { intent: { a: 1, b: 2 }, keep: true } });
    await fake.collection('x').doc('1').update({ intent: { a: 9 } });
    expect(fake.__get('x/1')).toEqual({ intent: { a: 9 }, keep: true });
    await fake.collection('x').doc('1').set({ intent: { c: 3 } }, { merge: true });
    expect(fake.__get('x/1')).toEqual({ intent: { a: 9, c: 3 }, keep: true });
  });
});

describe('S3 — tombstone transaction failure and fixed outer text', () => {
  it('the void transaction of an absent check fails → 202 UNKNOWN (nothing written), never a 500 with Firestore text', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    db.failNextMatching((path, value) => path === LOCK && !!value && value.status === 'void_not_captured');
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.has(LOCK)).toBe(false);
  });
});
