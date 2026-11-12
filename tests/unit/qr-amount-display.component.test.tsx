// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import { AI_PLANNER_FULL_USD, AI_PLANNER_REFERENCE_KRW } from '../../src/lib/aiPlannerPrice';
import { charterUsdFromKrw } from '../../src/lib/charterUsd';
import type { Coupon } from '../../src/hooks/useLoyalty';

const fixture = vi.hoisted(() => ({ coupons: [] as Coupon[], language: 'en', user: null as { uid: string; email: string; getIdToken?: () => Promise<string> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({
  activeCoupons: fixture.coupons, loading: false, coinsToUSD: () => '0.00',
  loyalty: { tier: 'Bronze', tripCoins: 0, earnRate: 0.01, totalSpentUSD: 0, bookingCount: 0 },
}) }));
vi.mock('@/hooks/useGuestSignup', () => ({ useGuestSignup: () => ({}) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: fixture.language, t: en }) }));
vi.mock('@/lib/firebase-auth', () => ({ auth: { currentUser: null } }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,test') } }));

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import QRCode from 'qrcode';
import { LoyaltyBadge } from '../../src/components/LoyaltyBadge';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fixture.coupons = [];
  fixture.language = 'en';
  fixture.user = null;
  localStorage.clear();
  vi.stubEnv('VITE_PAYPAL_ENV', 'sandbox');
  vi.stubEnv('VITE_PAYPAL_SANDBOX_CLIENT_ID', '');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-test');
  // A different display rate must never change the checkout amount.
  vi.stubEnv('VITE_USD_KRW_RATE', '1380');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: {} }) });
});

