/**
 * Held retry intents (finding 10): a new pending_processor_retries record is durable but NOT runnable by the
 * processor-retry-sweep cron (status === 'pending' filter) until the capture handler has settled the mandatory
 * slot/promo checks. Terminal refund outcomes close it before any external refund. Fully offline.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb, type Row } from './helpers/payment-recovery-fixture';
import {
  newCheckoutCapability, checkoutCookie, acquirePaymentAttempt, persistBookingsAtomically, releaseHeldIntents,
  recordTerminalBeforeRefund, markRefundCompleted, shouldDispatchRetry, HELD_RETRY_STATUS,
} from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({ store: { db: null as MemoryDb | null }, processor: vi.fn(), promo: vi.fn(), refund: vi.fn(), slotConfirm: vi.fn() }));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' }), resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/ai-planner-policy.js', () => ({ checkAiPlannerCouponPolicy: () => ({ ok: true }) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: effects.slotConfirm, fetchServerSlotCapacity: vi.fn(async () => ({ ok: true, capacity: 10 })), readSlotFields: () => null }));
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: effects.promo, KNOWN_GLOBAL_PROMO_CODES: ['EARLY50', 'COCO5', 'COCO10'] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: effects.refund }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => true }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }) }));

import captureSingle from '../../api/capturePaypalOrder.js';
import captureCart from '../../api/captureCartOrder.js';

const RETRIES = 'pending_processor_retries';
/** Exactly what api/_crons/processor-retry-sweep.js selects: `.where('status', '==', 'pending')`. */
const cronRunnable = (rows: Map<string, Row>) =>
  [...rows.entries()].filter(([path, row]) => path.startsWith(`${RETRIES}/`) && row.status === 'pending').map(([path]) => path);

const SINGLE = 'OFFLINE-HELD-SINGLE';
const CART = 'OFFLINE-HELD-CART';
const cap = newCheckoutCapability();
const singleCookie = checkoutCookie('single', SINGLE, cap.secret).split(';')[0];
const cartCookie = checkoutCookie('cart', CART, cap.secret).split(';')[0];
const singleBody = { orderID: SINGLE, memo: 'ORIGINAL', userEmail: 'buyer@example.invalid', promoCode: 'EARLY50' };

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
function seed() {
  db = memoryDb(); effects.store.db = db.db;
  db.rows.set(`paypal_order_snapshots/${SINGLE}`, { productType: 'airport_seoul_central', expectedUSD: '100.00', expectedKRW: 135000, expectedCurrency: 'USD', usdRate: 1350, passengers: 2, dateStart: '2026-12-01', recoveryDigest: cap.digest, ownerUid: null });
  db.rows.set(`cart_orders/${CART}`, {
    orderID: CART, status: 'created', totalKRW: 202500, usdAmount: '150.00', usdRate: 1350, recoveryDigest: cap.digest, ownerUid: null,
    lines: [
      { lineId: 'L0', productType: 'airport_seoul_central', amountKRW: 135000, amountUSD: '100.00', booking: { dateStart: '2026-12-01', passengers: 2 } },
      { lineId: 'L1', productType: 'charter_dmz', amountKRW: 67500, amountUSD: '50.00', booking: { dateStart: '2026-12-02', passengers: 3 } },
    ],
  });
}
async function single(body: Record<string, unknown> = singleBody) {
  const res = fakeRes();
  await captureSingle({ method: 'POST', body, headers: { cookie: singleCookie } }, res);
  return res.state;
}
async function cart(body: Record<string, unknown> = { orderID: CART }) {
  const res = fakeRes();
  await captureCart({ method: 'POST', body, headers: { cookie: cartCookie } }, res);
  return res.state;
}
beforeEach(() => {
  vi.clearAllMocks();
  seed();
  provider = providerFetch([]); vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
  effects.promo.mockResolvedValue({ ok: true, usedCount: 1, maxUses: 50 });
  effects.refund.mockResolvedValue({ ok: true, final: true });
});

