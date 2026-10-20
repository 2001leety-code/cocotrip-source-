/**
 * New order creation is blocked while an earlier capture in this browser (either flow) is unresolved.
 * createCartOrder is exercised at handler level (offline); createPaypalOrder shares the same helper and is
 * pinned by source order (block check before the PayPal order call, capability cookie + digest on success).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { memoryDb, fakeRes, providerFetch, COOKIE_RE, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

const effects = vi.hoisted(() => ({ store: { db: null as MemoryDb | null } }));
vi.mock('fs', () => ({ readFileSync: () => JSON.stringify({ charter_usd_fix_rate: 1350 }) }));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' }), resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => true }));
vi.mock('../../api/_shared/runtime-flags.js', () => ({ getRuntimeFlags: async () => ({}) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/resolve-line-item.js', () => ({
  computeCartTotalKrw: () => ({ ok: true, totalKRW: 135000, lines: [{ productType: 'airport_seoul_central', amountKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }] }),
  resolveLineItemKrw: () => 135000,
}));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ acquireSlotLock: vi.fn(), releaseSlotLock: vi.fn(), readSlotFields: () => null, fetchServerSlotCapacity: vi.fn() }));

import handler from '../../api/createCartOrder.js';

const OLD = 'OFFLINE-OLD-SINGLE';
const cap = newCheckoutCapability();
const singleCookie = checkoutCookie('single', OLD, cap.secret).split(';')[0];
async function call(headers: Record<string, string>) {
  const res = fakeRes();
  await handler({ method: 'POST', body: { items: [{ productType: 'airport_seoul_central' }], userEmail: 'buyer@example.invalid' }, headers }, res);
  return res.state;
}

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  db = memoryDb(); effects.store.db = db.db;
  const orderReply = { method: 'POST' as const, reply: { status: 201, body: { id: 'OFFLINE-NEW-CART' } } };
  provider = providerFetch([orderReply, orderReply, orderReply, orderReply]);
  vi.stubGlobal('fetch', provider.impl);
});

describe('createCartOrder — unresolved earlier checkout blocks a new order (cross-flow)', () => {
  it('an unresolved SINGLE capture bound to this browser blocks a new CART order before any PayPal call', async () => {
    db.rows.set(`used_paypal_orders/${OLD}`, { status: 'pending', flow: 'single', intent: { body: {} }, captureState: 'unknown' });
    db.rows.set(`paypal_order_snapshots/${OLD}`, { recoveryDigest: cap.digest });
    const state = await call({ cookie: singleCookie });
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: OLD, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', bookingStatus: 'BOOKING_STATE_UNKNOWN', finalized: false, retryable: false });
    expect(provider.calls).toHaveLength(0);
    expect(db.rows.has('cart_orders/OFFLINE-NEW-CART')).toBe(false);
  });

  it('a cookie whose secret does not match the stored digest is not this browser\'s order; durable / finalized / resolved-review attempts do not block', async () => {
    db.rows.set(`used_paypal_orders/${OLD}`, { status: 'pending', flow: 'single', intent: { body: {} }, captureState: 'unknown' });
    db.rows.set(`paypal_order_snapshots/${OLD}`, { recoveryDigest: newCheckoutCapability().digest });
    expect((await call({ cookie: singleCookie })).status).toBe(200);
    db.rows.set(`paypal_order_snapshots/${OLD}`, { recoveryDigest: cap.digest });
    db.rows.set(`used_paypal_orders/${OLD}`, { status: 'captured', flow: 'single', intent: { body: {} }, bookingDurable: true });
    expect((await call({ cookie: singleCookie })).status).toBe(200);
    db.rows.set(`used_paypal_orders/${OLD}`, { status: 'captured', flow: 'single', intent: { body: {} }, reviewQuarantined: true });
    db.rows.set(`payment_reviews/${OLD}`, { resolvedAt: null });
    expect((await call({ cookie: singleCookie })).status).toBe(409);
    db.rows.set(`payment_reviews/${OLD}`, { resolvedAt: 'TS', resolution: 'MANUALLY_CONFIRMED' });
    expect((await call({ cookie: singleCookie })).status).toBe(200);
  });

  it('a cookie that cannot be checked fails closed (503) — no cookie needs no check', async () => {
    effects.store.db = null;
    expect((await call({ cookie: singleCookie })).body.code).toBe('RECOVERY_CHECK_UNAVAILABLE');
    expect(provider.calls).toHaveLength(0);
  });

  it('a new order binds a server capability: HttpOnly per-flow cookie, digest + owner in the snapshot, secret never in the body', async () => {
    const state = await call({});
    expect(state.status).toBe(200);
    expect(state.body.data.orderID).toBe('OFFLINE-NEW-CART');
    const setCookie = state.headers['Set-Cookie'];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Path=\/api/);
    const match = COOKIE_RE.exec(setCookie)!;
    expect(match[1]).toBe('cart');
    expect(match[2]).toBe('OFFLINE-NEW-CART');
    const snapshot = db.rows.get('cart_orders/OFFLINE-NEW-CART');
    expect(snapshot.recoveryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.recoveryDigest).not.toBe(match[3]);
    expect(snapshot.ownerUid).toBeNull();
    expect(JSON.stringify(state.body)).not.toContain(match[3]);
  });
});

describe('createPaypalOrder — same contract by source order', () => {
  it('blocks on an unfinished checkout before the PayPal order request and binds the capability on success', async () => {
    // 'fs' is mocked above for the pricing spec; read the real source through the actual module.
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const src = fs.readFileSync(resolve(process.cwd(), 'api/createPaypalOrder.js'), 'utf8');
    const blockIdx = src.indexOf('findUnfinishedCheckout({');
    const orderIdx = src.indexOf('/v2/checkout/orders`');
    expect(blockIdx).toBeGreaterThan(-1);
    expect(orderIdx).toBeGreaterThan(blockIdx);
    expect(src).toMatch(/RECOVERY_CHECK_UNAVAILABLE/);
    expect(src).toMatch(/recoveryDigest:\s*checkoutCapability\.digest/);
    expect(src).toMatch(/ownerUid:\s*ownerUid\s*\|\|\s*null/);
    // 2026-10-10 R2: `req` is passed so the browser's earlier order entries are kept in the same cookie.
    expect(src).toMatch(/'Set-Cookie':\s*checkoutCookie\('single',\s*order\.id,\s*checkoutCapability\.secret,\s*req\)/);
  });
});
