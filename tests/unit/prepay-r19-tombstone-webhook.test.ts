/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 2026-11-01 B6-1 r19 — 묘비와 다른 기록의 관계. 완전 오프라인.
 *   A6) 검증된 PayPal CAPTURED webhook 이 묘비 주문에 오면: 결제 증거 보존 + payment_reviews 격리 + 알림, 자동 환불 0,
 *       이후 "미결제" 답 없음·새 주문 차단(검토 해결 전).
 *   A7) 묘비는 isCheckoutUnresolved·findUnfinishedCheckout 에서 미해결이 아니다(새 결제를 막지 않는다).
 *   보존) 확정·결제 증거·예약 기록은 묘비가 덮지 않는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';
import { memoryDb } from './helpers/payment-recovery-fixture';
import {
  isCheckoutUnresolved, findUnfinishedCheckout, discardAttempt, resolveAbsentAttempt, quarantineVoidedCapture, acquirePaymentAttempt,
  newCheckoutCapability, checkoutCookie,
} from '../../api/_shared/payment-fulfillment-recovery.js';

const notifySpy = vi.fn(async () => ({ ok: true }));
let db: any;
vi.mock('../../api/_shared/paypal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api-m.paypal.com' }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: webhook } = await import('../../api/paypal-webhook.js');

const ORDER = '7R19TOMBSTONE00X';
const TOMB = { status: 'void_not_captured', captureState: 'not_captured', reason: 'no_attempt_record', flow: 'single', environment: 'live', voidedAtMs: 1, voidedAt: '2026-11-01T00:00:00.000Z', claimUntil: 0 };
const savedEnv = { ...process.env };
let fetchCalls: string[] = [];

async function fire(eventId: string) {
  const out = { statusCode: 0, body: '' };
  await webhook({
    method: 'POST',
    headers: { 'paypal-transmission-id': eventId, 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-11-01T00:00:00Z' },
    body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-R19', amount: { value: '100.00', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: ORDER } } } }),
  } as any, { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } } as any);
  return { statusCode: out.statusCode, json: out.body ? JSON.parse(out.body) : null };
}

beforeEach(() => {
  notifySpy.mockClear();
  fetchCalls = [];
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  db = createFakeFirestore({ [`used_paypal_orders/${ORDER}`]: { ...TOMB } });
  global.fetch = vi.fn(async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' };
  }) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('A6 — verified CAPTURED webhook for a voided order', () => {
  it('keeps the payment evidence, quarantines for review, alerts once, never refunds; later answers are never "not captured"', async () => {
    const r = await fire('txn-r19-1');
    expect(r.statusCode).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: 'payment_review' });
    const lock = db.__get(`used_paypal_orders/${ORDER}`);
    expect(lock).toMatchObject({ status: 'captured', captureState: 'captured', reviewQuarantined: true, voidedReason: 'no_attempt_record', voidConflict: { captureID: 'CAP-R19', amountValue: '100', currency: 'USD', eventId: 'txn-r19-1', environment: 'live' } });
    expect(db.__get(`payment_reviews/${ORDER}`)).toMatchObject({ orderID: ORDER, flow: 'single', mismatchCode: 'CAPTURED_AFTER_VOID', paymentCaptured: true, captureID: 'CAP-R19', resolvedAt: null });
    expect(db.__get(`paypal_webhook_log/txn-r19-1`)).toMatchObject({ status: 'processed' });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((u) => /refund/i.test(u))).toBe(false);
    expect(db.__get(`bookings/${ORDER}`)).toBeUndefined();

    // a new event id for the same capture: already recorded → no second alert, still review
    const again = await fire('txn-r19-2');
    expect(again.json).toMatchObject({ status: 'payment_review' });
    expect(notifySpy).toHaveBeenCalledTimes(1);

    // the converted lock blocks new orders until the review resolves, and is never captured again
    expect(isCheckoutUnresolved(db.__get(`used_paypal_orders/${ORDER}`), { resolvedAt: null })).toBe(true);
    const acquired = await acquirePaymentAttempt({ db, orderID: ORDER, flow: 'single', environment: 'live', requestKey: 'k', intent: { body: {} }, allowRecovery: true });
    expect(acquired.kind).toBe('duplicate');
  });

  it('a capture event for an ordinary (non-voided) order without booking still takes the unmatched path', async () => {
    db = createFakeFirestore({});
    const r = await fire('txn-r19-3');
    expect(r.json).toMatchObject({ status: 'unmatched' });
  });

  it('a tombstone from the other environment is left alone', async () => {
    const mem = memoryDb();
    mem.rows.set(`used_paypal_orders/${ORDER}`, { ...TOMB, environment: 'sandbox' });
    expect(await quarantineVoidedCapture({ db: mem.db, orderID: ORDER, captureID: 'C', amountValue: '1', currency: 'USD', eventId: 'e', environment: 'live' })).toBeNull();
    expect(mem.rows.get(`used_paypal_orders/${ORDER}`)).toMatchObject({ status: 'void_not_captured' });
  });
});

