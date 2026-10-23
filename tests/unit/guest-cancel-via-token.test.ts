/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 게스트 취소 — 예약 관리 토큰으로 POST /api/cancelBooking (2026-10-23, 후속 ②a).
 * 잠그는 것: 기존 환불 경로 그대로(선점 · 멱등키 = bookingID · receipt · 전액 증명 · 좌석 해제) +
 *   성공 시 manageTokenVersion +1(같은 링크 재사용 401) · 선점 시점 재확인(회원 귀속/버전 변경 → 409, 환불·쓰기 0) ·
 *   남의/회원 예약 토큰 → 401, 쓰기 0·환불 0. 실제 PayPal·Firestore·메일 없음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';

const refundSpy = vi.fn<(args: any) => Promise<any>>(async () => ({}));
const releaseSpy = vi.fn<(args: any) => Promise<any>>(async () => ({ ok: true, released: true }));
const sendEmailSpy = vi.fn<(args: any) => Promise<any>>(async () => undefined);
const verifyUserTokenSpy = vi.fn<(req: any) => Promise<any>>(async () => ({ ok: false, status: 401, error: 'x' }));
let db: ReturnType<typeof createFakeFirestore>;
let afterBookingRead: (() => void) | null = null;

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (req: any) => verifyUserTokenSpy(req) }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: (args: any) => refundSpy(args) }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ releaseSlotForCanceledOrder: (args: any) => releaseSpy(args) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (args: any) => sendEmailSpy(args) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: 's', html: '', text: '' }) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => x }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  // bookings/{id}.get() 직후 훅 — "접근 검사는 통과했는데 선점 전에 문서가 바뀌었다" 를 만든다.
  initAdminDb: () => ({
    ...db,
    runTransaction: db.runTransaction,
    collection: (name: string) => {
      const col = db.collection(name);
      if (name !== 'bookings') return col;
      return {
        ...col,
        doc: (id: string) => {
          const ref = col.doc(id);
          return { ...ref, get: async () => { const snap = await ref.get(); const hook = afterBookingRead; afterBookingRead = null; if (hook) hook(); return snap; } };
        },
      };
    },
  }),
}));

const { default: handler } = await import('../../api/cancelBooking.js');
const { createBookingManageToken } = await import('../../api/_shared/booking-manage-token.js');

