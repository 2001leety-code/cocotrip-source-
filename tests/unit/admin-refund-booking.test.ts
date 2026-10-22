/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * action='refund-booking' (2026-10-23) — 관리자 PayPal 예약(bookings) 전액 환불.
 * 잠그는 것: 인증 · 거부 가드(환불 0·선점 0) · 환경 대조 · 결과 미상 격리 · 확정 실패 복구 ·
 *   성공 저장 CAS + 전액 증명 · 금액 불일치 격리 · 웹훅 선행 · PENDING(좌석·고객 안내 보류).
 * 실제 PayPal·Firestore·텔레그램·메일 없음(전 의존 모듈 mock, 가짜 Firestore 는 transaction 흉내).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';
import { fullRefundProofMatchesCapture } from '../../api/_shared/payment-fulfillment-recovery.js';

const authHolder: { result: any } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' } };
const refundSpy = vi.fn<(args: any) => Promise<any>>(async () => ({}));
const alertSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ ok: true }));
const releaseSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ ok: true, released: true }));
const sendEmailSpy = vi.fn<(args: any) => Promise<any>>(async () => undefined);
let db: ReturnType<typeof createFakeFirestore>;

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: (args: any) => refundSpy(args) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: (args: any) => alertSpy(args) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ releaseSlotForCanceledOrder: (args: any) => releaseSpy(args) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true, delivery: 'sent' })) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (args: any) => sendEmailSpy(args) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({
  buildManualPaymentEmail: (_kind: string, b: any) => ({ subject: 's', html: String(b?.refundReason || ''), text: '' }),
}));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true, bookingId: 'b1' })) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/admin-booking-action.js');

const REF = 'ORD-1';
const PATH = `bookings/${REF}`;
const OK_BODY = { bookingRef: REF, action: 'refund-booking', cancelCategory: 'customer_request', reason: 'Customer asked to cancel' };
const receipt = (value = '100.00', status = 'COMPLETED') => ({
  ok: true, final: status === 'COMPLETED', ...(status === 'PENDING' ? { pending: true } : {}), httpStatus: 201,
  refund: { id: 'RF-1', status, amount: { value, currency_code: 'USD' } },
});
const goodBooking = (over: Record<string, any> = {}) => ({
  status: 'CONFIRMED', captureID: 'CAP-1', amountUSD: '100.00', amountKRW: 135000, currency: 'USD',
  paymentVerified: true, paypalEnvironment: 'live', userEmail: 'cust@x.com', language: 'en', orderID: REF, ...over,
});

async function call(body: object = OK_BODY) {
  const out = { statusCode: 0, body: '' };
  const res = { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'POST', url: '/api/admin-booking-action', headers: { host: 'unit.test' }, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}
const auditEntries = () => Object.entries(db.__dump()).filter(([p]) => p.startsWith('admin_actions/')).map(([, v]) => v as any);

const savedEnv = { VERCEL_ENV: process.env.VERCEL_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV };
let consoleSpies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' };
  refundSpy.mockReset(); refundSpy.mockResolvedValue(receipt());
  alertSpy.mockClear(); releaseSpy.mockClear(); sendEmailSpy.mockClear();
  db = createFakeFirestore({ [PATH]: goodBooking() });
  consoleSpies = [
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  consoleSpies.forEach((s) => s.mockRestore());
});

