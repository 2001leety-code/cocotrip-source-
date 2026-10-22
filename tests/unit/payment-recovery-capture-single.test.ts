/**
 * capturePaypalOrder — recovery contract, handler level, fully offline.
 * Every external boundary (Firestore, PayPal, processor, promo ledger, refund, alerts) is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, TS, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  processor: vi.fn(),
  promo: vi.fn(),
  refund: vi.fn(),
  slotConfirm: vi.fn(),
  alert: vi.fn(async () => {}),
  notifyOperator: vi.fn(async () => {}),
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
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: effects.slotConfirm, fetchServerSlotCapacity: vi.fn(async () => ({ ok: true, capacity: 10 })), readSlotFields: () => null }));
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: effects.promo, KNOWN_GLOBAL_PROMO_CODES: ['EARLY50', 'COCO5', 'COCO10'] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: effects.refund }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: effects.notifyOperator }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => false }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));

import handler from '../../api/capturePaypalOrder.js';

const ORDER = 'OFFLINE-SINGLE-1';
const LOCK = `used_paypal_orders/${ORDER}`;
const cap = newCheckoutCapability();
const cookie = checkoutCookie('single', ORDER, cap.secret).split(';')[0];
const baseBody = { orderID: ORDER, product: 'client-lie', paxCount: 9, memo: 'ORIGINAL MEMO', userEmail: 'buyer@example.invalid', language: 'en' };

function seed(db: ReturnType<typeof memoryDb>, extra: Record<string, unknown> = {}) {
  db.rows.set(`paypal_order_snapshots/${ORDER}`, {
    productType: 'airport_seoul_central', expectedUSD: '100.00', expectedKRW: 135000, expectedCurrency: 'USD', usdRate: 1350,
    passengers: 2, dateStart: '2026-12-01', recoveryDigest: cap.digest, ownerUid: 'owner-uid', ...extra,
  });
}
async function call(body: Record<string, unknown>, headers: Record<string, string> = { cookie }) {
  const res = fakeRes();
  await handler({ method: 'POST', body, headers }, res);
  return res.state;
}

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb();
  effects.store.db = db.db;
  seed(db);
  provider = providerFetch([]);
  vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
  effects.promo.mockResolvedValue({ ok: true, usedCount: 1, maxUses: 50 });
  effects.refund.mockResolvedValue({ ok: true, final: true });
});

describe('capturePaypalOrder — capture once, persist atomically, replay from saved input', () => {
  it('capture succeeds, mandatory persistence fails => 202 not finalized, no processor; retry with a changed body replays the ORIGINAL input exactly once', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    db.failNext('bookings/'); db.failNext('bookings/'); db.failNext('bookings/');
    const first = await call(baseBody);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', bookingStatus: 'BOOKING_RECOVERY_PENDING', finalized: false, retryable: false, orderID: ORDER, flow: 'single' });
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.slotConfirm).not.toHaveBeenCalled();
    expect(db.rows.get(LOCK)).toMatchObject({ captureVerified: { captureID: 'CAP-1', amountMinor: 10000, currency: 'USD' }, intent: { body: { memo: 'ORIGINAL MEMO', userEmail: 'buyer@example.invalid' } } });

    const retry = await call({ ...baseBody, memo: 'TAMPERED', userEmail: 'attacker@example.invalid', paxCount: 1 });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, finalized: true, data: { orderID: ORDER, amount: '100.00', currency: 'USD' } });
    expect(provider.calls).toHaveLength(1); // stored verified capture replayed — no second provider call
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ memo: 'ORIGINAL MEMO', userEmail: 'buyer@example.invalid', productType: 'airport_seoul_central', paxCount: 2, amountUSD: '100.00', amountKRW: 135000, createdAt: TS, processorStatus: 'completed' });
    expect(db.rows.get(`pending_processor_retries/${ORDER}`)).toMatchObject({ status: 'done', payload: { memo: 'ORIGINAL MEMO', orderID: ORDER } });
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.processor.mock.calls[0][0].payload).toMatchObject({ memo: 'ORIGINAL MEMO', payerEmail: 'payer@example.invalid' });
    expect(db.rows.get(LOCK)).toMatchObject({ finalized: true, bookingDurable: true });

    const again = await call(baseBody);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, finalized: true, replayed: true, data: { orderID: ORDER } });
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('capture timeout => 202 CAPTURE_UNKNOWN with the record kept; the same order is reconciled by GET first and never re-POSTed once COMPLETED', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    const first = await call(baseBody);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN', bookingStatus: 'BOOKING_STATE_UNKNOWN', finalized: false, retryable: false });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'unknown', requestKey: `${ORDER}-cap` });
    expect(provider.calls[0].headers['PayPal-Request-Id']).toBe(`${ORDER}-cap`);

    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '100.00') } });
    const second = await call({ orderID: ORDER, reconcile: true });
    expect(second.status).toBe(200);
    expect(second.body.finalized).toBe(true);
    expect(provider.calls.map((c) => c.method)).toEqual(['POST', 'GET']);
    expect(provider.calls[1].url).toBe(`https://paypal.invalid/v2/checkout/orders/${ORDER}`);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ memo: 'ORIGINAL MEMO' });
    expect(effects.processor).toHaveBeenCalledTimes(1);
  });

  it('GET APPROVED after an unknown result re-POSTs under the same request key; a 429 / generic 4xx never releases the order', async () => {
    provider.push({ method: 'POST', reply: { status: 429, body: { name: 'RATE_LIMIT_REACHED' } } });
    expect((await call(baseBody)).status).toBe(202);
    expect(db.rows.has(LOCK)).toBe(true);
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    provider.push({ method: 'POST', reply: { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } } });
    expect((await call({ orderID: ORDER, reconcile: true })).status).toBe(202);
    expect(db.rows.has(LOCK)).toBe(true);
    expect(provider.calls.map((c) => `${c.method}:${c.headers['PayPal-Request-Id'] || ''}`)).toEqual([`POST:${ORDER}-cap`, 'GET:', `POST:${ORDER}-cap`]);
    provider.push({ method: 'GET', reply: { status: 200, body: { id: ORDER, status: 'APPROVED' } } });
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    expect((await call({ orderID: ORDER, reconcile: true })).status).toBe(200);
    expect(effects.processor).toHaveBeenCalledTimes(1);
  });

  it('a definitive PayPal decline (422 INSTRUMENT_DECLINED) releases the record and answers PAYMENT_NOT_CAPTURED', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } } });
    const state = await call(baseBody);
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({ ok: false, code: 'PAYMENT_NOT_CAPTURED', paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true, orderID: ORDER });
    expect(db.rows.has(LOCK)).toBe(false);
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
  });

  it('same-order reconcile without any attempt record is durable evidence of no provider call => NOT_CAPTURED, nothing created', async () => {
    const state = await call({ orderID: ORDER, reconcile: true });
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', evidence: 'no_attempt_record', paymentStatus: 'NOT_CAPTURED' });
    expect(provider.calls).toHaveLength(0);
    expect(db.rows.has(LOCK)).toBe(false);
  });

  it('ORDER_ALREADY_CAPTURED is not nonpayment: the order is looked up and the verified capture is used', async () => {
    provider.push({ method: 'POST', reply: { status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } } });
    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '100.00') } });
    expect((await call(baseBody)).status).toBe(200);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ captureID: 'CAP-1' });
  });
});

describe('capturePaypalOrder — same-order authority', () => {
  it('a cookie-less browser may still make the FIRST capture; the record it creates is then closed to callers without proof', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    const first = await call(baseBody, {});
    expect(first.status).toBe(202);
    expect(provider.calls).toHaveLength(1);
    expect(db.rows.has(LOCK)).toBe(true);
    const before = JSON.stringify(db.rows.get(LOCK));
    const again = await call({ ...baseBody, memo: 'STRANGER' }, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_ORDER');
    expect(JSON.stringify(db.rows.get(LOCK))).toBe(before);
    const reconcile = await call({ orderID: ORDER, reconcile: true }, {});
    expect(reconcile.status).toBe(403);
    expect(reconcile.body.code).toBe('RECOVERY_AUTH_REQUIRED');
    expect(provider.calls).toHaveLength(1);
  });

  it('the authenticated owner may capture without the cookie; another user may not', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    expect((await call(baseBody, { authorization: 'Bearer owner-uid' })).status).toBe(200);
    expect(db.rows.get(`bookings/${ORDER}`).uid).toBe('owner-uid');
    const other = await call(baseBody, { authorization: 'Bearer other-uid' });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('DUPLICATE_ORDER');
  });

  it('an unresolved attempt is never adopted, re-claimed or revealed to a caller without proof; a legacy snapshot allows only the first normal capture', async () => {
    provider.push({ method: 'POST', throwName: 'TimeoutError' });
    expect((await call(baseBody)).status).toBe(202);
    const before = JSON.stringify(db.rows.get(LOCK));
    const stranger = await call({ ...baseBody, memo: 'STRANGER' }, { authorization: 'Bearer other-uid' });
    expect(stranger.status).toBe(409);
    expect(stranger.body.code).toBe('DUPLICATE_ORDER');
    expect(JSON.stringify(db.rows.get(LOCK))).toBe(before);
    expect(provider.calls).toHaveLength(1);

    // Legacy snapshot (no digest, no owner): first capture stays open, but recovery by bare orderID is refused.
    db = memoryDb(); effects.store.db = db.db; seed(db, { recoveryDigest: undefined, ownerUid: undefined });
    provider = providerFetch([{ method: 'POST', throwName: 'TimeoutError' }]); vi.stubGlobal('fetch', provider.impl);
    expect((await call(baseBody, {})).status).toBe(202);
    const legacyBefore = JSON.stringify(db.rows.get(LOCK));
    const replay = await call({ orderID: ORDER, reconcile: true }, {});
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ ok: false, error: 'Order already processed', code: 'DUPLICATE_ORDER' });
    expect(JSON.stringify(db.rows.get(LOCK))).toBe(legacyBefore);
    expect(provider.calls).toHaveLength(1);
  });
});

describe('capturePaypalOrder — late / duplicate attempts and terminal records', () => {
  it('a live claim answers 202 in-progress without touching the provider', async () => {
    db.rows.set(LOCK, { status: 'pending', flow: 'single', environment: 'live', intent: { body: baseBody }, claimToken: 'other', claimUntil: Date.now() + 60_000 });
    const state = await call(baseBody);
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', inProgress: true, retryable: false });
    expect(provider.calls).toHaveLength(0);
  });

  it('legacy locks keep the historical duplicate answer (captured => 409, no re-capture)', async () => {
    db.rows.set(LOCK, { status: 'captured', createdAtMs: 1 });
    const state = await call(baseBody);
    expect(state.status).toBe(409);
    expect(state.body.code).toBe('DUPLICATE_ORDER');
    expect(provider.calls).toHaveLength(0);
  });

  it('replay never re-dispatches a manual-intervention intent and never resets its attempts or history', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    db.failNext('bookings/'); db.failNext('bookings/'); db.failNext('bookings/');
    expect((await call(baseBody)).status).toBe(202);
    const terminal = { status: 'manual-intervention', attempts: 4, outcome: 'manual_intervention', payload: { orderID: ORDER, memo: 'HISTORY' }, stepStatus: { email: 'outcome_unknown' } };
    db.rows.set(`pending_processor_retries/${ORDER}`, terminal);
    const retry = await call(baseBody);
    expect(retry.status).toBe(200);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(`pending_processor_retries/${ORDER}`)).toEqual(terminal);
    expect(db.rows.get(`bookings/${ORDER}`).processorStatus).toBe('pending');
  });

  it('a late failed processor result cannot downgrade a done intent; a failed dispatch keeps attempts and never merge:false-overwrites', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    effects.processor.mockImplementation(async ({ persistRetry, payload }: {
      persistRetry: (orderID: string, payload: Record<string, unknown>, reason: string, meta: Record<string, unknown>) => Promise<void>;
      payload: { orderID: string };
    }) => {
      await persistRetry(payload.orderID, { orderID: payload.orderID, memo: 'HELPER-COPY' }, 'http-500', { outcome: 'retryable', status: 'pending', stepStatus: null, source: 'capturePaypalOrder', retryDocId: payload.orderID });
      return { ok: false, reason: 'http-500', outcome: 'retryable', docStatus: 'pending' };
    });
    expect((await call(baseBody)).status).toBe(200);
    expect(db.rows.get(`pending_processor_retries/${ORDER}`)).toMatchObject({ status: 'pending', attempts: 0, payload: { memo: 'ORIGINAL MEMO' }, lastFailureReason: 'http-500' });
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ processorStatus: 'pending', processorLastError: 'http-500' });
  });
});

describe('capturePaypalOrder — verification review and promo stage safety', () => {
  it('amount mismatch quarantines the attempt as PAYMENT_REVIEW: no booking, no processor, replay stays in review', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '90.00') } });
    const state = await call(baseBody);
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ finalized: false, retryable: false, bookingStatus: 'PAYMENT_REVIEW', paymentStatus: 'CAPTURED', orderID: ORDER });
    expect(db.rows.get(`payment_reviews/${ORDER}`)).toMatchObject({ mismatchCode: 'AMOUNT_MISMATCH', resolvedAt: null });
    expect(db.rows.get(LOCK)).toMatchObject({ reviewQuarantined: true, status: 'captured' });
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
    expect(effects.processor).not.toHaveBeenCalled();
    provider.push({ method: 'GET', reply: { status: 200, body: completedOrder(ORDER, '90.00') } });
    expect((await call({ orderID: ORDER, reconcile: true })).body.bookingStatus).toBe('PAYMENT_REVIEW');
    expect(db.rows.has(`bookings/${ORDER}`)).toBe(false);
  });

  it('promo limit exceeded: terminal 409 is recorded BEFORE the refund; replay returns the same 409 with no second increment, refund or processor', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    effects.promo.mockResolvedValue({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: 50, maxUses: 50 });
    effects.refund.mockImplementation(async () => {
      expect(db.rows.get(LOCK)).toMatchObject({ finalized: true, finalOutcome: 'promo_refund_required', finalResponse: { status: 409 } });
      throw new Error('refund transport lost');
    });
    const state = await call({ ...baseBody, promoCode: 'EARLY50' });
    expect(state.status).toBe(409);
    expect(state.body.code).toBe('PROMO_LIMIT_EXCEEDED');
    expect(effects.refund).toHaveBeenCalledTimes(1);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUND_PENDING', refundReason: 'PROMO_LIMIT_EXCEEDED', memo: 'ORIGINAL MEMO' });
    expect(db.rows.get(`pending_processor_retries/${ORDER}`)).toMatchObject({ status: 'permanent-failure', outcome: 'failed_permanent', attempts: 0 });
    expect(effects.processor).not.toHaveBeenCalled();
    const replay = await call({ ...baseBody, promoCode: 'EARLY50' });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: 'PROMO_LIMIT_EXCEEDED', replayed: true });
    expect(effects.promo).toHaveBeenCalledTimes(1);
    expect(effects.refund).toHaveBeenCalledTimes(1);
    expect(effects.processor).not.toHaveBeenCalled();
  });

  it('a promo stage that started but was never recorded (crash) fails closed on replay: no increment, no processor, 202 review', async () => {
    db.rows.set(LOCK, {
      status: 'captured', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, captureState: 'captured', bookingDurable: true,
      intent: { body: { ...baseBody, promoCode: 'EARLY50' }, uid: null, coupon: null, discountV2: false },
      captureVerified: { captureID: 'CAP-1', amountValue: '100.00', amountMinor: 10000, currency: 'USD', pending: false, payerEmail: 'p@example.invalid', payerName: 'P', orderStatus: 'COMPLETED' },
      stages: { promo: { state: 'started', code: 'EARLY50' } }, claimUntil: 0,
    });
    db.rows.set(`bookings/${ORDER}`, { status: 'CONFIRMED', memo: 'ORIGINAL MEMO' });
    db.rows.set(`pending_processor_retries/${ORDER}`, { status: 'pending', attempts: 0, payload: { orderID: ORDER } });
    const state = await call({ orderID: ORDER, reconcile: true });
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', finalized: false, reviewReason: 'promo_stage_unknown' });
    expect(effects.promo).not.toHaveBeenCalled();
    expect(effects.refund).not.toHaveBeenCalled();
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(LOCK).promoStageUnknown).toBe(true);
    expect(db.rows.get(LOCK).finalized).not.toBe(true);
    expect(db.rows.get(`bookings/${ORDER}`).status).toBe('CONFIRMED');
  });

  it('an already REFUNDED booking is never downgraded by the promo path', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } });
    db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', refundReason: 'operator' });
    effects.promo.mockResolvedValue({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: 50, maxUses: 50 });
    effects.refund.mockResolvedValue({ ok: false });
    expect((await call({ ...baseBody, promoCode: 'EARLY50' })).status).toBe(409);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUNDED', refundReason: 'operator' });
  });

  it('pending settlement (capture status PENDING) still books, records paymentPending and finalizes', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00', 'CAP-P', 'PENDING') } });
    const state = await call(baseBody);
    expect(state.status).toBe(200);
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ paymentPending: true, paymentVerified: true });
    expect(db.rows.get(LOCK).captureVerified.pending).toBe(true);
  });
});

describe('capturePaypalOrder — promo refund terminal proof (releases the client pointer)', () => {
  const receipt = (over: Record<string, unknown> = {}, refund: Record<string, unknown> = {}) => ({
    ok: true, final: true, httpStatus: 201, ...over,
    refund: { id: 'REF-1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' }, ...refund },
  });
  async function promoRefund(result: unknown, prep: () => void = () => {}) {
    db = memoryDb(); effects.store.db = db.db; seed(db);
    provider = providerFetch([{ method: 'POST', reply: { status: 201, body: completedOrder(ORDER, '100.00') } }]); vi.stubGlobal('fetch', provider.impl);
    effects.promo.mockClear(); effects.refund.mockClear();
    effects.promo.mockResolvedValue({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: 50, maxUses: 50 });
    effects.refund.mockResolvedValue(result);
    prep();
    return call({ ...baseBody, promoCode: 'EARLY50' });
  }

  it('a proven full COMPLETED refund + confirmed booking transition answers the proof; the same-order replay returns the same proof', async () => {
    const state = await promoRefund(receipt());
    expect(state.status).toBe(409);
    expect(state.body).toEqual({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', error: expect.stringContaining('has been refunded'), orderID: ORDER, finalized: true, paymentStatus: 'REFUNDED', refundID: 'REF-1' });
    expect(effects.refund).toHaveBeenCalledTimes(1);
    expect(effects.refund.mock.calls[0][0]).toMatchObject({ captureID: 'CAP-1', idempotencyKey: `${ORDER}:promo-limit`, refundUSD: '100.00', currency: 'USD', receipt: true });
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUNDED', refundID: 'REF-1', refundReason: 'PROMO_LIMIT_EXCEEDED' });
    // 2026-10-21 (review item C): the transition also stores the strict proof for later replays.
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({
      fullRefundProof: { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['REF-1'], source: 'capture-auto', environment: 'live' },
    });
    expect(db.rows.get(LOCK)).toMatchObject({ finalOutcome: 'promo_refunded', finalResponse: { status: 409, body: { refundID: 'REF-1', finalized: true } } });
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ ...state.body, replayed: true });
    expect(effects.refund).toHaveBeenCalledTimes(1);
    expect(effects.promo).toHaveBeenCalledTimes(1);
    expect(effects.processor).not.toHaveBeenCalled();
  });

  it('pending, failed, missing id, wrong currency, partial, amount-less, HTTP-error or legacy refund results never carry the proof', async () => {
    const cases: [string, unknown][] = [
      ['pending', receipt({ final: false, pending: true }, { status: 'PENDING' })],
      ['failed', { ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'offline', status: 502 }],
      ['missing id', receipt({}, { id: '' })],
      ['wrong currency', receipt({}, { amount: { value: '100.00', currency_code: 'EUR' } })],
      ['partial amount', receipt({}, { amount: { value: '99.99', currency_code: 'USD' } })],
      ['minimal receipt without amount', receipt({}, { amount: undefined })],
      ['HTTP error body claiming COMPLETED', receipt({ httpStatus: 500 })],
      ['legacy helper result', { ok: true, final: true }],
    ];
    for (const [label, result] of cases) {
      const state = await promoRefund(result);
      expect(state.status, label).toBe(409);
      expect(state.body, label).toMatchObject({ ok: false, code: 'PROMO_LIMIT_EXCEEDED' });
      expect(state.body, label).not.toHaveProperty('refundID');
      expect(state.body, label).not.toHaveProperty('finalized');
      expect((db.rows.get(LOCK) as { finalResponse: { body: Record<string, unknown> } }).finalResponse.body, label).not.toHaveProperty('refundID');
      expect(db.rows.get(`bookings/${ORDER}`), label).not.toHaveProperty('refundID');
      expect(db.rows.get(`bookings/${ORDER}`), label).not.toHaveProperty('fullRefundProof');
      expect(effects.refund, label).toHaveBeenCalledTimes(1);
    }
  });

  it('a valid receipt without a booking transition made by THIS call (persist failure, already REFUNDED) is not proof', async () => {
    const failed = await promoRefund(receipt(), () => db.failNextMatching((path, value) => path === `bookings/${ORDER}` && !!value && value.status === 'REFUNDED'));
    expect(failed.status).toBe(409);
    expect(failed.body).not.toHaveProperty('refundID');
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUND_PENDING' });
    const already = await promoRefund(receipt(), () => db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', refundReason: 'operator' }));
    expect(already.status).toBe(409);
    expect(already.body).not.toHaveProperty('refundID');
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUNDED', refundReason: 'operator' });
    expect(db.rows.get(`bookings/${ORDER}`)).not.toHaveProperty('refundID');
    expect(db.rows.get(`bookings/${ORDER}`)).not.toHaveProperty('fullRefundProof');
  });

  it('ordering (review item C round 2): the webhook proved the full refund BEFORE the auto-refund path ran ⇒ the finalized replay answers that proof', async () => {
    const webhookProof = { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['WH-REF-1'], source: 'webhook-authoritative', environment: 'live', provenAtMs: 1 };
    const first = await promoRefund(receipt(), () => db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', refundReason: 'webhook', fullRefundProof: webhookProof }));
    // markRefundCompleted returns false (status is not REFUND_PENDING): THIS call proves nothing itself.
    expect(first.status).toBe(409);
    expect(first.body).not.toHaveProperty('refundID');
    expect(db.rows.get(`bookings/${ORDER}`)).toMatchObject({ status: 'REFUNDED', fullRefundProof: webhookProof });
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: 'PROMO_LIMIT_EXCEEDED', replayed: true, orderID: ORDER, finalized: true, paymentStatus: 'REFUNDED', refundID: 'WH-REF-1' });
    expect(effects.refund).toHaveBeenCalledTimes(1);
  });
});

describe('capturePaypalOrder — finalized replay surfaces a strict full-refund proof (review item C)', () => {
  const PROMO_BODY = { ok: false, code: 'PROMO_LIMIT_EXCEEDED', error: 'Promo code "EARLY50" reached its usage limit. A manual refund will be issued — operator notified.' };
  const proof = (over: Record<string, unknown> = {}) => ({
    captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['WH-REF-1'], source: 'webhook-authoritative', environment: 'live', provenAtMs: 1, ...over,
  });
  function finalizedLock(finalResponse: { status: number; body: Record<string, unknown> }) {
    db.rows.set(LOCK, {
      status: 'captured', flow: 'single', environment: 'live', requestKey: `${ORDER}-cap`, captureState: 'captured', bookingDurable: true,
      intent: { body: { ...baseBody, promoCode: 'EARLY50' }, uid: null, coupon: null, discountV2: false },
      captureVerified: { captureID: 'CAP-1', amountValue: '100.00', amountMinor: 10000, currency: 'USD', pending: false, payerEmail: 'p@example.invalid', payerName: 'P', orderStatus: 'COMPLETED' },
      finalized: true, finalResponse, claimUntil: 0,
    });
  }

  it('(a) promo-limit record without refundID + matching proof on the booking ⇒ replay carries the terminal refund proof', async () => {
    finalizedLock({ status: 409, body: PROMO_BODY });
    db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', fullRefundProof: proof() });
    const before = JSON.stringify(db.rows.get(LOCK));
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ ...PROMO_BODY, replayed: true, orderID: ORDER, finalized: true, paymentStatus: 'REFUNDED', refundID: 'WH-REF-1' });
    expect(JSON.stringify(db.rows.get(LOCK))).toBe(before); // read-only
    expect(effects.refund).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it('(b) a proof that does not describe this capture (amountMinor differs) ⇒ stored body replayed unchanged', async () => {
    finalizedLock({ status: 409, body: PROMO_BODY });
    db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', fullRefundProof: proof({ amountMinor: 9000 }) });
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ ...PROMO_BODY, replayed: true });
  });

  it('(c) a finalized non-promo (200 confirmed) record is never rewritten, even with a proof present', async () => {
    const confirmed = { ok: true, data: { orderID: ORDER, message: 'Booking confirmed.' } };
    finalizedLock({ status: 200, body: confirmed });
    db.rows.set(`bookings/${ORDER}`, { status: 'REFUNDED', fullRefundProof: proof() });
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...confirmed, replayed: true });
  });

  it('(d) no proof (no booking doc) ⇒ stored promo body replayed unchanged', async () => {
    finalizedLock({ status: 409, body: PROMO_BODY });
    const replay = await call({ orderID: ORDER, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ ...PROMO_BODY, replayed: true });
  });
});

describe('capturePaypalOrder — pre-capture refusals never create a record', () => {
  it('cart orders on the single endpoint and missing snapshots are refused before any provider call', async () => {
    db.rows.set(`cart_orders/${ORDER}`, { lines: [] });
    expect((await call(baseBody)).body.code).toBe('CROSS_FLOW_ORDER');
    db.rows.delete(`cart_orders/${ORDER}`); db.rows.delete(`paypal_order_snapshots/${ORDER}`);
    expect((await call(baseBody)).body.code).toBe('NO_ORDER_SNAPSHOT');
    expect(provider.calls).toHaveLength(0);
    expect(db.rows.has(LOCK)).toBe(false);
  });
});