describe('held retry intent — single capture', () => {
  it('at the pause before the promo result the intent exists durably but the cron filter cannot select it; normal checks then release it and dispatch once', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    let seenAtPause: Row | undefined;
    let cronSawAtPause: string[] = ['not-observed'];
    effects.promo.mockImplementation(async () => {
      seenAtPause = db.rows.get(`${RETRIES}/${SINGLE}`);
      cronSawAtPause = cronRunnable(db.rows);
      expect(db.rows.get(`bookings/${SINGLE}`)).toMatchObject({ status: 'CONFIRMED' });
      expect(effects.processor).not.toHaveBeenCalled();
      return { ok: true, usedCount: 1, maxUses: 50 };
    });
    const state = await single();
    expect(state.status).toBe(200);
    expect(seenAtPause).toMatchObject({ status: HELD_RETRY_STATUS, heldReason: 'awaiting_mandatory_checks', attempts: 0, payload: { orderID: SINGLE, memo: 'ORIGINAL' } });
    expect(cronSawAtPause).toEqual([]);
    expect(shouldDispatchRetry(HELD_RETRY_STATUS)).toBe(false);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(db.rows.get(`${RETRIES}/${SINGLE}`)).toMatchObject({ status: 'done', releasedAt: expect.anything(), heldReason: null });
  });

  it('at the pause before the refund the terminal state is already durable: lock finalized, booking REFUND_PENDING, intent closed, cron sees nothing; the refund crash leaves it that way and replay never dispatches', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockResolvedValue({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: 50, maxUses: 50 });
    let cronSawBeforeRefund: string[] = ['not-observed'];
    effects.refund.mockImplementation(async () => {
      cronSawBeforeRefund = cronRunnable(db.rows);
      expect(db.rows.get(`used_paypal_orders/${SINGLE}`)).toMatchObject({ finalized: true, finalOutcome: 'promo_refund_required' });
      expect(db.rows.get(`bookings/${SINGLE}`)).toMatchObject({ status: 'REFUND_PENDING', refundReason: 'PROMO_LIMIT_EXCEEDED', memo: 'ORIGINAL', processorStatus: 'stopped' });
      expect(db.rows.get(`${RETRIES}/${SINGLE}`)).toMatchObject({ status: 'permanent-failure', outcome: 'failed_permanent', lastFailureReason: 'PROMO_LIMIT_EXCEEDED' });
      throw new Error('process crashed before refund result');
    });
    expect((await single()).status).toBe(409);
    expect(cronSawBeforeRefund).toEqual([]);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(`bookings/${SINGLE}`).status).toBe('REFUND_PENDING');
    expect(cronRunnable(db.rows)).toEqual([]);
    const replay = await single({ orderID: SINGLE, reconcile: true });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: 'PROMO_LIMIT_EXCEEDED', replayed: true });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.promo).toHaveBeenCalledTimes(1);
    expect(effects.refund).toHaveBeenCalledTimes(1);
    expect(effects.slotConfirm).not.toHaveBeenCalled();
    expect(db.rows.get(`${RETRIES}/${SINGLE}`).status).toBe('permanent-failure');
  });

  it('a successful refund upgrades REFUND_PENDING to REFUNDED only; an operator REFUNDED booking is never touched', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockResolvedValue({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', usedCount: 50, maxUses: 50 });
    expect((await single()).status).toBe(409);
    expect(db.rows.get(`bookings/${SINGLE}`)).toMatchObject({ status: 'REFUNDED', refundReason: 'PROMO_LIMIT_EXCEEDED', memo: 'ORIGINAL' });
    expect(cronRunnable(db.rows)).toEqual([]);
    expect(await markRefundCompleted({ db: db.db, orderID: 'OTHER', timestamp: 'TS' })).toBe(false);
    expect(db.rows.has('bookings/OTHER')).toBe(false);
    // true only for THIS call's REFUND_PENDING -> REFUNDED transition; refundID is stored only with it.
    db.rows.set('bookings/RP', { status: 'REFUND_PENDING', memo: 'KEEP' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'RP', timestamp: 'TS', refundID: 'REF-1' })).toBe(true);
    expect(db.rows.get('bookings/RP')).toMatchObject({ status: 'REFUNDED', refundID: 'REF-1', memo: 'KEEP' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'RP', timestamp: 'TS', refundID: 'REF-2' })).toBe(false);
    expect(db.rows.get('bookings/RP')).toMatchObject({ refundID: 'REF-1' });
    db.rows.set('bookings/CF', { status: 'CONFIRMED' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'CF', timestamp: 'TS', refundID: 'REF-3' })).toBe(false);
    expect(db.rows.get('bookings/CF')).toEqual({ status: 'CONFIRMED' });
  });

  it('if the release itself cannot be recorded the intent stays held (202, no processor); the same-order replay releases and dispatches once', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockImplementation(async () => {
      db.failNextMatching((path, value) => path.startsWith(`${RETRIES}/`) && !!value && 'releasedAt' in value);
      return { ok: true, usedCount: 1, maxUses: 50 };
    });
    const first = await single();
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', finalized: false, reviewReason: 'intent_release_failed' });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(`${RETRIES}/${SINGLE}`).status).toBe(HELD_RETRY_STATUS);
    expect(cronRunnable(db.rows)).toEqual([]);
    effects.promo.mockResolvedValue({ ok: true, usedCount: 1, maxUses: 50 });
    const replay = await single({ orderID: SINGLE, reconcile: true });
    expect(replay.status).toBe(200);
    expect(effects.promo).toHaveBeenCalledTimes(1); // completed stage is never re-run
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(db.rows.get(`${RETRIES}/${SINGLE}`).status).toBe('done');
  });

  it('a worker that lost the attempt claim before release opens nothing and answers 202 (no processor)', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockImplementation(async () => {
      // Another worker took over the attempt while the promo check was in flight.
      db.rows.set(`used_paypal_orders/${SINGLE}`, { ...db.rows.get(`used_paypal_orders/${SINGLE}`), claimToken: 'other-worker', claimUntil: Date.now() + 60_000 });
      return { ok: true, usedCount: 1, maxUses: 50 };
    });
    const state = await single();
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', finalized: false, reviewReason: 'claim_lost' });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(`${RETRIES}/${SINGLE}`).status).toBe(HELD_RETRY_STATUS);
    expect(db.rows.get(`used_paypal_orders/${SINGLE}`)).toMatchObject({ claimToken: 'other-worker' }); // the other worker's claim is untouched
    expect(cronRunnable(db.rows)).toEqual([]);
  });

  it('a booking externally marked REFUND_PENDING during the mandatory checks blocks release: intent closed, no processor, non-active 202 answer, replay effect-free', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockImplementation(async () => {
      db.rows.set(`bookings/${SINGLE}`, { ...db.rows.get(`bookings/${SINGLE}`), status: 'REFUND_PENDING', refundReason: 'operator' });
      return { ok: true, usedCount: 1, maxUses: 50 };
    });
    const state = await single();
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURED', bookingStatus: 'BOOKING_STOPPED', finalized: false, retryable: false, reviewReason: 'booking_stopped' });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.refund).not.toHaveBeenCalled();
    expect(db.rows.get(`${RETRIES}/${SINGLE}`)).toMatchObject({ status: 'permanent-failure', attempts: 0, lastFailureReason: 'booking_stopped:REFUND_PENDING', payload: { orderID: SINGLE, memo: 'ORIGINAL' } });
    expect(db.rows.get(`bookings/${SINGLE}`)).toMatchObject({ status: 'REFUND_PENDING', refundReason: 'operator', memo: 'ORIGINAL' });
    expect(cronRunnable(db.rows)).toEqual([]);
    const replay = await single({ orderID: SINGLE, reconcile: true });
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ bookingStatus: 'BOOKING_STOPPED', replayed: true });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.promo).toHaveBeenCalledTimes(1);
    expect(effects.slotConfirm).not.toHaveBeenCalled();
  });

  it('a promo stage left started (crash) keeps the intent held and never dispatches', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } });
    effects.promo.mockImplementation(async () => { throw Object.assign(new Error('offline infra'), { offline: true }); });
    // Infra error = existing policy (skip cap enforcement) -> stage completed -> release.
    expect((await single()).status).toBe(200);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    seed(); provider = providerFetch([{ method: 'POST', reply: { status: 201, body: completedOrder(SINGLE, '100.00') } }]); vi.stubGlobal('fetch', provider.impl);
    effects.processor.mockClear();
    db.rows.set(`used_paypal_orders/${SINGLE}`, {
      status: 'captured', flow: 'single', environment: 'live', requestKey: `${SINGLE}-cap`, captureState: 'captured', bookingDurable: true,
      intent: { body: { ...singleBody, product: 'airport_seoul_central' }, uid: null, coupon: null, discountV2: false },
      captureVerified: { captureID: 'CAP-1', amountValue: '100.00', amountMinor: 10000, currency: 'USD', pending: false, payerEmail: 'p@example.invalid', payerName: 'P', orderStatus: 'COMPLETED' },
      stages: { promo: { state: 'started', code: 'EARLY50' } }, claimUntil: 0,
    });
    db.rows.set(`bookings/${SINGLE}`, { status: 'CONFIRMED', memo: 'ORIGINAL' });
    db.rows.set(`${RETRIES}/${SINGLE}`, { status: HELD_RETRY_STATUS, attempts: 0, payload: { orderID: SINGLE } });
    expect((await single({ orderID: SINGLE, reconcile: true })).status).toBe(202);
    expect(db.rows.get(`${RETRIES}/${SINGLE}`).status).toBe(HELD_RETRY_STATUS);
    expect(cronRunnable(db.rows)).toEqual([]);
    expect(effects.processor).not.toHaveBeenCalled();
  });
});

