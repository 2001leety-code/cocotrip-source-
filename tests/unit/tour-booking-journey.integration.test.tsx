/**
 * Backend reservation journey only: the existing TourBookingDialog component tests
 * cover its UI. This connects capturePaypalOrder → Firestore fake → my-bookings,
 * with real user-auth, authFetch, and slot-capacity code. HTTP/Firebase SDK and
 * notification boundaries are local mocks; no product or network service runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- JS API/FakeFirestore boundary adapters. */
const state = vi.hoisted(() => ({ db: null as any, auth: { currentUser: null as any }, fetches: [] as string[], lastAuthorization: null as string | null }));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => state.db }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{ name: 'synthetic-app' }], initializeApp: () => ({}), cert: (account: any) => account }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (token: string) => {
    if (token !== 'SYNTHETIC_ID_TOKEN') throw new Error('invalid synthetic token');
    return { uid: 'synthetic-user', email: 'guest@example.test', email_verified: true };
  } }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TEST_TIMESTAMP' } }));
vi.mock('@/lib/firebase', () => ({ auth: state.auth }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'synthetic-paypal-token', baseUrl: 'https://paypal.invalid' }),
  resolveIsSandbox: () => true,
}));
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: async () => 1450 }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => ({ ok: true, final: true }) }));

// @ts-expect-error — JavaScript test helper
import { createFakeFirestore } from '../helpers/fake-firestore.js';
// @ts-expect-error — JavaScript API handler
import captureHandler from '../../api/capturePaypalOrder.js';
// @ts-expect-error — JavaScript API handler
import myBookingsHandler from '../../api/my-bookings.js';
import { authFetch } from '../../src/lib/authFetch';

const ORDER_ID = '5O190127TN364715T';
const DATE = '2099-12-24';

function firestoreWithBatch(db: any) {
  return Object.assign(db, {
    batch() {
      const pending: Array<() => Promise<void>> = [];
      return {
        set(ref: any, data: any, options?: any) { pending.push(() => ref.set(data, options)); },
        async commit() { for (const write of pending) await write(); },
      };
    },
  });
}

function mockRes() {
  const out: { status: number; headers?: Record<string, string>; body: any } = { status: 0, body: null };
  return {
    out,
    writeHead(status: number, headers?: Record<string, string>) { out.status = status; out.headers = headers; return this; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; return this; },
  };
}

async function requestMyBookings() {
  const res = await authFetch('/api/my-bookings', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.db = firestoreWithBatch(createFakeFirestore({
    [`paypal_order_snapshots/${ORDER_ID}`]: {
      productType: 'charter_seoul_city', expectedUSD: '200.00', expectedCurrency: 'USD',
      passengers: 2, dateStart: DATE,
      slotBooking: { tourId: 'tour-seoul-city', tourSlotId: 'morning', bookingDate: DATE, slotCapacity: 7, passengers: 2 },
    },
    'tours/tour-seoul-city': { maxPax: 7, slots: [{ id: 'morning', capacity: 7, is_active: true }] },
  }));
  state.auth.currentUser = { getIdToken: async () => 'SYNTHETIC_ID_TOKEN' };
  state.fetches = [];

  // Every HTTP call is intercepted. Unknown URLs reject instead of reaching the network.
  global.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    state.fetches.push(url);
    if (url === '/api/my-bookings') {
      const res = mockRes();
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      state.lastAuthorization = headers.authorization || null;
      await myBookingsHandler({ method: 'GET', url, headers: { ...headers, host: 'localhost' } }, res);
      return { ok: res.out.status === 200, status: res.out.status, json: async () => res.out.body } as Response;
    }
    if (url === `https://paypal.invalid/v2/checkout/orders/${ORDER_ID}/capture`) {
      return {
        ok: true, status: 200,
        json: async () => ({
          id: ORDER_ID, status: 'COMPLETED',
          payer: { email_address: 'guest@example.test', name: { given_name: 'Synthetic', surname: 'Guest' } },
          purchase_units: [{ payments: { captures: [{ id: 'SYNTHETIC-CAPTURE', status: 'COMPLETED', amount: { value: '200.00', currency_code: 'USD' } }] } }],
        }),
      } as Response;
    }
    if (url === 'https://cocotripkr.com/api/booking-processor') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: { outcome: 'completed' } }) } as Response;
    }
    throw new Error(`Blocked unexpected HTTP request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

describe('capture booking → same FakeFirestore → my-bookings', () => {
  it('인증된 합성 주문을 저장하고 슬롯을 확정한 뒤 인증 내역 API가 반환한다', async () => {
    const captureRes = mockRes();
    await captureHandler({
      method: 'POST',
      headers: { authorization: 'Bearer SYNTHETIC_ID_TOKEN' },
      body: {
        orderID: ORDER_ID, product: 'charter_seoul_city', tourDate: DATE,
        pickupLocation: 'Synthetic hotel', paxCount: 2, vehicleType: 'staria',
        customerPhone: '+82 10 1234 5678', memo: 'Synthetic booking', termsAgreed: true,
      },
    }, captureRes);

    expect(captureRes.out.status).toBe(200);
    expect(state.db.__get(`bookings/${ORDER_ID}`)).toMatchObject({
      uid: 'synthetic-user', productType: 'charter_seoul_city', tourDate: DATE,
      status: 'CONFIRMED', termsAgreed: true, paymentVerified: true,
    });
    expect(state.db.__get(`tour_availability/tour-seoul-city/dates/${DATE}`)).toMatchObject({
      slot_bookings: { morning: 2 }, slot_confirmed: { morning: { [ORDER_ID]: { count: 2 } } },
    });

    const listed = await requestMyBookings();
    expect(state.lastAuthorization).toBe('Bearer SYNTHETIC_ID_TOKEN');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.data.bookings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ORDER_ID, productType: 'charter_seoul_city', tourDate: DATE, paxCount: 2 }),
    ]));
    expect(state.fetches).toEqual([
      `https://paypal.invalid/v2/checkout/orders/${ORDER_ID}/capture`,
      'https://cocotripkr.com/api/booking-processor',
      '/api/my-bookings',
    ]);
  });

  it('authFetch의 토큰 누락은 실제 my-bookings 인증 도우미에서 401로 거부한다', async () => {
    state.auth.currentUser = null;
    const listed = await requestMyBookings();
    expect(listed.status).toBe(401);
    expect(listed.body.code).toBe('AUTH_REQUIRED');
  });

  it('캡처 전 저장소 검증이 실패하면 PayPal HTTP 호출과 예약 저장을 하지 않는다', async () => {
    state.db = null;
    const captureRes = mockRes();
    await captureHandler({ method: 'POST', headers: {}, body: { orderID: ORDER_ID } }, captureRes);
    expect(captureRes.out.status).toBe(503);
    expect(captureRes.out.body.code).toBe('ORDER_CHECK_UNAVAILABLE');
    expect(state.fetches).toEqual([]);
  });
});
