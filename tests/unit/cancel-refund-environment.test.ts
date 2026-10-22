/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * cancelBooking 환불 환경 대조 (2026-10-23).
 * 환불 환경 = 이 배포의 PayPal 환경(resolveIsSandbox). 예약 결제 환경(paypalEnvironment, 없음 = legacy live)과
 * 다르면 다른 환경의 capture 를 환불하게 된다 → 409 REFUND_ENV_MISMATCH, 선점·환불 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const refundHolder: { r: any; lastArgs?: any; calls: number } = { r: null, calls: 0 };
let bookingState: any;
let txUpdates: any[];
let plainUpdates: any[];

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => ({ ok: true, email: 'cust@x.com', uid: 'u1' }) }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({
  refundPaypalCapture: async (args: any) => { refundHolder.calls += 1; refundHolder.lastArgs = args; return refundHolder.r; },
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: '', html: '', text: '' }) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => x }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ releaseSlotForCanceledOrder: vi.fn(async () => ({ ok: true, released: false, reason: 'NO_SNAPSHOT_BINDING' })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

function makeDb() {
  const bookingsDoc = {
    get: async () => ({ exists: true, data: () => ({ ...bookingState }) }),
    update: async (patch: any) => { plainUpdates.push(patch); Object.assign(bookingState, patch); },
  };
  return {
    collection: (name: string) => ({
      doc: () => (name === 'users'
        ? { get: async () => ({ exists: true, data: () => ({ tier: 'Bronze' }) }) }
        : bookingsDoc),
    }),
    runTransaction: async (fn: any) => fn({
      get: async () => ({ exists: true, data: () => ({ ...bookingState }) }),
      update: (_ref: any, patch: any) => { txUpdates.push(patch); Object.assign(bookingState, patch); },
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/cancelBooking.js');

async function cancel() {
  const out = { statusCode: 0, body: '' };
  const res = { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'POST', url: '/api/cancelBooking', headers: { host: 'unit.test' }, body: { bookingID: 'CT-ENV-1', reason: 'plans changed' } } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}

const fullReceipt = { ok: true, final: true, httpStatus: 201, refund: { id: 'RF-1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } };
const savedEnv = { VERCEL_ENV: process.env.VERCEL_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV };
const runtimeLive = () => { process.env.VERCEL_ENV = 'production'; delete process.env.PAYPAL_ENV; };
const runtimeSandbox = () => { process.env.VERCEL_ENV = 'preview'; process.env.PAYPAL_ENV = 'sandbox'; };

beforeEach(() => {
  refundHolder.r = fullReceipt; refundHolder.lastArgs = undefined; refundHolder.calls = 0;
  txUpdates = []; plainUpdates = [];
  bookingState = {
    userEmail: 'cust@x.com', status: 'CONFIRMED', captureID: 'CAP-1',
    productType: 'airport-pickup', tourDate: '2099-12-31', tourTime: '10:00',
    amountUSD: '100.00', amountKRW: 143000, currency: 'USD',
  };
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('cancelBooking — refund environment must match the deployment', () => {
  it('live runtime + sandbox booking → 409 REFUND_ENV_MISMATCH, no claim, no refund', async () => {
    runtimeLive();
    bookingState.paypalEnvironment = 'sandbox';
    const r = await cancel();
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('REFUND_ENV_MISMATCH');
    expect(refundHolder.calls).toBe(0);
    expect(txUpdates).toHaveLength(0);
    expect(bookingState.status).toBe('CONFIRMED');
  });

  it('sandbox runtime + legacy booking (no env field = live) → 409, no claim, no refund', async () => {
    runtimeSandbox();
    const r = await cancel();
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('REFUND_ENV_MISMATCH');
    expect(refundHolder.calls).toBe(0);
    expect(txUpdates).toHaveLength(0);
  });

  it('sandbox runtime + sandbox booking → refunds with isSandbox:true; proof environment sandbox', async () => {
    runtimeSandbox();
    bookingState.paypalEnvironment = 'sandbox';
    const r = await cancel();
    expect(r.statusCode).toBe(200);
    expect(refundHolder.lastArgs).toMatchObject({ isSandbox: true, idempotencyKey: 'CT-ENV-1', receipt: true });
    expect(plainUpdates[0].fullRefundProof).toMatchObject({ environment: 'sandbox', source: 'cancel-api' });
  });

  it('live runtime + legacy booking → refunds with isSandbox:false (unchanged behaviour)', async () => {
    runtimeLive();
    const r = await cancel();
    expect(r.statusCode).toBe(200);
    expect(refundHolder.lastArgs).toMatchObject({ isSandbox: false });
    expect(plainUpdates[0].fullRefundProof).toMatchObject({ environment: 'live' });
  });
});