describe('held retry intent — cart capture', () => {
  it('children are held until the slot stages settle, then released together; a failed release keeps every line non-runnable and replay dispatches each line once', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(CART, '150.00') } });
    // Fail only the release write (the one carrying releasedAt), after the held intents were persisted.
    db.failNextMatching((path, value) => path.startsWith(`${RETRIES}/`) && !!value && 'releasedAt' in value);
    const first = await cart();
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ reviewReason: 'intent_release_failed', paymentStatus: 'CAPTURED' });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(db.rows.get(`${RETRIES}/${CART}__L0`).status).toBe(HELD_RETRY_STATUS);
    expect(db.rows.get(`${RETRIES}/${CART}__L1`).status).toBe(HELD_RETRY_STATUS);
    expect(cronRunnable(db.rows)).toEqual([]);
    const replay = await cart({ orderID: CART, reconcile: true });
    expect(replay.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(effects.processor).toHaveBeenCalledTimes(2);
    expect(db.rows.get(`${RETRIES}/${CART}__L0`)).toMatchObject({ status: 'done', attempts: 0 });
    expect(db.rows.get(`${RETRIES}/${CART}__L1`)).toMatchObject({ status: 'done', attempts: 0 });
  });

  it('a cancelled child blocks only its own line; a cart whose every line is stopped answers a non-active 202', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(CART, '150.00') } });
    db.rows.set(`bookings/${CART}__L0`, { status: 'CANCELLED', bookingRef: `${CART}__L0`, memo: 'KEEP' });
    expect((await cart()).status).toBe(200);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.processor.mock.calls[0][0].retryDocId).toBe(`${CART}__L1`);
    expect(db.rows.get(`${RETRIES}/${CART}__L0`)).toMatchObject({ status: 'permanent-failure', lastFailureReason: 'booking_stopped:CANCELLED' });
    expect(db.rows.get(`bookings/${CART}__L0`)).toMatchObject({ status: 'CANCELLED', memo: 'KEEP' });

    seed(); provider = providerFetch([{ method: 'POST', reply: { status: 201, body: completedOrder(CART, '150.00') } }]); vi.stubGlobal('fetch', provider.impl);
    effects.processor.mockClear();
    db.rows.set(`bookings/${CART}__L0`, { status: 'REFUNDED' });
    db.rows.set(`bookings/${CART}__L1`, { status: 'REFUND_PENDING' });
    const state = await cart();
    expect(state.status).toBe(202);
    expect(state.body).toMatchObject({ bookingStatus: 'BOOKING_STOPPED', reviewReason: 'booking_stopped', finalized: false });
    expect(effects.processor).not.toHaveBeenCalled();
    expect(cronRunnable(db.rows)).toEqual([]);
    expect((await cart({ orderID: CART, reconcile: true })).body).toMatchObject({ bookingStatus: 'BOOKING_STOPPED', replayed: true });
    expect(effects.processor).not.toHaveBeenCalled();
  });

  it('a pre-existing terminal child record keeps its status and attempts through persist, release and replay', async () => {
    provider.push({ method: 'POST', reply: { status: 201, body: completedOrder(CART, '150.00') } });
    const terminal = { status: 'manual-intervention', attempts: 3, payload: { orderID: `${CART}__L0` }, stepStatus: { email: 'outcome_unknown' } };
    db.rows.set(`${RETRIES}/${CART}__L0`, terminal);
    expect((await cart()).status).toBe(200);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.processor.mock.calls[0][0].retryDocId).toBe(`${CART}__L1`);
    expect(db.rows.get(`${RETRIES}/${CART}__L0`)).toEqual(terminal);
  });
});

