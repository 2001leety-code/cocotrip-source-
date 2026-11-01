/**
 * 2026-11-01 B6-1 r23 — captureCartOrder: 'posted' 저장 실패(noPost = PayPal 에 POST 0회).
 *   무증명 요청 = 기록 삭제(소유자 확인 때 외부인 입력 재생 없음), 응답은 r24 부터 main 과 같은 202 CAPTURE_UNKNOWN 모양(r23 은 503)
 *   · 증명 있는 요청 = 기존 202 UNKNOWN(기록 유지).
 *   main 비교: main 은 무증명이어도 'unknown' 으로 남겨, 나중 확인이 그 입력으로 capture·예약했다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDb, fakeRes, providerFetch, type MemoryDb } from './helpers/payment-recovery-fixture';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';

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

const ORDER = 'OFFLINE-R23-CART';
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

let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(); effects.store.db = db.db;
  db.rows.set(`cart_orders/${ORDER}`, { ...snapshot });
  provider = providerFetch([]); vi.stubGlobal('fetch', provider.impl);
  effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
  db.failNextMatching((path, value) => path === LOCK && !!value && value.captureState === 'posted');
});

describe('r23-3 cart — the "posted" write before the POST fails', () => {
  // r24: main's 202 CAPTURE_UNKNOWN shape (r23 answered 503 CAPTURE_UNAVAILABLE).
  it('unproven: zero PayPal calls, 202 CAPTURE_UNKNOWN shape, record deleted (no stranger input left)', async () => {
    const out = await call({ orderID: ORDER, userEmail: 'attacker@evil.invalid' }, {});
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN', flow: 'cart' });
    expect(JSON.stringify(out.body)).not.toMatch(/CAPTURE_UNAVAILABLE|please retry/);
    expect(provider.calls).toHaveLength(0);
    expect(db.rows.has(LOCK)).toBe(false);
  });
  it('r25-3: no record + PayPal 404 RESOURCE_NOT_FOUND → 409 order_voided + tombstone (was 202 forever; main 409)', async () => {
    provider.push({ method: 'GET', reply: { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } } });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ evidence: 'order_voided', flow: 'cart' });
    expect(db.rows.get(LOCK)).toMatchObject({ status: 'void_not_captured' });
  });
  it('proven (cookie): unchanged — 202 UNKNOWN, record kept as unknown', async () => {
    const out = await call({ orderID: ORDER, userEmail: 'buyer@example.invalid' });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(db.rows.get(LOCK)).toMatchObject({ captureState: 'unknown' });
    expect(provider.calls).toHaveLength(0);
  });
});