describe('A7 — a tombstone never blocks a new payment', () => {
  it('isCheckoutUnresolved(tombstone) is false and findUnfinishedCheckout skips it', async () => {
    expect(isCheckoutUnresolved(TOMB, null)).toBe(false);
    const mem = memoryDb();
    const cap = newCheckoutCapability();
    mem.rows.set(`used_paypal_orders/${ORDER}`, { ...TOMB });
    mem.rows.set(`paypal_order_snapshots/${ORDER}`, { productType: 'charter_dmz', recoveryDigest: cap.digest });
    const req = { headers: { cookie: checkoutCookie('single', ORDER, cap.secret).split(';')[0] } };
    expect(await findUnfinishedCheckout({ db: mem.db, req })).toBeNull();
  });
});

describe('preservation — confirmed, captured or booked records are never overwritten by a tombstone', () => {
  it.each([
    ['finalized', { finalized: true }],
    ['verified capture', { captureVerified: { captureID: 'C1' } }],
    ['durable booking', { bookingDurable: true }],
  ])('discardAttempt refuses a %s record (CLAIM_LOST) and leaves it unchanged', async (_k, extra) => {
    const mem = memoryDb();
    const ref = mem.db.collection('used_paypal_orders').doc(ORDER);
    const row = { status: 'captured', flow: 'single', environment: 'live', claimToken: 'mine', intent: { body: {} }, ...extra };
    mem.rows.set(`used_paypal_orders/${ORDER}`, { ...row });
    await expect(discardAttempt({ db: mem.db, ref, claimToken: 'mine' } as any, 'x')).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    expect(mem.rows.get(`used_paypal_orders/${ORDER}`)).toEqual(row);
  });

  it('resolveAbsentAttempt never writes over a record that exists by the time it commits', async () => {
    const mem = memoryDb();
    const finalized = { status: 'captured', finalized: true, flow: 'single' };
    const out = await resolveAbsentAttempt({
      db: mem.db, orderID: ORDER, flow: 'single', environment: 'live', proven: true,
      lookupOrder: async () => { mem.rows.set(`used_paypal_orders/${ORDER}`, { ...finalized }); return { state: 'approved' }; },
    });
    expect(out.status).toBe(202);
    expect(mem.rows.get(`used_paypal_orders/${ORDER}`)).toEqual(finalized);
  });

  it('a voided order answers voided before ownership, finalized, legacy and flow checks', async () => {
    const mem = memoryDb();
    mem.rows.set(`used_paypal_orders/${ORDER}`, { ...TOMB, flow: 'cart', environment: 'sandbox' });
    const out = await acquirePaymentAttempt({ db: mem.db, orderID: ORDER, flow: 'single', environment: 'live', requestKey: 'k', intent: { body: {} }, allowRecovery: false });
    expect(out.kind).toBe('voided');
    expect(mem.rows.get(`used_paypal_orders/${ORDER}`)).toMatchObject({ status: 'void_not_captured' });
  });
});