describe('refund-booking — auth and input', () => {
  it('401 / 403 from the admin token gate', async () => {
    authHolder.result = { ok: false, status: 401, error: 'no token' };
    expect((await call()).statusCode).toBe(401);
    authHolder.result = { ok: false, status: 403, error: 'not admin' };
    expect((await call()).statusCode).toBe(403);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('category and reason are required', async () => {
    expect((await call({ ...OK_BODY, cancelCategory: 'whatever' })).json.code).toBe('MISSING_CANCEL_CATEGORY');
    expect((await call({ ...OK_BODY, reason: '   ' })).json.code).toBe('MISSING_REASON');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('404 when bookings/{bookingRef} does not exist', async () => {
    db.__delete(PATH);
    const r = await call();
    expect(r.statusCode).toBe(404);
    expect(r.json.code).toBe('NOT_FOUND');
  });
});

describe('refund-booking — refusal guards: no refund call, no claim', () => {
  const cases: [string, Record<string, any>, number, string, (() => void)?][] = [
    ['CANCELING', { status: 'CANCELING' }, 409, 'CANCEL_IN_PROGRESS'],
    ['REFUND_UNKNOWN', { status: 'REFUND_UNKNOWN' }, 409, 'REFUND_UNKNOWN_BLOCKED'],
    ['not CONFIRMED', { status: 'CANCELED' }, 400, 'INVALID_STATUS'],
    ['cart child', { parentOrderID: 'CART-1' }, 409, 'CART_CHILD_MANUAL_REFUND'],
    ['braintree', { provider: 'braintree' }, 409, 'LEGACY_BRAINTREE_BOOKING'],
    ['no captureID', { captureID: null }, 400, 'NO_CAPTURE_ID'],
    ['refundID history', { refundID: 'OLD' }, 409, 'REFUND_HISTORY_EXISTS'],
    ['lastRefundId history', { lastRefundId: 'OLD' }, 409, 'REFUND_HISTORY_EXISTS'],
    ['refundEvents object only', { refundEvents: { R1: { usd: 10 } } }, 409, 'REFUND_HISTORY_EXISTS'],
    ['linked pending (same id)', {}, 409, 'LINKED_PENDING_USE_EXISTING_FLOW', () => db.__set(`pending_bookings/${REF}`, { status: 'CONFIRMED' })],
    ['linked pending (paypalTransactionId)', {}, 409, 'LINKED_PENDING_USE_EXISTING_FLOW', () => db.__set('pending_bookings/CT-1', { paypalTransactionId: REF })],
    ['unverified payment', { paymentVerified: false }, 400, 'TEST_OR_MANUAL_NO_AUTO_REFUND'],
    ['admin-bypass payment', { paymentMethod: 'admin-bypass' }, 400, 'TEST_OR_MANUAL_NO_AUTO_REFUND'],
  ];
  for (const [label, over, status, code, prep] of cases) {
    it(label, async () => {
      db.__set(PATH, goodBooking(over));
      if (prep) prep();
      const before = JSON.stringify(db.__get(PATH));
      const r = await call();
      expect(r.statusCode).toBe(status);
      expect(r.json.code).toBe(code);
      expect(refundSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(db.__get(PATH))).toBe(before);   // no CANCELING claim
      expect(auditEntries()).toHaveLength(1);                 // audit log written before any guard
    });
  }

  it('a sandbox booking on a sandbox deployment (environment matches) is still blocked as test', async () => {
    process.env.VERCEL_ENV = 'preview'; process.env.PAYPAL_ENV = 'sandbox';
    db.__set(PATH, goodBooking({ paypalEnvironment: 'sandbox' }));
    const r = await call();
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('TEST_OR_MANUAL_NO_AUTO_REFUND');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('environment mismatch both ways → 409 REFUND_ENV_MISMATCH, no claim', async () => {
    db.__set(PATH, goodBooking({ paypalEnvironment: 'sandbox' }));   // live runtime
    expect((await call()).json.code).toBe('REFUND_ENV_MISMATCH');
    process.env.VERCEL_ENV = 'preview'; process.env.PAYPAL_ENV = 'sandbox';
    db.__set(PATH, goodBooking({ paypalEnvironment: undefined }));   // legacy = live
    expect((await call()).json.code).toBe('REFUND_ENV_MISMATCH');
    expect(refundSpy).not.toHaveBeenCalled();
    expect(db.__get(PATH)!.status).toBe('CONFIRMED');
  });
});

describe('refund-booking — success', () => {
  it('full refund with the shared key, CANCELED, admin-api proof matching the capture, audit, seats, mail', async () => {
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(r.json.data).toMatchObject({ bookingRef: REF, status: 'CANCELED', refundSource: 'paypal-api', refundID: 'RF-1', refundFinal: true, refundedUSD: 100, refundedKRW: 135000 });
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy.mock.calls[0][0]).toMatchObject({ captureID: 'CAP-1', idempotencyKey: REF, refundUSD: null, currency: 'USD', receipt: true, isSandbox: false });
    const saved = db.__get(PATH)!;
    expect(saved).toMatchObject({ status: 'CANCELED', cancelCategory: 'customer_request', cancelFault: 'customer', refundID: 'RF-1', refundPercent: 100, refundSource: 'paypal-api', canceledByUid: 'admin1' });
    expect(saved.fullRefundProof).toMatchObject({ source: 'admin-api', environment: 'live', refundIDs: ['RF-1'], amountMinor: 10000 });
    expect(fullRefundProofMatchesCapture(saved.fullRefundProof, { environment: 'live', captureVerified: { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000 } })).toBe(true);
    expect(auditEntries()[0]).toMatchObject({ adminUid: 'admin1', bookingRef: REF, action: 'refund-booking', previousStatus: 'CONFIRMED', target: 'bookings' });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect((sendEmailSpy.mock.calls[0][0] as any).to).toBe('cust@x.com');
  });

  it('the webhook already wrote REFUNDED meanwhile → status kept, only the proof is merged', async () => {
    refundSpy.mockImplementation(async () => {
      db.__patch(PATH, { status: 'REFUNDED', refundedBySource: 'webhook' });
      return receipt();
    });
    const r = await call();
    expect(r.statusCode).toBe(200);
    const saved = db.__get(PATH)!;
    expect(saved.status).toBe('REFUNDED');
    expect(saved.refundedBySource).toBe('webhook');
    expect(saved).not.toHaveProperty('refundSource');
    expect(saved.fullRefundProof).toMatchObject({ source: 'admin-api', refundIDs: ['RF-1'] });
  });

  it('PENDING refund → CANCELED, no seat release, no customer mail', async () => {
    refundSpy.mockResolvedValue(receipt('100.00', 'PENDING'));
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(r.json.data.refundFinal).toBe(false);
    expect(db.__get(PATH)!.status).toBe('CANCELED');
    expect(db.__get(PATH)).not.toHaveProperty('fullRefundProof');
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });
});

describe('refund-booking — failures', () => {
  it('outcome unknown (helper outcomeUnknown:true, e.g. 5xx / unreadable body) → REFUND_UNKNOWN + critical alert + 202; a second call is 409', async () => {
    refundSpy.mockResolvedValue({ ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'HTTP 503', status: 502, outcomeUnknown: true });
    const r = await call();
    expect(r.statusCode).toBe(202);
    expect(r.json.code).toBe('REFUND_PENDING_VERIFICATION');
    expect(db.__get(PATH)).toMatchObject({ status: 'REFUND_UNKNOWN', refundUnknownCode: 'PAYPAL_REFUND_FAILED', refundIdempotencyKey: REF });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatchObject({ key: 'refund-outcome-unknown', severity: 'critical', channel: 'admin' });
    const again = await call();
    expect(again.statusCode).toBe(409);
    expect(again.json.code).toBe('REFUND_UNKNOWN_BLOCKED');
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });

  it('timeout code alone (no flag) is also treated as unknown', async () => {
    refundSpy.mockResolvedValue({ ok: false, code: 'PAYPAL_REFUND_TIMEOUT', error: 'timeout', status: 502 });
    expect((await call()).statusCode).toBe(202);
    expect(db.__get(PATH)!.status).toBe('REFUND_UNKNOWN');
  });

  it('explicit PayPal failure (outcomeUnknown:false) → CONFIRMED restored, error status returned', async () => {
    refundSpy.mockResolvedValue({ ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'UNPROCESSABLE_ENTITY', status: 502, outcomeUnknown: false });
    const r = await call();
    expect(r.statusCode).toBe(502);
    const saved = db.__get(PATH)!;
    expect(saved.status).toBe('CONFIRMED');
    expect(saved).not.toHaveProperty('cancelClaimedAt');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('COMPLETED but not the full amount → REFUND_UNKNOWN (REFUND_AMOUNT_MISMATCH), 202, no seats, no mail', async () => {
    refundSpy.mockResolvedValue(receipt('50.00'));
    const r = await call();
    expect(r.statusCode).toBe(202);
    expect(db.__get(PATH)).toMatchObject({ status: 'REFUND_UNKNOWN', refundUnknownCode: 'REFUND_AMOUNT_MISMATCH' });
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