it('localizes the checkout picker and membership coupons, keeps free AI coupons out of the discount picker', async () => {
  fixture.language = 'ko';
  fixture.user = { uid: 'offline-guest', email: 'guest@example.test' };
  const coupon: Coupon = {
    id: 'charter', code: 'WELCOME-CHARTER', type: 'percent', value: 5, currency: 'USD',
    source: 'onboarding', productScope: 'charter', label: 'Welcome 5% off Charter',
    minOrderUSD: 0, isUsed: false, expiresAt: Date.UTC(2099, 0, 1), createdAt: 0,
  };
  fixture.coupons = [
    coupon,
    { ...coupon, id: 'ai', code: 'WELCOME-AI', type: 'free', value: 100, productScope: 'ai-plan', maxDays: 3, label: 'Welcome — Free AI Plan (1~3 days)' },
    { ...coupon, id: 'custom', code: 'CUSTOM', type: 'free', value: 100, source: 'custom', label: 'Custom coupon' },
  ];
  vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
  const view = render(<MemoryRouter>
    <section aria-label="checkout"><PayPalBookingButton productType="airport_seoul_central" passengers={1} priceKRW={124800}
      expectedUSD={92} lang="ko" p={{ paypalBookBtn: 'Book now' }} /></section>
    <section aria-label="membership"><LoyaltyBadge /></section>
  </MemoryRouter>);
  const checkout = within(screen.getByRole('region', { name: 'checkout' }));
  fireEvent.click(checkout.getByRole('button', { name: /쿠폰 사용하기/ }));
  expect(checkout.getByText('가입 환영 — 차터 5% 할인')).toBeVisible();
  expect(checkout.getByText('5%')).toBeVisible();
  expect(checkout.queryByText('무료')).toBeNull();
  expect(checkout.queryByText('가입 환영 — 무료 AI 일정 (1~3일)')).toBeNull();
  const membership = within(screen.getByRole('region', { name: 'membership' }));
  fireEvent.click(membership.getByRole('button'));
  expect(membership.getByText('가입 환영 — 차터 5% 할인')).toBeVisible();
  expect(membership.getByText('가입 환영 — 무료 AI 일정 (1~3일)')).toBeVisible();
  expect(membership.getAllByText('무료')).toHaveLength(2);
  expect(membership.getByText('5% OFF')).toBeVisible();
  expect(view.container.textContent).not.toContain('$100');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('blocks QR switching until a pending coupon validation settles', async () => {
  vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
  fixture.user = { uid: 'offline-guest', email: 'guest@example.test' };
  fixture.coupons = [{
    id: 'pending', code: 'PENDING', type: 'percent', value: 5, currency: 'USD', label: 'Pending discount',
    minOrderUSD: 0, isUsed: false, expiresAt: Date.UTC(2099, 0, 1), createdAt: 0,
  }];
  let finishValidation!: (response: unknown) => void;
  fetchMock.mockReturnValueOnce(new Promise(resolve => { finishValidation = resolve; }));
  render(<MemoryRouter><PayPalBookingButton productType="airport_seoul_central" passengers={1}
    priceKRW={124800} expectedUSD={92} lang="en" p={{ paypalBookBtn: 'Book now' }} /></MemoryRouter>);
  const qrButton = await screen.findByRole('button', { name: /Pay via QR/ });
  fireEvent.click(screen.getByRole('button', { name: /Use a coupon/ }));
  fireEvent.click(screen.getByRole('button', { name: /Pending discount/ }));
  expect(qrButton).toBeDisabled();
  fireEvent.click(qrButton);
  expect(screen.queryByRole('link', { name: 'QR not working? Open link directly' })).toBeNull();
  finishValidation({ ok: true, json: async () => ({ data: {
    valid: true, discountedPrice: 118560, savedAmount: 6240, discountRate: 0.05,
  } }) });
  await waitFor(() => expect(qrButton).toBeEnabled());
  expect(screen.getByText(/Discount applied/)).toBeVisible();
  fireEvent.click(qrButton);
  expect(await screen.findByRole('link', { name: 'QR not working? Open link directly' }))
    .toHaveAttribute('href', 'https://paypal.me/offline-test/92.00USD');
  expect(screen.getByText('≈ ₩124,800')).toBeVisible();
});

it.each([
  { productType: 'airport_seoul_central', priceKRW: 124800, expectedUSD: 92, discountedPrice: 118560, discountedUSD: '$88 USD' },
  { productType: 'ai-planner-full', priceKRW: AI_PLANNER_REFERENCE_KRW, expectedUSD: AI_PLANNER_FULL_USD, discountedPrice: 6600, discountedUSD: '$9.9 USD' },
].flatMap(props => ['back', 'report'].map(action => ({ ...props, action }))))('clears the applied coupon for full-price QR and permits reapplying it: $productType $action', async ({ action, ...props }) => {
  vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
  fixture.user = { uid: 'offline-guest', email: 'guest@example.test', getIdToken: async () => 'offline-token' };
  const coupon: Coupon = Object.freeze({
    id: 'discount', code: 'SAVED', type: 'percent', value: 5, currency: 'USD', label: 'Saved discount',
    minOrderUSD: 0, isUsed: false, expiresAt: Date.UTC(2099, 0, 1), createdAt: 0,
  });
  fixture.coupons = [coupon];
  const originalCoupon = { ...coupon };
  fetchMock.mockImplementation(async (url) => ({ ok: true, json: async () => url === '/api/applyPromoCode'
    ? { data: { valid: true, discountedPrice: props.discountedPrice, savedAmount: 6240, discountRate: 0.05,
      couponDocId: 'discount', userId: 'offline-guest' } }
    : { ok: true, data: {} } }));
  const checkout = (productType: string) => <MemoryRouter><PayPalBookingButton {...props} productType={productType} passengers={1} lang="en"
    userEmail="guest@example.test" plannerInput={{ city: 'seoul' }} p={{ paypalBookBtn: 'Book now' }} /></MemoryRouter>;
  const view = render(checkout('airport_seoul_central'));
  fireEvent.click(screen.getByRole('button', { name: /Use a coupon/ }));
  fireEvent.click(screen.getByRole('button', { name: /Saved discount/ }));
  await waitFor(() => expect(screen.getByText(/Discount applied/)).toBeVisible());
  view.rerender(checkout(props.productType));
  expect(screen.getByRole('button', { name: /Book now/ })).toHaveTextContent(props.discountedUSD);
  fireEvent.click(await screen.findByRole('button', { name: /Pay via QR/ }));
  const url = `https://paypal.me/offline-test/${props.expectedUSD.toFixed(2)}USD`;
  expect(await screen.findByRole('link', { name: 'QR not working? Open link directly' })).toHaveAttribute('href', url);
  expect(screen.getByText(`≈ ₩${props.priceKRW.toLocaleString('ko-KR')}`)).toBeVisible();
  expect(screen.getByText('Coupon discounts apply only to PayPal checkout. QR transfers use the full price.')).toBeVisible();
  expect(screen.queryByText(/Discount applied/)).toBeNull();
  if (action === 'back') {
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /Book now/ })).toHaveTextContent(`$${props.expectedUSD.toLocaleString('en-US')} USD`);
    expect(screen.queryByText(/Discount applied/)).toBeNull();
    view.rerender(checkout('airport_seoul_central'));
    fireEvent.click(screen.getByRole('button', { name: /Use a coupon/ }));
    fireEvent.click(screen.getByRole('button', { name: /Saved discount/ }));
    await waitFor(() => expect(screen.getByText(/Discount applied/)).toBeVisible());
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Report payment complete' }));
    const reports = () => fetchMock.mock.calls.filter(([url]) => url === '/api/manual-payment-request').map(([, init]) => JSON.parse(init.body)).filter(body => body.priceUSD);
    await waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0]).toMatchObject({ priceUSD: props.expectedUSD.toFixed(2), priceKRW: props.priceKRW, paypalMeUrl: url });
    expect(reports()[0]).not.toHaveProperty('couponDocId');
    expect(reports()[0]).not.toHaveProperty('promoCode');
  }
  expect(coupon).toEqual(originalCoupon);
  expect(fixture.coupons).toEqual([originalCoupon]);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/applyPromoCode')).toHaveLength(action === 'back' ? 2 : 1);
  expect(fetchMock.mock.calls.filter(([url]) => !['/api/applyPromoCode', '/api/manual-payment-request', '/api/prepay/prepare'].includes(url))).toHaveLength(0);
});

