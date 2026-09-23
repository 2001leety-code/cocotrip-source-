import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null, calls: [], charged: '', captureOverride: null }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => state.db }));
vi.mock('firebase-admin/firestore', async () => {
  const { FieldValue } = await import('../../tests/helpers/fake-firestore.js');
  return { FieldValue };
});
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'synthetic', baseUrl: 'https://paypal.invalid' }),
  resolveIsSandbox: () => true,
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
import { createFakeFirestore } from '../../tests/helpers/fake-firestore.js';
import createCartOrder from '../../api/createCartOrder.js';
import captureCartOrder from '../../api/captureCartOrder.js';

const ORDER = 'SYNTHETICCART001';
function response() {
  const out = { status: 0, json: null };
  return { out, writeHead(status) { out.status = status; }, end(body) { out.json = body ? JSON.parse(body) : null; } };
}
async function call(handler, body) {
  const res = response();
  await handler({ method: 'POST', headers: {}, body }, res);
  return res.out;
}
const item = (id) => ({ id, productType: 'charter_seoul_city', priceKRW: 330000, displayName: 'Synthetic private tour', booking: { productType: 'charter_seoul_city', passengers: 2, dateStart: '2030-01-05', dateEnd: '2030-01-05', pickupTime: '09:00' } });

beforeEach(() => {
  vi.stubEnv('FEATURE_CART', 'true');
  vi.stubEnv('FEATURE_DISCOUNT_V2', 'false');
  state.db = createFakeFirestore();
  state.db.batch = () => {
    const writes = [];
    return { set(ref, data, options) { writes.push(() => ref.set(data, options)); }, async commit() { for (const write of writes) await write(); } };
  };
  state.calls = []; state.charged = ''; state.captureOverride = null;
  vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
    const url = String(input); state.calls.push(url);
    if (url === 'https://paypal.invalid/v2/checkout/orders') {
      state.charged = JSON.parse(init.body).purchase_units[0].amount.value;
      return new Response(JSON.stringify({ id: ORDER, status: 'CREATED' }), { status: 201 });
    }
    if (url === `https://paypal.invalid/v2/checkout/orders/${ORDER}/capture`) {
      return new Response(JSON.stringify({ id: ORDER, status: 'COMPLETED', payer: { email_address: 'guest@example.invalid', name: { given_name: 'Synthetic' } }, purchase_units: [{ payments: { captures: [{ id: 'CAP-SYNTHETIC', status: 'COMPLETED', amount: { value: state.captureOverride || state.charged, currency_code: 'USD' } }] } }] }), { status: 200 });
    }
    if (url === 'https://cocotripkr.com/api/booking-processor') return new Response(JSON.stringify({ ok: true, data: { outcome: 'completed' } }), { status: 200 });
    throw new Error(`Blocked unexpected boundary: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([1, 2])('keeps the captured USD equal to the %i private-tour booking amounts', async (count) => {
  const created = await call(createCartOrder, { items: Array.from({ length: count }, (_, i) => item(`item-${i}`)), userEmail: 'guest@example.invalid' });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const captured = await call(captureCartOrder, { orderID: ORDER, userEmail: 'guest@example.invalid' });
  expect(captured.status, JSON.stringify(captured.json)).toBe(200);
  const children = Array.from({ length: count }, (_, i) => state.db.__get(`bookings/${ORDER}__L${i}`));
  const childCents = children.reduce((total, row) => total + Math.round(Number(row.amountUSD) * 100), 0);
  const capturedCents = Math.round(Number(state.charged) * 100);
  expect(capturedCents).toBe(count * 25000);
  expect(childCents).toBe(capturedCents);
  expect(children.every(row => row.amountUSD === '250.00')).toBe(true);
  expect(children.every(row => row.capturedExchangeRate === 1350)).toBe(true);
  const repeated = await call(captureCartOrder, { orderID: ORDER });
  expect(repeated.status).toBe(409);
  expect(state.calls.filter(url => url.endsWith('/capture'))).toHaveLength(1);
});

it('rejects a one-cent capture mismatch before confirmed child bookings or fulfillment', async () => {
  expect((await call(createCartOrder, { items: [item('a')] })).status).toBe(200);
  state.captureOverride = '249.99';
  const result = await call(captureCartOrder, { orderID: ORDER });
  expect(result.status, JSON.stringify(result.json)).toBe(202);
  expect(result.json).toMatchObject({ ok: true, finalized: false, retryable: false, paymentCaptured: true, bookingStatus: 'PAYMENT_REVIEW' });
  expect(state.db.__get(`bookings/${ORDER}__L0`)).toBeUndefined();
  expect(state.calls.some(url => url.endsWith('/api/booking-processor'))).toBe(false);
});

it('refuses cart checkout when the feature is disabled', async () => {
  vi.stubEnv('FEATURE_CART', 'false');
  const result = await call(createCartOrder, { items: [item('a')] });
  expect(result.status).toBe(404);
  expect(state.calls).toEqual([]);
});

it('derives private-charter night surcharge from pickup time even when the client omits it', async () => {
  const nightPickup = item('private-night');
  nightPickup.booking.pickupTime = '23:00';
  const created = await call(createCartOrder, { items: [nightPickup] });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  expect(created.json.data.usdAmount).toBe('300.00');
});

it('charges a mixed private and two-person night cart using each product price', async () => {
  const night = { ...item('night'), productType: 'tour_seoul_night', booking: { ...item('night').booking, productType: 'tour_seoul_night' } };
  const created = await call(createCartOrder, { items: [item('private'), night] });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  expect(created.json.data.usdAmount).toBe('348.00');
  expect((await call(captureCartOrder, { orderID: ORDER })).status).toBe(200);
  expect(state.db.__get(`bookings/${ORDER}__L0`).amountUSD).toBe('250.00');
  expect(state.db.__get(`bookings/${ORDER}__L1`).amountUSD).toBe('98.00');
});

it('includes the verified session modifier and preserves that amount after capture', async () => {
  await state.db.doc('tours/tour-seoul-night').set({
    maxPax: 8, slots: [{ id: 'evening', is_active: true, capacity: 8, price_modifier_krw: 13500 }],
  });
  const night = {
    ...item('night'), productType: 'tour_seoul_night',
    booking: { ...item('night').booking, productType: 'tour_seoul_night', tourId: 'tour-seoul-night',
      tourSlotId: 'evening', bookingDate: '2030-01-05', slotCapacity: 999 },
  };
  const created = await call(createCartOrder, { items: [night] });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  expect(created.json.data.usdAmount).toBe('108.00');
  expect(state.db.__get(`cart_orders/${ORDER}`).lines[0].booking.slotCapacity).toBe(8);
  expect((await call(captureCartOrder, { orderID: ORDER })).status).toBe(200);
  expect(state.db.__get(`bookings/${ORDER}__L0`).amountUSD).toBe('108.00');
});

it('applies a private session modifier before the pickup-time surcharge, like single checkout', async () => {
  await state.db.doc('tours/tour-seoul-city').set({
    maxPax: 8, slots: [{ id: 'late', is_active: true, capacity: 8, price_modifier_krw: 13500 }],
  });
  const late = { ...item('late'), booking: { ...item('late').booking, pickupTime: '23:00',
    tourId: 'tour-seoul-city', tourSlotId: 'late', bookingDate: '2030-01-05', slotCapacity: 8 } };
  const created = await call(createCartOrder, { items: [late] });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  expect(created.json.data.usdAmount).toBe('312.00');
});

it('blocks an unavailable slot store before creating a PayPal order', async () => {
  state.db = null;
  const selected = { ...item('selected'), booking: { ...item('selected').booking,
    tourId: 'tour-seoul-city', tourSlotId: 'late', bookingDate: '2030-01-05', slotCapacity: 8 } };
  const created = await call(createCartOrder, { items: [selected] });
  expect(created.status).toBe(503);
  expect(state.calls).toEqual([]);
});

it('blocks a corrupt stored cart total before any PayPal capture', async () => {
  expect((await call(createCartOrder, { items: [item('a')] })).status).toBe(200);
  await state.db.collection('cart_orders').doc(ORDER).set({ usdAmount: '1.00' }, { merge: true });
  const result = await call(captureCartOrder, { orderID: ORDER });
  expect(result.status).toBe(409);
  expect(result.json.code).toBe('INVALID_CART_AMOUNTS');
  expect(state.calls.some(url => url.endsWith('/capture'))).toBe(false);
});

it('keeps an older cart total and allocates its rounding difference exactly', async () => {
  await state.db.collection('cart_orders').doc(ORDER).set({
    usdAmount: '471.00', usdRate: 1400, totalKRW: 660000,
    lines: [0, 1].map(index => ({ lineId: `L${index}`, productType: 'charter_seoul_city', amountKRW: 330000, booking: item(String(index)).booking })),
  });
  state.charged = '471.00';
  expect((await call(captureCartOrder, { orderID: ORDER })).status).toBe(200);
  expect(state.db.__get(`bookings/${ORDER}__L0`).amountUSD).toBe('235.50');
  expect(state.db.__get(`bookings/${ORDER}__L1`).amountUSD).toBe('235.50');
  expect(state.db.__get(`bookings/${ORDER}__L0`).capturedExchangeRate).toBe(1400);
});
