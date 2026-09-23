// @vitest-environment jsdom
// Integration regression: real TourBookingDialog, availability helper, and createPaypalOrder;
// external Firebase/PayPal/HTTP edges are sealed.
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { firestore, authUser, serverState, couponFixture } = vi.hoisted(() => ({
  serverState: {
    snapshotWrites: [] as Array<{ path: string; data: Record<string, unknown> }>,
    paypalOrderBodies: [] as Array<Record<string, unknown>>,
    applyPromoBodies: [] as Array<Record<string, unknown>>,
    clientBodies: [] as Array<Record<string, unknown>>,
    mismatchNextExpectedUsd: false,
    orderCounter: 0,
  },
  couponFixture: { current: null as Record<string, unknown> | null },
  firestore: {
    doc: vi.fn((...args: unknown[]) => args),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
    setDoc: vi.fn(async () => undefined),
    onSnapshot: vi.fn((target: unknown, callback: (snapshot: { docs?: Array<{ id: string; data: () => unknown }>; data?: () => undefined }) => void) => {
      const candidate = target as { path?: unknown[]; ref?: { path?: unknown[] } };
      const targetPath = candidate?.path || candidate?.ref?.path || [];
      queueMicrotask(() => callback(targetPath.includes('coupons') && couponFixture.current
        ? { docs: [{ id: 'SYNTHETIC-COUPON', data: () => couponFixture.current }] }
        : { docs: [], data: () => undefined }));
      return vi.fn();
    }),
    collection: vi.fn((...args: unknown[]) => ({ path: args })),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    orderBy: vi.fn(),
    limit: vi.fn(),
    where: vi.fn((field: string, op: string, value: string) => ({ field, op, value })),
    getDocs: vi.fn(async () => ({
      docs: [{ data: () => ({ tourId: 'tour-seoul-night', date: '2030-01-04', status: 'blackout' }) }],
      forEach: (callback: (doc: { data: () => unknown }) => void) => callback({ data: () => ({ tourId: 'tour-seoul-night', date: '2030-01-04', status: 'blackout' }) }),
    })),
  },
  authUser: { current: { uid: 'synthetic-tour-guest', email: 'guest@example.test', getIdToken: async () => 'synthetic-token' } },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (u: unknown) => void) => {
    queueMicrotask(() => callback(authUser.current));
    return vi.fn();
  },
}));
vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { get currentUser() { return authUser.current; } }, signInWithGoogle: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  trackDateSelect: vi.fn(), trackTourBookingStart: vi.fn(), trackTourStep: vi.fn(),
  trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: vi.fn(() => null),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({ collection: (name: string) => ({ doc: (id: string) => ({
    set: async (data: Record<string, unknown>) => { serverState.snapshotWrites.push({ path: `${name}/${id}`, data }); },
    get: async () => ({ exists: false, data: () => ({}) }),
    collection: (nested: string) => ({ doc: (nestedId: string) => ({
      get: async () => ({
        exists: name === 'users' && nested === 'coupons' && nestedId === 'SYNTHETIC-COUPON' && !!couponFixture.current,
        data: () => couponFixture.current || {},
      }),
    }) }),
  }) }) }),
}));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'synthetic-token', baseUrl: 'https://api.sandbox.paypal.com' }),
  resolveIsSandbox: () => true,
}));
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: async () => 1400 }));

import { TOURS } from '../../src/data/tours';
import { getTourPriceKRW, getTourProductType } from '../../src/data/tours';
import { charterUsdFromKrw } from '../../src/lib/charterUsd';
import { LanguageProvider } from '../../src/hooks/useLanguage';

const { TourBookingDialog } = await vi.importActual<{
  TourBookingDialog: React.ComponentType<{ tour: (typeof TOURS)[number]; language: 'en'; trigger: React.ReactNode }>;
}>('../../src/components/tours/TourBookingDialog');
const { PayPalBookingButton } = await vi.importActual<{
  PayPalBookingButton: React.ComponentType<{ productType: string; passengers: number; priceKRW: number; expectedUSD: number; lang: string }>;
}>('../../src/components/PayPalBookingButton');