it.each([
  { productType: 'ai-planner-full', priceKRW: AI_PLANNER_REFERENCE_KRW, expectedUSD: AI_PLANNER_FULL_USD, amount: '9.90' },
  { productType: 'airport_seoul_central', priceKRW: 124800, expectedUSD: charterUsdFromKrw(124800), amount: '92.00' },
  { productType: 'tour_private', priceKRW: 337500, expectedUSD: 250, amount: '250.00' },
])('keeps the button, QR, link and report on one USD amount: $productType', async ({ amount, ...props }) => {
  render(<MemoryRouter><PayPalBookingButton {...props} passengers={1} lang="en"
    plannerInput={{ city: 'seoul' }} userEmail="guest@example.test" p={{ paypalBookBtn: 'Book now' }} /></MemoryRouter>);
  expect(screen.getByRole('button', { name: /Book now/ })).toHaveTextContent(`$${props.expectedUSD.toLocaleString('en-US')} USD`);
  fireEvent.click(await screen.findByRole('button', { name: /Pay via QR/ }));
  const link = await screen.findByRole('link', { name: 'QR not working? Open link directly' });
  const url = `https://paypal.me/offline-test/${amount}USD`;
  expect(link).toHaveAttribute('href', url);
  expect(screen.getByText(`$${amount} USD`)).toBeVisible();
  await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledWith(url, expect.any(Object)));
  fireEvent.click(screen.getByRole('button', { name: 'Report payment complete' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/manual-payment-request', expect.objectContaining({
    body: expect.stringContaining('"priceUSD"'),
  })));
  const report = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body)).find(body => body.priceUSD);
  expect(report).toMatchObject({ priceUSD: amount, priceKRW: props.priceKRW, paypalMeUrl: url });
});
