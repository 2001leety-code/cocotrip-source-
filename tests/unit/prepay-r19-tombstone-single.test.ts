/**
 * 2026-11-01 B6-1 r19 — 서버 묘비(void tombstone), 단건(capturePaypalOrder). 핸들러 수준, 완전 오프라인(Firestore·PayPal·알림 모의).
 *   - 미결제를 답하는 순간 그 주문의 이후 결제를 영구 차단: 같은 주문 확인(absent) → PayPal 조회(GET) → 트랜잭션에서 여전히 없을 때만 묘비.
 *   - 트랜잭션 승자 양방향(확인 먼저 / capture 먼저) + 충돌 재시도, 묘비 뒤 capture = provider·OAuth 0회.
 *   - absent + PayPal captured = 묘비 없음(결제 접수 안내), 조회 실패 = UNKNOWN, 묘비 쓰기 실패 = UNKNOWN, posted + CREATED = UNKNOWN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie, CLAIM_LEASE_MS } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  token: vi.fn(async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' })),
  processor: vi.fn(), alert: vi.fn(async () => {}), notifyOperator: vi.fn(async () => {}),
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
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: vi.fn(), KNOWN_GLOBAL_PROMO_CODES: [] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: vi.fn() }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: effects.notifyOperator }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => false }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));

import handler from '../../api/capturePaypalOrder.js';

const ORDER = 'OFFLINE-R19-SINGLE';
const LOCK = `used_paypal_orders/${ORDER}`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const body = { orderID: ORDER, product: 'airport_seoul_central', paxCount: 2, userEmail: 'buyer@example.invalid', language: 'en' };

async function call(b: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body: b, headers }, res);
  return res.state;
}
const methods = () => provider.calls.map((c) => c.method);

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
  vi.clearAllMocks();
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

describe('A1/A3 — absent record on a same-order check: PayPal read, then tombstone only if still absent', () => {
  it.each([false, true])('quarantined captured record without intent returns review for capture/reconcile=%s, with no provider call', async reconcile => {
    db.rows.set(LOCK, { status: 'captured', captureState: 'captured', reviewQuarantined: true, flow: 'single', environment: 'live', voidConflict: { captureID: 'CAP-LATE' } });
    const out = await call(reconcile ? { orderID: ORDER, reconcile: true } : body);
    expect(out).toMatchObject({ status: 202, body: { bookingStatus: 'PAYMENT_REVIEW', paymentStatus: 'CAPTURED', paymentCaptured: true, finalized: false, retryable: false, captureID: 'CAP-LATE' } });
    expect(provider.calls).toHaveLength(0);
    expect(effects.token).not.toHaveBeenCalled();
    expect(effects.processor).not.toHaveBeenCalled();
    expect((await call({ orderID: ORDER, reconcile: true }, {})).status).toBe(403);
  });
  it('check first: GET APPROVED → tombstone (no intent, no contact data) → 409 order_voided; a later capture is refused with zero provider and OAuth calls', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(409);
    expect(check.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', paymentStatus: 'NOT_CAPTURED', evidence: 'order_voided', retryable: false, finalized: false, orderID: ORDER });
    expect(String(check.body!.error)).not.toMatch(/no_attempt_record/);
    const tomb = db.rows.get(LOCK)!;
    expect(tomb).toMatchObject({ status: 'void_not_captured', captureState: 'not_captured', reason: 'no_attempt_record', flow: 'single', environment: 'live', claimUntil: 0 });
    expect(typeof tomb.voidedAtMs).toBe('number');
    expect(Object.keys(tomb).sort()).toEqual(['captureState', 'claimUntil', 'environment', 'flow', 'reason', 'status', 'voidedAt', 'voidedAtMs']);
    expect(methods()).toEqual(['GET']);

    effects.token.mockClear(); provider.calls.length = 0;
    const capture = await call(body);
    expect(capture.status).toBe(409);
    expect(capture.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', evidence: 'order_voided', finalized: false });
    expect(capture.body).not.toMatchObject({ ok: true });
    expect(provider.calls).toHaveLength(0);
    expect(effects.token).not.toHaveBeenCalled();
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    // the same answer for another check
    expect((await call({ orderID: ORDER, reconcile: true })).body).toMatchObject({ evidence: 'order_voided' });
    expect(provider.calls).toHaveLength(0);
  });

  it('capture first: the record exists (claimed, in flight) → the check gets the existing-record answer (202 in progress), no tombstone', async () => {
    db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, intent: { version: 1, body: { product: 'airport_seoul_central' } }, captureState: 'posted', claimToken: 'live-worker', claimUntil: Date.now() + CLAIM_LEASE_MS, stages: {} });
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(check.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN', inProgress: true });
    expect(db.rows.get(LOCK)!.status).toBe('pending');
    expect(provider.calls).toHaveLength(0);
  });

  it('race: the capture creates its record while the check reads PayPal → the void transaction sees it → 202 UNKNOWN, no tombstone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', intent: { version: 1, body: {} }, captureState: 'none', claimToken: 'w', claimUntil: Date.now() + CLAIM_LEASE_MS, stages: {} });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'APPROVED' }) };
    }));
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(check.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)!.status).toBe('pending');
  });

  it('transaction conflict retry: the first void attempt is aborted by a concurrent capture commit → the retry re-reads and writes no tombstone', async () => {
    const realTx = db.db.runTransaction.bind(db.db);
    let armed = false; let aborted = false;
    db.db.runTransaction = (async (cb: Parameters<MemoryDb['runTransaction']>[0]) => {
      if (armed && !aborted) {
        aborted = true;
        await realTx(async (tx) => cb({ ...tx, set: () => {}, update: () => {}, delete: () => {} })); // writes discarded = aborted
        db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', intent: { version: 1, body: {} }, captureState: 'posted', claimToken: 'w', claimUntil: Date.now() + CLAIM_LEASE_MS, stages: {} });
      }
      return realTx(cb);
    }) as MemoryDb['runTransaction'];
    vi.stubGlobal('fetch', vi.fn(async () => { armed = true; return { ok: true, status: 200, text: async () => JSON.stringify({ id: ORDER, status: 'APPROVED' }) }; }));
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(aborted).toBe(true);
    expect(check.status).toBe(202);
    expect(db.rows.get(LOCK)!.status).toBe('pending');
  });

  it('absent but PayPal says COMPLETED (lost / legacy record) → no tombstone, "payment received — do not pay again" (202 CAPTURED) + operator alert', async () => {
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'COMPLETED' } } });
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(check.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', retryable: false });
    expect(db.rows.has(LOCK)).toBe(false);
    expect(effects.alert).toHaveBeenCalledWith(expect.objectContaining({ key: `single-absent-captured-${ORDER}` }));
    expect(methods()).toEqual(['GET']);
  });

  it.each([
    ['network failure', { method: 'GET' as const, throwName: 'TypeError' }],
    // r26: r25's "404 RESOURCE_NOT_FOUND = nonpayment" was reverted — every lookup failure, 404 included, is UNKNOWN again.
    ['HTTP 404', { method: 'GET' as const, reply: { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } } }],
    ['unknown status', { method: 'GET' as const, reply: { status: 200, body: { id: ORDER, status: 'SOMETHING_NEW' } } }],
  ])('absent + lookup %s → 202 UNKNOWN, no tombstone, never "pay again"', async (_k, step) => {
    provider.push(step);
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(check.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.has(LOCK)).toBe(false);
  });

  it('OAuth failure during the lookup → UNKNOWN (no tombstone)', async () => {
    effects.token.mockRejectedValueOnce(new Error('oauth down'));
    const check = await call({ orderID: ORDER, reconcile: true });
    expect(check.status).toBe(202);
    expect(db.rows.has(LOCK)).toBe(false);
  });

  it('an unproven caller on a legacy-open snapshot never writes a tombstone (old no_attempt_record answer, no PayPal call)', async () => {
    db.rows.set(`paypal_order_snapshots/${ORDER}`, { productType: 'airport_seoul_central', expectedUSD: '100.00', expectedCurrency: 'USD', passengers: 2 });
    const check = await call({ orderID: ORDER, reconcile: true }, {});
    expect(check.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', evidence: 'no_attempt_record' });
    expect(db.rows.has(LOCK)).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('A4/A5 — discard = tombstone; failures and "may have posted" stay UNKNOWN', () => {
  it('decline (422) → tombstone with the reason; the void write failing → 202 UNKNOWN, record kept (never NOT_CAPTURED)', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    db.failNextMatching((path, value) => path === LOCK && !!value && value.status === 'void_not_captured');
    const out = await call(body);
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'posted' });
  });

  it('a posted attempt whose lookup says CREATED / SAVED / PAYER_ACTION_REQUIRED stays UNKNOWN — no tombstone, no POST', async () => {
    for (const status of ['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED']) {
      db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, intent: { version: 1, body: { product: 'airport_seoul_central' } }, captureState: 'posted', claimToken: 'old', claimUntil: 0, stages: {} });
      provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status } } });
      const out = await call({ orderID: ORDER, reconcile: true });
      expect(out.status).toBe(202);
      expect(db.rows.get(LOCK)).toMatchObject({ status: 'pending', captureState: 'unknown' });
    }
    expect(methods()).toEqual(['GET', 'GET', 'GET']);
  });

  it('a posted attempt whose lookup says VOIDED is final → tombstone, NOT_CAPTURED', async () => {
    db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, intent: { version: 1, body: { product: 'airport_seoul_central' } }, captureState: 'posted', claimToken: 'old', claimUntil: 0, stages: {} });
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'VOIDED' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured', reason: 'order-VOIDED' });
  });

  it('a confirmed (finalized) order is never voided: a check replays the confirmation', async () => {
    db.rows.set(LOCK, { status: 'captured', flow: 'single', environment: 'live', finalized: true, bookingDurable: true, captureVerified: { captureID: 'C1' }, finalResponse: { status: 200, body: { ok: true, finalized: true, data: { orderID: ORDER } } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, finalized: true, replayed: true });
    expect(db.rows.get(LOCK)).toMatchObject({ finalized: true, status: 'captured' });
  });
});