const tour = TOURS.find((item) => item.id === 'tour-seoul-night')!;
const { default: createPaypalOrder } = await import('../../api/createPaypalOrder.js');
let requestHandler: (url: string, init?: RequestInit) => Promise<Response>;
let paypalButtons: ReturnType<typeof vi.fn>;

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return {
    out,
    writeHead(code: number) { out.statusCode = code; },
    end(body?: string) { out.body = body || ''; },
  };
}

async function callServerWithUiBody(body: Record<string, unknown>) {
  const res = mockRes();
  await createPaypalOrder({ method: 'POST', headers: {}, body }, res);
  return res.out;
}

async function runActualCreateHandlerWithBody(body: Record<string, unknown>) {
  const actualBody = { ...body };
  serverState.clientBodies.push(actualBody);
  if (serverState.mismatchNextExpectedUsd) {
    serverState.mismatchNextExpectedUsd = false;
    actualBody.expectedUSD = Number(actualBody.expectedUSD) + 1;
  }
  const out = await callServerWithUiBody(actualBody);
  return new Response(out.body, { status: out.statusCode });
}

function renderDialog(tourToRender = tour) {
  return render(
    <MemoryRouter initialEntries={[`/tours/${tourToRender.slug}`]}>
      <LanguageProvider scope="customer">
        <TourBookingDialog tour={tourToRender} language="en" trigger={<button type="button">Open booking</button>} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function openDialog(tourToRender = tour) {
  const view = renderDialog(tourToRender);
  fireEvent.click(view.getByRole('button', { name: 'Open booking' }));
  return view;
}

async function getOrderButton() {
  return await waitFor(() => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.cocotrip-mobile-paypal button'))
      .find((candidate) => (candidate.textContent || '').includes('USD')) || null;
    expect(button).not.toBeNull();
    return button!;
  });
}

function fillActualRequiredFields(view: ReturnType<typeof render>, includeTerms = true) {
  fireEvent.change(document.querySelector('input[inputmode="tel"]')!, { target: { value: '1012345678' } });
  fireEvent.change(view.getByPlaceholderText('e.g. L7 Myeongdong by Lotte (137 Toegye-ro)'), { target: { value: 'L7 Myeongdong' } });
  fireEvent.change(view.getByPlaceholderText('Messenger ID or number'), { target: { value: 'synthetic-wa-id' } });
  fireEvent.change(view.getByPlaceholderText('e.g. child seat needed, Korean-speaking driver, specific pickup time…'), { target: { value: 'synthetic request' } });
  if (includeTerms) fireEvent.click(view.getByLabelText('I agree to all items below'));
}

function chooseCalendarDate(view: ReturnType<typeof render>, verifyBlackout = true) {
  fireEvent.click(view.getByRole('button', { name: 'Select date' }));
  const dayButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="calendar"] button[data-day]'));
  if (verifyBlackout) {
    const blackoutDate = dayButtons.find((button) => {
      const date = new Date(button.dataset.day || '');
      return date.getFullYear() === 2030 && date.getMonth() === 0 && date.getDate() === 4;
    });
    expect(blackoutDate, 'January 4, 2030 calendar day').toBeTruthy();
    expect(blackoutDate!.disabled).toBe(true);
  }
  const target = dayButtons.find((button) => {
    const date = new Date(button.dataset.day || '');
    return !button.disabled && date.getFullYear() === 2030 && date.getMonth() === 0 && date.getDate() === 5;
  });
  expect(target, 'January 5, 2030 calendar day').toBeTruthy();
  fireEvent.click(target!);
}

beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'false');
  vi.stubEnv('FEATURE_DISCOUNT_V2', 'false');
  vi.setSystemTime(new Date('2030-01-01T12:00:00'));
  paypalButtons = vi.fn(() => ({ render: vi.fn(), isEligible: () => true }));
  Object.defineProperty(window, 'paypal', { configurable: true, value: { Buttons: paypalButtons, FUNDING: {} } });
  serverState.snapshotWrites.length = 0;
  serverState.paypalOrderBodies.length = 0;
  serverState.applyPromoBodies.length = 0;
  serverState.clientBodies.length = 0;
  serverState.mismatchNextExpectedUsd = false;
  serverState.orderCounter = 0;
  couponFixture.current = null;
  requestHandler = async (url, init) => {
    if (url !== '/api/createPaypalOrder') throw new Error(`Blocked unexpected browser URL: ${url}`);
    const body = JSON.parse(String(init?.body));
    return await runActualCreateHandlerWithBody(body);
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/applyPromoCode') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      serverState.applyPromoBodies.push(body);
      const originalPrice = Number(body.originalPrice);
      const discountedPrice = Math.round(originalPrice * 0.95);
      return new Response(JSON.stringify({ ok: true, data: {
        valid: true, discountedPrice, savedAmount: originalPrice - discountedPrice,
        discountRate: 0.05, couponDocId: 'SYNTHETIC-COUPON', userId: 'synthetic-tour-guest',
      } }), { status: 200 });
    }
    if (url === '/api/createPaypalOrder') return await requestHandler(url, init);
    if (url === 'https://api.sandbox.paypal.com/v2/checkout/orders') {
      serverState.paypalOrderBodies.push(JSON.parse(String(init?.body)));
      const id = `SYNTHETIC-PRICE-${serverState.orderCounter++}`;
      return new Response(JSON.stringify({ id, status: 'CREATED' }), { status: 201 });
    }
    throw new Error(`Blocked unexpected outbound URL: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  delete (window as Window & { paypal?: unknown }).paypal;
  firestore.getDoc.mockClear();
  firestore.setDoc.mockClear();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('tour booking UI → actual createPaypalOrder pricing', () => {
  it('keeps checkout unavailable until the real contact and terms/privacy inputs are complete', async () => {
    const view = openDialog();
    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    chooseCalendarDate(view);
    fireEvent.click(view.getByRole('button', { name: 'Continue to payment' }));
    fillActualRequiredFields(view, false);
    expect(view.getByRole('button', { name: 'Please fill in all required fields' }).hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('.cocotrip-mobile-paypal button')).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('hides the coupon picker on AI planner checkout even when discount v2 and a charter coupon are available', async () => {
    vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
    couponFixture.current = {
      code: 'SYNTHETIC5', type: 'percent', value: 5, currency: 'USD',
      label: 'Synthetic tour discount', productScope: 'charter', isUsed: false,
      expiresAt: 2_000_000_000_000, minOrderUSD: 0,
    };
    const view = render(
      <MemoryRouter>
        <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={13_500} expectedUSD={10} lang="en" />
      </MemoryRouter>,
    );
    expect(view.queryByRole('button', { name: /use a coupon/i })).toBeNull();
  });

  it('compares the actual two-person displayed total with the handler-generated PayPal order', async () => {
    firestore.getDocs.mockClear();
    const view = openDialog();
    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    expect(firestore.query).toHaveBeenCalledWith(
      { path: [{}, 'tour_availability', 'tour-seoul-night', 'dates'] },
      { field: 'date', op: '>=', value: '2030-01-01' },
      { field: 'date', op: '<=', value: '2030-01-31' },
    );
    chooseCalendarDate(view);
    expect(view.getByText('2030-01-05')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Continue to payment' }));
    fillActualRequiredFields(view);
    const orderButton = await getOrderButton();
    await waitFor(() => expect(orderButton.disabled).toBe(false));
    act(() => { orderButton.click(); orderButton.click(); });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/createPaypalOrder');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      productType: 'tour_seoul_night', passengers: 2,
      dateStart: '2030-01-05', dateEnd: '2030-01-05',
      language: 'en', userEmail: 'guest@example.test', pickupTime: '09:00', termsAgreed: true,
    });
    await waitFor(() => expect(document.querySelector('[id^="paypal-btn-"]')).not.toBeNull());
    expect(view.queryAllByText(/₩132,300/).length).toBeGreaterThan(0);
    expect(view.queryAllByText('$98 USD').length).toBeGreaterThan(0);
    expect((body as Record<string, unknown>).expectedUSD).toBe(98);
    expect((body as Record<string, unknown>).options).toBeUndefined();
    expect((body as Record<string, unknown>).promoCode).toBeUndefined();
    expect(process.env.FEATURE_DISCOUNT_V2).toBe('false');
    const snapshot = serverState.snapshotWrites.find((entry) => entry.path === 'paypal_order_snapshots/SYNTHETIC-PRICE-0');
    expect(snapshot).toBeTruthy();
    expect(snapshot!.data.expectedKRW).toBe(132300);
    expect(snapshot!.data.expectedUSD).toBe('98.00');
    expect(snapshot!.data.productType).toBe('tour_seoul_night');
    expect(serverState.paypalOrderBodies).toHaveLength(1);
    expect(serverState.paypalOrderBodies[0]).toMatchObject({
      intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '98.00' } }],
    });
    expect(vi.mocked(fetch).mock.calls.map(([calledUrl]) => String(calledUrl))).toEqual([
      '/api/createPaypalOrder', 'https://api.sandbox.paypal.com/v2/checkout/orders',
    ]);
    expect(paypalButtons).toHaveBeenCalledTimes(1); // SDK is mocked; no checkout/capture callback is run.
    expect(serverState.clientBodies).toHaveLength(1); // two native clicks in one event loop make one request.
  });

  it('runs the private group tour through the actual booking UI and actual create-order handler', async () => {
    const privateTour = TOURS.find((item) => item.id === 'tour-seoul-city')!;
    const view = openDialog(privateTour);
    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    chooseCalendarDate(view, false);
    fireEvent.click(view.getByRole('button', { name: 'Continue to payment' }));
    fillActualRequiredFields(view);
    const orderButton = await getOrderButton();
    await waitFor(() => expect(orderButton.disabled).toBe(false));
    expect(view.queryAllByText(/₩337,500/).length).toBeGreaterThan(0);
    expect(view.queryAllByText('$250 USD').length).toBeGreaterThan(0);
    fireEvent.click(orderButton);
    await waitFor(() => expect(document.querySelector('[id^="paypal-btn-"]')).not.toBeNull());

    const uiCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/createPaypalOrder');
    expect(uiCall).toBeTruthy();
    const body = JSON.parse(String(uiCall![1]?.body));
    expect(body).toMatchObject({ productType: 'charter_seoul_city', passengers: 2, pickupTime: '09:00' });
    expect(body.expectedUSD).toBe(250);
    expect(serverState.snapshotWrites).toHaveLength(1);
    expect(serverState.snapshotWrites[0].data).toMatchObject({ expectedKRW: 337500, expectedUSD: '250.00' });
    expect(serverState.paypalOrderBodies[0].purchase_units).toEqual([
      expect.objectContaining({ amount: { currency_code: 'USD', value: '250.00' } }),
    ]);
  });

  it('applies an eligible night-tour coupon in the actual UI and sends the discounted expected USD to the real handler', async () => {
    vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
    vi.stubEnv('FEATURE_DISCOUNT_V2', 'true');
    couponFixture.current = {
      code: 'SYNTHETIC5', type: 'percent', value: 5, currency: 'USD',
      label: 'Synthetic tour discount', productScope: 'charter', isUsed: false,
      expiresAt: 2_000_000_000_000, minOrderUSD: 0,
    };

    const view = openDialog();
    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    chooseCalendarDate(view);
    fireEvent.click(view.getByRole('button', { name: 'Continue to payment' }));
    fillActualRequiredFields(view);
    fireEvent.click(view.getByRole('button', { name: /use a coupon/i }));
    fireEvent.click(await view.findByRole('button', { name: /synthetic tour discount/i }));
    await waitFor(() => expect(serverState.applyPromoBodies).toHaveLength(1));
    const orderButton = await getOrderButton();
    await waitFor(() => expect(orderButton.disabled).toBe(false));
    expect(view.getByText('$93 USD')).toBeTruthy();
    fireEvent.click(orderButton);
    await waitFor(() => expect(document.querySelector('[id^="paypal-btn-"]')).not.toBeNull());

    expect(serverState.applyPromoBodies[0]).toMatchObject({
      code: 'SYNTHETIC5', productType: 'tour_seoul_night', originalPrice: 132_300,
    });
    const createCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/createPaypalOrder');
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall![1]?.body));
    expect(body).toMatchObject({
      productType: 'tour_seoul_night', passengers: 2, expectedUSD: 93,
      promoCode: 'SYNTHETIC5', discountedPrice: 125_685,
      couponDocId: 'SYNTHETIC-COUPON', couponUserId: 'synthetic-tour-guest',
    });
    expect(serverState.snapshotWrites[0].data).toMatchObject({ expectedKRW: 125_685, expectedUSD: '93.00' });
    expect(serverState.paypalOrderBodies[0].purchase_units).toEqual([
      expect.objectContaining({ amount: { currency_code: 'USD', value: '93.00' } }),
    ]);
  });

  it('releases the synchronous click lock after an actual 409 amount mismatch so a corrected retry succeeds', async () => {
    const view = openDialog();
    await waitFor(() => expect(firestore.getDocs).toHaveBeenCalled());
    chooseCalendarDate(view);
    fireEvent.click(view.getByRole('button', { name: 'Continue to payment' }));
    fillActualRequiredFields(view);
    const orderButton = await getOrderButton();
    await waitFor(() => expect(orderButton.disabled).toBe(false));

    serverState.mismatchNextExpectedUsd = true;
    fireEvent.click(orderButton);
    await waitFor(() => expect(view.getByText(/표시 금액과 청구 금액이 다릅니다/)).toBeTruthy());
    expect(serverState.clientBodies).toHaveLength(1);
    expect(serverState.snapshotWrites).toHaveLength(0);
    expect(serverState.paypalOrderBodies).toHaveLength(0);

    const retryButton = await getOrderButton();
    await waitFor(() => expect(retryButton.disabled).toBe(false));
    fireEvent.click(retryButton);
    await waitFor(() => expect(document.querySelector('[id^="paypal-btn-"]')).not.toBeNull());
    expect(serverState.clientBodies).toHaveLength(2);
    expect(serverState.snapshotWrites).toHaveLength(1);
    expect(serverState.paypalOrderBodies).toHaveLength(1);
  });

  it('matches server snapshots and PayPal amounts for every mapped catalog SKU at pax 1/2/4', async () => {
    const paxValues = [1, 2, 4];
    let mappedCases = 0;
    for (const item of TOURS) {
      const productType = getTourProductType(item.id);
      const priceUnit = item.priceUnit || 'group';
      const clientUnitKRW = getTourPriceKRW(item.id, item.priceFrom, item.priceUnit);
      for (const passengers of paxValues) {
        const uiKRW = priceUnit === 'per_person' ? clientUnitKRW * passengers : clientUnitKRW;
        const uiUSD = charterUsdFromKrw(uiKRW);
        if (!productType) {
          expect(item.id).toBe('tour-multicity-3d');
          continue;
        }
        const response = mockRes();
        await createPaypalOrder({
          method: 'POST', headers: {}, body: {
            productType, passengers, dateStart: '2030-01-05', dateEnd: '2030-01-05',
            pickupTime: '09:00', durationDays: item.durationDays, language: 'en',
            userEmail: 'guest@example.test', expectedUSD: uiUSD,
          },
        }, response);
        expect(response.out.statusCode, `${item.id} pax ${passengers}: ${response.out.body}`).toBe(200);
        const snapshot = serverState.snapshotWrites.at(-1);
        expect(snapshot).toBeTruthy();
        const serverKRW = Number(snapshot!.data.expectedKRW);
        const serverUSD = String(snapshot!.data.expectedUSD);
        const paypalBody = serverState.paypalOrderBodies.at(-1) as {
          purchase_units?: Array<{ amount?: { value?: string } }>;
        };
        const orderUSD = String(paypalBody?.purchase_units?.[0]?.amount?.value);
        expect(serverKRW, `${item.id} pax ${passengers} KRW`).toBe(uiKRW);
        expect(serverUSD, `${item.id} pax ${passengers} server USD`).toBe(uiUSD.toFixed(2));
        expect(orderUSD, `${item.id} pax ${passengers} PayPal USD`).toBe(uiUSD.toFixed(2));
        mappedCases += 1;
      }
    }
    expect(TOURS).toHaveLength(9);
    expect(mappedCases).toBe(24);
    expect(serverState.paypalOrderBodies).toHaveLength(24);
  });
});
