/* eslint-disable @typescript-eslint/no-explicit-any -- 요청/예약 모킹 스캐폴딩. */
/**
 * resolveBookingAccess (api/_shared/booking-access.js, 2026-10-23 후속 ②a).
 * 잠그는 것: 회원 경로 불변 · 잘못된 Bearer 도 게스트로 넘어가지 않음 · 게스트 관리 대상이 아닌 예약
 *   (회원·수동·cart 자식·결제자 이메일 없음)과 없는 예약은 같은 401 · 게스트 성공 시 검증된 버전 반환 ·
 *   환경 삼자(토큰=예약=배포)·배포 불일치 401 · 서명 실패면 문서를 읽지 않음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyUserTokenMock = vi.fn<(req: any) => Promise<any>>(async () => ({ ok: false, status: 401, error: 'x' }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (req: any) => verifyUserTokenMock(req) }));

const { resolveBookingAccess, isGuestManagedBooking, AUTH_REQUIRED_MESSAGE } = await import('../../api/_shared/booking-access.js');
const { createBookingManageToken } = await import('../../api/_shared/booking-manage-token.js');

const AUTH_401 = { ok: false, status: 401, code: 'AUTH_REQUIRED', error: AUTH_REQUIRED_MESSAGE };
const GUEST = { status: 'CONFIRMED', uid: null, userEmail: '', payerEmail: 'guest@x.com', paypalEnvironment: 'live', tourDate: '2099-01-01' };
const saved = { VERCEL_ENV: process.env.VERCEL_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV, S: process.env.BOOKING_MANAGE_SIGNING_SECRET };

function token(over: Record<string, unknown> = {}) {
  return createBookingManageToken({
    orderID: 'ORD-1', version: 0, paypalEnvironment: 'live', deployment: 'production', tourDate: '2099-01-01', ...over,
  }).token;
}
const req = (auth?: string) => ({ headers: auth ? { authorization: auth } : {} });

async function access({ auth, body, booking, bookingID = 'ORD-1' }: { auth?: string; body?: any; booking?: any }) {
  const loadBooking = vi.fn(async () => (booking === undefined ? null : booking));
  const result = await resolveBookingAccess({ req: req(auth), body: body || {}, bookingID, loadBooking });
  return { result, loadBooking };
}

beforeEach(() => {
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  process.env.BOOKING_MANAGE_SIGNING_SECRET = 'k'.repeat(48);
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue({ ok: false, status: 401, error: 'x' });
});
afterEach(() => {
  for (const [k, v] of [['VERCEL_ENV', saved.VERCEL_ENV], ['PAYPAL_ENV', saved.PAYPAL_ENV], ['BOOKING_MANAGE_SIGNING_SECRET', saved.S]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('isGuestManagedBooking', () => {
  it('only non-member, payer-email, non-cart-child bookings', () => {
    expect(isGuestManagedBooking(GUEST)).toBe(true);
    expect(isGuestManagedBooking({ ...GUEST, uid: 'u1' })).toBe(false);
    expect(isGuestManagedBooking({ ...GUEST, userEmail: 'm@x.com' })).toBe(false);   // member / manual booking
    expect(isGuestManagedBooking({ ...GUEST, payerEmail: '' })).toBe(false);
    expect(isGuestManagedBooking({ ...GUEST, parentOrderID: 'P1' })).toBe(false);     // cart child
    expect(isGuestManagedBooking(null)).toBe(false);
  });
});

describe('member path (unchanged)', () => {
  it('valid Bearer + owner email → member actor', async () => {
    verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'M@x.com', uid: 'u1' });
    const { result } = await access({ auth: 'Bearer t', booking: { ...GUEST, userEmail: 'm@x.com', uid: 'u1' } });
    expect(result).toMatchObject({ ok: true, actor: { type: 'member', email: 'M@x.com', uid: 'u1' } });
  });

  it('another member\'s booking → 403; missing booking → 404', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, email: 'a@x.com', uid: 'a' });
    expect((await access({ auth: 'Bearer t', booking: { ...GUEST, userEmail: 'b@x.com' } })).result).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect((await access({ auth: 'Bearer t' })).result).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' });
  });

  it('🔴 invalid Bearer → 401 even with a valid manageToken (no guest fallback), booking not loaded', async () => {
    const { result, loadBooking } = await access({ auth: 'Bearer bad', body: { manageToken: token() }, booking: GUEST });
    expect(result).toEqual(AUTH_401);
    expect(loadBooking).not.toHaveBeenCalled();
  });
});

describe('guest path', () => {
  it('valid token → guest actor with the verified version', async () => {
    const { result } = await access({ body: { manageToken: token({ version: 3 }) }, booking: { ...GUEST, manageTokenVersion: 3 } });
    expect(result).toMatchObject({ ok: true, actor: { type: 'guest', email: 'guest@x.com', tokenVersion: 3 } });
    expect(verifyUserTokenMock).not.toHaveBeenCalled();
  });

  it('no header and no token → 401', async () => {
    expect((await access({ booking: GUEST })).result).toEqual(AUTH_401);
  });

  it('bad signature / other order id → 401 before any Firestore read', async () => {
    const t = token();
    for (const manageToken of [`${t}x`, 'garbage', token({ orderID: 'ORD-2' })]) {
      const { result, loadBooking } = await access({ body: { manageToken }, booking: GUEST });
      expect(result).toEqual(AUTH_401);
      expect(loadBooking).not.toHaveBeenCalled();
    }
  });

  it('member / manual / cart-child / no-payerEmail / missing bookings → identical 401', async () => {
    const cases = [
      { ...GUEST, uid: 'u1' },
      { ...GUEST, userEmail: 'manual@x.com' },
      { ...GUEST, parentOrderID: 'P1' },
      { ...GUEST, payerEmail: '' },
      undefined,
    ];
    for (const booking of cases) {
      expect((await access({ body: { manageToken: token() }, booking })).result).toEqual(AUTH_401);
    }
  });

  it('version mismatch (link from before a cancel) → 401', async () => {
    expect((await access({ body: { manageToken: token({ version: 0 }) }, booking: { ...GUEST, manageTokenVersion: 1 } })).result).toEqual(AUTH_401);
  });

  it('environment three-way mismatch → 401', async () => {
    // token sandbox, booking live
    expect((await access({ body: { manageToken: token({ paypalEnvironment: 'sandbox' }) }, booking: GUEST })).result).toEqual(AUTH_401);
    // token + booking sandbox, but this deployment is live (production)
    expect((await access({ body: { manageToken: token({ paypalEnvironment: 'sandbox' }) }, booking: { ...GUEST, paypalEnvironment: 'sandbox' } })).result).toEqual(AUTH_401);
    // token + booking live, deployment sandbox
    process.env.VERCEL_ENV = 'preview';
    process.env.PAYPAL_ENV = 'sandbox';
    expect((await access({ body: { manageToken: token({ deployment: 'preview' }) }, booking: GUEST })).result).toEqual(AUTH_401);
  });

  it('deployment mismatch (preview token on production) → 401', async () => {
    expect((await access({ body: { manageToken: token({ deployment: 'preview' }) }, booking: GUEST })).result).toEqual(AUTH_401);
  });
});