const ID = 'ORD-G1';
const PATH = `bookings/${ID}`;
const guestBooking = (over: Record<string, any> = {}) => ({
  status: 'CONFIRMED', captureID: 'CAP-G1', orderID: ID, productType: 'tour-gyeongbok',
  tourDate: '2099-12-31', tourTime: '10:00', amountUSD: '100.00', amountKRW: 135000, currency: 'USD', paxCount: 2,
  paypalEnvironment: 'live', userEmail: '', payerEmail: 'guest@x.com', language: 'en', bookingRef: 'CT-1', ...over,
});
const receipt = () => ({ ok: true, final: true, httpStatus: 201, refund: { id: 'RF-G1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } });
const tokenFor = (over: Record<string, any> = {}) => createBookingManageToken({
  orderID: ID, version: 0, paypalEnvironment: 'live', deployment: 'production', tourDate: '2099-12-31', ...over,
}).token;

async function cancel(body: Record<string, any>, headers: Record<string, string> = {}) {
  const out = { statusCode: 0, body: '' };
  const res = { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'POST', url: '/api/cancelBooking', headers: { host: 'unit.test', ...headers }, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}

const saved = { VERCEL_ENV: process.env.VERCEL_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV, S: process.env.BOOKING_MANAGE_SIGNING_SECRET };
let consoleSpies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  process.env.BOOKING_MANAGE_SIGNING_SECRET = 'g'.repeat(48);
  refundSpy.mockReset(); refundSpy.mockResolvedValue(receipt());
  releaseSpy.mockClear(); sendEmailSpy.mockClear();
  verifyUserTokenSpy.mockReset(); verifyUserTokenSpy.mockResolvedValue({ ok: false, status: 401, error: 'x' });
  afterBookingRead = null;
  db = createFakeFirestore({ [PATH]: guestBooking() });
  consoleSpies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(() => {
  for (const [k, v] of [['VERCEL_ENV', saved.VERCEL_ENV], ['PAYPAL_ENV', saved.PAYPAL_ENV], ['BOOKING_MANAGE_SIGNING_SECRET', saved.S]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  consoleSpies.forEach((s) => s.mockRestore());
});

describe('guest cancel — existing refund path', () => {
  it('claim → refund (key = bookingID, receipt) → CANCELED + proof + seat release + version +1; the same link is then dead', async () => {
    const manageToken = tokenFor();
    const r = await cancel({ bookingID: ID, reason: 'plans changed', manageToken });
    expect(r.statusCode).toBe(200);
    expect(r.json.data).toMatchObject({ bookingID: ID, status: 'CANCELED', refundPercent: 100 });
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy.mock.calls[0][0]).toMatchObject({ captureID: 'CAP-G1', idempotencyKey: ID, refundUSD: null, receipt: true, isSandbox: false });
    const doc = db.__get(PATH)!;
    expect(doc).toMatchObject({ status: 'CANCELED', refundID: 'RF-G1', refundPercent: 100, manageTokenVersion: 1 });
    expect(doc.fullRefundProof).toMatchObject({ source: 'cancel-api', environment: 'live', refundIDs: ['RF-G1'] });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(verifyUserTokenSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendEmailSpy).toHaveBeenCalledTimes(1));
    expect((sendEmailSpy.mock.calls[0][0] as any).to).toBe('guest@x.com');

    const again = await cancel({ bookingID: ID, manageToken });
    expect(again.statusCode).toBe(401);
    expect(refundSpy).toHaveBeenCalledTimes(1);
  });
});

describe('guest cancel — claim-time re-check (0 refunds, 0 writes)', () => {
  for (const [label, patch] of [
    ['booking became a member booking (uid)', { uid: 'u9' }],
    ['booking got a userEmail', { userEmail: 'm@x.com' }],
    ['manageTokenVersion bumped meanwhile', { manageTokenVersion: 1 }],
  ] as const) {
    it(`${label} → 409, no refund, doc untouched by the handler`, async () => {
      const manageToken = tokenFor();
      afterBookingRead = () => db.__patch(PATH, patch);
      const r = await cancel({ bookingID: ID, manageToken });
      expect(r.statusCode).toBe(409);
      expect(r.json.code).toBe('CANCEL_IN_PROGRESS');
      expect(refundSpy).not.toHaveBeenCalled();
      const doc = db.__get(PATH)!;
      expect(doc.status).toBe('CONFIRMED');
      expect(doc).not.toHaveProperty('cancelClaimedAt');
      expect(releaseSpy).not.toHaveBeenCalled();
    });
  }
});

describe('guest cancel — refused targets (401, 0 writes, 0 refunds)', () => {
  it('a token for another booking id', async () => {
    db.__set('bookings/ORD-OTHER', guestBooking({ orderID: 'ORD-OTHER' }));
    const before = JSON.stringify(db.__dump());
    const r = await cancel({ bookingID: 'ORD-OTHER', manageToken: tokenFor() });
    expect(r.statusCode).toBe(401);
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('a member booking (token minted for its id) and a manual booking', async () => {
    for (const over of [{ uid: 'u1', userEmail: 'm@x.com' }, { userEmail: 'manual@x.com' }]) {
      db.__set(PATH, guestBooking(over));
      const before = JSON.stringify(db.__dump());
      const r = await cancel({ bookingID: ID, manageToken: tokenFor() });
      expect(r.statusCode).toBe(401);
      expect(r.json).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
      expect(JSON.stringify(db.__dump())).toBe(before);
    }
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('an invalid Bearer alongside a valid token does not fall back to guest', async () => {
    const before = JSON.stringify(db.__dump());
    const r = await cancel({ bookingID: ID, manageToken: tokenFor() }, { authorization: 'Bearer bad' });
    expect(r.statusCode).toBe(401);
    expect(JSON.stringify(db.__dump())).toBe(before);
    expect(refundSpy).not.toHaveBeenCalled();
  });
});