describe('held retry intent — helper contract', () => {
  it('release opens only held records; terminal-before-refund closes open records, stops the booking and never downgrades REFUNDED or closed intents', async () => {
    const { db: raw, rows } = memoryDb();
    const acquired = (await acquirePaymentAttempt({ db: raw, orderID: 'H1', flow: 'single', environment: 'live', requestKey: 'H1-cap', intent: { body: {} }, nowMs: 1 })) as { kind: string; attempt: Row };
    await persistBookingsAtomically({ db: raw, attempt: acquired.attempt, timestamp: 'TS', bookings: [{ orderID: 'H1', doc: { status: 'CONFIRMED', memo: 'KEEP' }, payload: { orderID: 'H1' }, source: 't' }] });
    rows.set(`${RETRIES}/H2`, { status: 'done', attempts: 2 });
    rows.set(`${RETRIES}/H3`, { status: 'pending', attempts: 1 });
    expect(rows.get(`${RETRIES}/H1`).status).toBe(HELD_RETRY_STATUS);
    expect(cronRunnable(rows)).toEqual([`${RETRIES}/H3`]);
    const ids = (list: string[]) => list.map((id) => ({ retryDocId: id, bookingId: id }));
    const release = (attempt: unknown, list: string[]) => releaseHeldIntents({ db: raw, attempt, intents: ids(list), timestamp: 'TS' });
    // A worker that lost the claim opens nothing.
    await expect(release({ ...acquired.attempt, claimToken: 'stale' }, ['H1'])).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(rows.get(`${RETRIES}/H1`).status).toBe(HELD_RETRY_STATUS);
    expect(await release(acquired.attempt, ['H1', 'H2', 'H3', 'H4'])).toEqual({ H1: 'pending', H2: 'done', H3: 'pending', H4: 'missing' });
    expect(rows.get(`${RETRIES}/H2`)).toEqual({ status: 'done', attempts: 2 });
    expect(rows.has(`${RETRIES}/H4`)).toBe(false);
    // Stopped bookings: held/pending intents are closed with attempts kept; closed records stay as they are.
    rows.set(`${RETRIES}/H5`, { status: HELD_RETRY_STATUS, attempts: 0 }); rows.set('bookings/H5', { status: 'REFUND_PENDING', memo: 'KEEP' });
    rows.set(`${RETRIES}/H6`, { status: 'pending', attempts: 4 }); rows.set('bookings/H6', { status: 'CANCELLED' });
    rows.set(`${RETRIES}/H7`, { status: 'done', attempts: 1, sweptAt: 'OLD' }); rows.set('bookings/H7', { status: 'REFUNDED' });
    expect(await release(acquired.attempt, ['H5', 'H6', 'H7'])).toEqual({ H5: 'stopped', H6: 'stopped', H7: 'done' });
    expect(rows.get(`${RETRIES}/H5`)).toMatchObject({ status: 'permanent-failure', attempts: 0, lastFailureReason: 'booking_stopped:REFUND_PENDING' });
    expect(rows.get(`${RETRIES}/H6`)).toMatchObject({ status: 'permanent-failure', attempts: 4, lastFailureReason: 'booking_stopped:CANCELLED' });
    expect(rows.get(`${RETRIES}/H7`)).toEqual({ status: 'done', attempts: 1, sweptAt: 'OLD' });
    expect(rows.get('bookings/H5')).toEqual({ status: 'REFUND_PENDING', memo: 'KEEP' });
    expect(cronRunnable(rows)).toEqual([`${RETRIES}/H1`, `${RETRIES}/H3`]);

    rows.set(`${RETRIES}/H1`, { ...rows.get(`${RETRIES}/H1`), attempts: 5 });
    await recordTerminalBeforeRefund({ db: raw, attempt: acquired.attempt, orderID: 'H1', retryDocIds: ['H1', 'H2'], refundReason: 'PROMO_LIMIT_EXCEEDED', timestamp: 'TS', lockPatch: { finalOutcome: 'promo_refund_required' } });
    expect(rows.get('bookings/H1')).toMatchObject({ status: 'REFUND_PENDING', memo: 'KEEP', refundReason: 'PROMO_LIMIT_EXCEEDED' });
    expect(rows.get(`${RETRIES}/H1`)).toMatchObject({ status: 'permanent-failure', attempts: 5 });
    expect(rows.get(`${RETRIES}/H2`)).toEqual({ status: 'done', attempts: 2 });
    expect(rows.get('used_paypal_orders/H1')).toMatchObject({ finalized: true, finalOutcome: 'promo_refund_required' });
    expect(await release(acquired.attempt, ['H1'])).toEqual({ H1: 'permanent-failure' });
    expect(cronRunnable(rows)).toEqual([`${RETRIES}/H3`]);

    rows.set('bookings/H1', { status: 'REFUNDED', memo: 'KEEP' });
    await recordTerminalBeforeRefund({ db: raw, attempt: acquired.attempt, orderID: 'H1', retryDocIds: [], refundReason: 'PROMO_LIMIT_EXCEEDED', timestamp: 'TS', lockPatch: {} });
    expect(rows.get('bookings/H1')).toEqual({ status: 'REFUNDED', memo: 'KEEP' });
  });
});
