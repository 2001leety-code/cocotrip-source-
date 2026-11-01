/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 2026-11-01 B6-1 r20 — webhook 묘비 충돌의 알림·환경. 완전 오프라인(fake Firestore, 서명 검증 모의).
 *   4) payment_reviews 저장이 한 번 실패(503) → 재전송(200)에서 운영자 알림 정확히 1회, 그 뒤 재전송은 알림 0.
 *   5) 다른 환경(sandbox) 이벤트는 기존 live 충돌 기록을 덮어쓰지 않는다(환경 검사가 먼저).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';
import { memoryDb } from './helpers/payment-recovery-fixture';
import { quarantineVoidedCapture } from '../../api/_shared/payment-fulfillment-recovery.js';

const notifySpy = vi.fn(async () => ({ ok: true, delivery: 'sent' })); // notify.js 의 실제 반환 계약
let db: any;
let failReviewWrites = 0;
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

const ORDER = '7R20TOMBSTONE00X';
const TOMB = { status: 'void_not_captured', captureState: 'not_captured', reason: 'no_attempt_record', flow: 'single', environment: 'live', voidedAtMs: 1, voidedAt: '2026-11-01T00:00:00.000Z', claimUntil: 0 };
const savedEnv = { ...process.env };

function withFailingReviews(seed: Record<string, unknown>) {
  const base = createFakeFirestore(seed);
  return {
    ...base,
    collection: (name: string) => {
      const col = base.collection(name);
      if (name !== 'payment_reviews') return col;
      return { ...col, doc: (id: string) => ({ ...col.doc(id), set: async (data: any, o: any) => { if (failReviewWrites > 0) { failReviewWrites -= 1; throw new Error('review store down'); } return col.doc(id).set(data, o); } }) };
    },
    __get: base.__get,
  };
}
async function fire(eventId: string) {
  const out = { statusCode: 0, body: '' };
  await webhook({
    method: 'POST',
    headers: { 'paypal-transmission-id': eventId, 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-11-01T00:00:00Z' },
    body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-R20', amount: { value: '100.00', currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: ORDER } } } }),
  } as any, { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } } as any);
  return { statusCode: out.statusCode, json: out.body ? JSON.parse(out.body) : null };
}

beforeEach(() => {
  notifySpy.mockClear();
  failReviewWrites = 0;
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  db = withFailingReviews({ [`used_paypal_orders/${ORDER}`]: { ...TOMB } });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' })) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('r20-4 — the void-conflict alert survives a failed review write', () => {
  it('review write fails once → 503; redelivery → 200 + exactly one alert (alertedAtMs recorded); a later redelivery alerts 0 times', async () => {
    failReviewWrites = 1;
    const first = await fire('txn-r20-1');
    expect(first.statusCode).toBe(503);
    expect(notifySpy).not.toHaveBeenCalled();
    expect(db.__get(`used_paypal_orders/${ORDER}`)).toMatchObject({ status: 'captured', reviewQuarantined: true, voidConflict: { captureID: 'CAP-R20' } });

    const again = await fire('txn-r20-1');
    expect(again.statusCode).toBe(200);
    expect(again.json).toMatchObject({ status: 'payment_review' });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(typeof db.__get(`used_paypal_orders/${ORDER}`).voidConflict.alertedAtMs).toBe('number');
    expect(db.__get(`payment_reviews/${ORDER}`)).toMatchObject({ mismatchCode: 'CAPTURED_AFTER_VOID' });

    await fire('txn-r20-2');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });
  // r21: notify() never throws — it RETURNS {ok:false, delivery}. Only delivery 'sent' records alertedAtMs; rejected / skipped /
  //   unknown answer retryable (503) without recording, so the redelivery alerts again (unknown may duplicate — loss is worse).
  it.each(['rejected', 'skipped', 'unknown'] as const)('notify returns delivery "%s" → 503, alertedAtMs NOT recorded; the redelivery (sent) alerts and records', async (delivery) => {
    notifySpy.mockResolvedValueOnce({ ok: false, delivery, error: 'telegram 429' } as never);
    expect((await fire('txn-r21-1')).statusCode).toBe(503);
    expect(db.__get(`used_paypal_orders/${ORDER}`).voidConflict.alertedAtMs).toBeUndefined();
    notifySpy.mockResolvedValueOnce({ ok: true, delivery: 'sent' } as never);
    expect((await fire('txn-r21-1')).statusCode).toBe(200);
    expect(notifySpy).toHaveBeenCalledTimes(2);
    expect(typeof db.__get(`used_paypal_orders/${ORDER}`).voidConflict.alertedAtMs).toBe('number');
    expect((await fire('txn-r21-2')).statusCode).toBe(200);
    expect(notifySpy).toHaveBeenCalledTimes(2);
  });
  it('a throwing notify (defensive) is treated like delivery unknown → 503, not recorded', async () => {
    notifySpy.mockRejectedValueOnce(new Error('telegram down'));
    expect((await fire('txn-r21-3')).statusCode).toBe(503);
    expect(db.__get(`used_paypal_orders/${ORDER}`).voidConflict.alertedAtMs).toBeUndefined();
  });
});

describe('r20-5 — environment is checked before an existing conflict record', () => {
  it('a sandbox event never overwrites the live conflict evidence (null, no write)', async () => {
    const mem = memoryDb();
    const live = { ...TOMB, status: 'captured', captureState: 'captured', reviewQuarantined: true, voidConflict: { captureID: 'LIVE-CAP', amountValue: '100', currency: 'USD', eventId: 'e1', environment: 'live', detectedAtMs: 1 } };
    mem.rows.set(`used_paypal_orders/${ORDER}`, JSON.parse(JSON.stringify(live)));
    const out = await quarantineVoidedCapture({ db: mem.db, orderID: ORDER, captureID: 'SBX-CAP', amountValue: '1', currency: 'USD', eventId: 'e2', environment: 'sandbox' });
    expect(out).toBeNull();
    expect(mem.rows.get(`used_paypal_orders/${ORDER}`)).toEqual(live);
    // the same environment still answers "already recorded" (review write retryable)
    expect(await quarantineVoidedCapture({ db: mem.db, orderID: ORDER, captureID: 'LIVE-CAP', amountValue: '100', currency: 'USD', eventId: 'e1', environment: 'live' })).toMatchObject({ already: true, alerted: false });
  });
});
