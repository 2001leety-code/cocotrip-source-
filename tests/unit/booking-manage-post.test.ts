/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * POST /api/booking-manage (2026-10-23, 후속 ②a).
 * 잠그는 것: GET 405 · 모든 인증 실패 = 같은 401 · 응답 필드 화이트리스트(전화·capture·결제 id 없음) ·
 *   이메일 마스킹 · canRefund 규칙 · no-store / no-referrer 헤더 · 서명 실패면 Firestore 를 읽지 않음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

let db: ReturnType<typeof createFakeFirestore>;
const captureErrorSpy = vi.fn<(err: any, ctx: any) => Promise<void>>(async () => undefined);
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: (err: any, ctx: any) => captureErrorSpy(err, ctx) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => `Label:${x}` }));

const { default: handler, maskEmail } = await import('../../api/booking-manage.js');
const { createBookingManageToken } = await import('../../api/_shared/booking-manage-token.js');

const ID = 'ORD-M1';
const PATH = `bookings/${ID}`;
const guest = (over: Record<string, any> = {}) => ({
  status: 'CONFIRMED', captureID: 'CAP-SECRET', orderID: ID, productType: 'tour-gyeongbok', bookingRef: 'CT-9',
  tourDate: '2099-12-31', tourTime: '10:00', paxCount: 2, pickupLocation: 'Myeongdong', vehicleType: 'van',
  amountUSD: '100.00', amountKRW: 135000, currency: 'USD', paypalEnvironment: 'live', userEmail: '',
  payerEmail: 'guest.person@example.com', payerPhone: '+82-10-0000-0000', paypalOrderID: 'PP-SECRET', ...over,
});
const tokenFor = (over: Record<string, any> = {}) => createBookingManageToken({
  orderID: ID, version: 0, paypalEnvironment: 'live', deployment: 'production', tourDate: '2099-12-31', ...over,
}).token;

async function call(method: string, body: any) {
  const out = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  const res = { writeHead(c: number, h: Record<string, string>) { out.statusCode = c; out.headers = h || {}; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method, url: '/api/booking-manage', headers: {}, body } as any, res as any);
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}

const saved = { VERCEL_ENV: process.env.VERCEL_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV, S: process.env.BOOKING_MANAGE_SIGNING_SECRET };
beforeEach(() => {
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  process.env.BOOKING_MANAGE_SIGNING_SECRET = 'm'.repeat(48);
  captureErrorSpy.mockClear();
  db = createFakeFirestore({ [PATH]: guest() });
});
afterEach(() => {
  for (const [k, v] of [['VERCEL_ENV', saved.VERCEL_ENV], ['PAYPAL_ENV', saved.PAYPAL_ENV], ['BOOKING_MANAGE_SIGNING_SECRET', saved.S]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('POST /api/booking-manage', () => {
  it('GET → 405', async () => {
    expect((await call('GET', {})).statusCode).toBe(405);
  });

  it('valid token → whitelisted fields only, masked email, no-store + no-referrer', async () => {
    const r = await call('POST', { manageToken: tokenFor() });
    expect(r.statusCode).toBe(200);
    expect(r.headers).toMatchObject({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    expect(Object.keys(r.json.data).sort()).toEqual([
      'amountKRW', 'amountUSD', 'bookingID', 'bookingRef', 'canModify', 'canRefund', 'currency', 'hoursUntilTour',
      'label', 'maskedEmail', 'paxCount', 'pickupLocation', 'productType', 'refundPercent', 'status', 'tourDate', 'tourTime', 'vehicleType',
    ].sort());
    expect(r.json.data).toMatchObject({ bookingID: ID, bookingRef: 'CT-9', label: 'Label:tour-gyeongbok', canRefund: true, canModify: false, refundPercent: 100, maskedEmail: 'gu…＠example.com' });
    expect(r.body).not.toMatch(/CAP-SECRET|PP-SECRET|0000-0000|guest\.person/);
  });

  it('string body is parsed', async () => {
    expect((await call('POST', JSON.stringify({ manageToken: tokenFor() }))).statusCode).toBe(200);
  });

  it('every auth failure is the same 401 body', async () => {
    const cases: Array<[string, () => void, any]> = [
      ['no token', () => {}, {}],
      ['garbage', () => {}, { manageToken: 'abc' }],
      ['tampered', () => {}, { manageToken: `${tokenFor()}x` }],
      ['missing booking', () => db.__delete(PATH), { manageToken: tokenFor() }],
      ['member booking', () => db.__patch(PATH, { uid: 'u1', userEmail: 'm@x.com' }), { manageToken: tokenFor() }],
      ['cart child', () => db.__patch(PATH, { parentOrderID: 'P1' }), { manageToken: tokenFor() }],
      ['old version', () => db.__patch(PATH, { manageTokenVersion: 1 }), { manageToken: tokenFor() }],
      ['env mismatch', () => {}, { manageToken: tokenFor({ paypalEnvironment: 'sandbox' }) }],
      ['preview token', () => {}, { manageToken: tokenFor({ deployment: 'preview' }) }],
    ];
    const bodies = new Set<string>();
    for (const [label, setup, body] of cases) {
      db = createFakeFirestore({ [PATH]: guest() });
      setup();
      const r = await call('POST', body);
      expect(r.statusCode, label).toBe(401);
      bodies.add(r.body);
    }
    expect([...bodies]).toEqual([JSON.stringify({ ok: false, error: 'Authentication required', code: 'AUTH_REQUIRED' })]);
  });

  it('a bad signature never reads Firestore', async () => {
    const reads = db.__stats.reads;
    await call('POST', { manageToken: `${tokenFor()}x` });
    expect(db.__stats.reads).toBe(reads);
  });

  it('canRefund false for non-CONFIRMED / ai-planner / no capture / inside 24h', async () => {
    for (const over of [{ status: 'CANCELED' }, { productType: 'ai-planner-full' }, { captureID: '' }]) {
      db = createFakeFirestore({ [PATH]: guest(over) });
      const r = await call('POST', { manageToken: tokenFor() });
      expect(r.json.data.canRefund).toBe(false);
      expect(r.json.data.refundPercent).toBe(0);
    }
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const kst = new Date(soon.getTime() + 9 * 60 * 60 * 1000);
    const tourDate = kst.toISOString().slice(0, 10);
    const tourTime = kst.toISOString().slice(11, 16);
    db = createFakeFirestore({ [PATH]: guest({ tourDate, tourTime }) });
    const r = await call('POST', { manageToken: tokenFor({ tourDate }) });
    expect(r.json.data.canRefund).toBe(false);
  });

  it('errors go to Sentry with route/method only (no token)', async () => {
    db = { collection: () => { throw new Error('boom'); } } as any;
    const r = await call('POST', { manageToken: tokenFor() });
    expect(r.statusCode).toBe(500);
    expect(captureErrorSpy.mock.calls[0][1]).toEqual({ route: 'booking-manage', method: 'POST' });
  });
});

describe('maskEmail', () => {
  it('first 2 chars + … + fullwidth ＠ + domain', () => {
    expect(maskEmail('ab@x.com')).toBe('ab…＠x.com');
    expect(maskEmail('a@x.com')).toBe('a…＠x.com');
    expect(maskEmail('')).toBe('');
    expect(maskEmail('nope')).toBe('');
  });
});
