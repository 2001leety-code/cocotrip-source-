// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import { AI_PLANNER_FULL_USD, AI_PLANNER_REFERENCE_KRW } from '../../src/lib/aiPlannerPrice';
import { charterUsdFromKrw } from '../../src/lib/charterUsd';
import type { Coupon } from '../../src/hooks/useLoyalty';

const fixture = vi.hoisted(() => ({ coupons: [] as Coupon[], language: 'en', user: null as { uid: string; email: string } | null }));
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
  expect(checkout.getByText('무료')).toBeVisible();
  expect(checkout.queryByText('가입 환영 — 무료 AI 일정 (1~3일)')).toBeNull();
  const membership = within(screen.getByRole('region', { name: 'membership' }));
  fireEvent.click(membership.getByRole('button'));
  expect(membership.getByText('가입 환영 — 차터 5% 할인')).toBeVisible();
  expect(membership.getByText('가입 환영 — 무료 AI 일정 (1~3일)')).toBeVisible();
  expect(membership.getAllByText('무료')).toHaveLength(2);
  expect(view.container.textContent).not.toContain('$100');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('passes the already-discounted checkout amount to QR without recalculating a coupon', async () => {
  vi.stubEnv('VITE_FEATURE_DISCOUNT_V2', 'true');
  fixture.coupons = [{
    id: 'discount', code: 'SAVED', type: 'percent', value: 5, currency: 'USD', label: 'Saved discount',
    minOrderUSD: 0, isUsed: false, expiresAt: Date.UTC(2099, 0, 1), createdAt: 0,
  }];
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {
    valid: true, discountedPrice: 118560, savedAmount: 6240, discountRate: 0.05,
  } }) });
  render(<MemoryRouter><PayPalBookingButton productType="airport_seoul_central" passengers={1}
    priceKRW={124800} expectedUSD={92} lang="en" p={{ paypalBookBtn: 'Book now' }} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Use a coupon/ }));
  fireEvent.click(screen.getByRole('button', { name: /Saved discount/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Book now/ })).toHaveTextContent('$88 USD'));
  fireEvent.click(await screen.findByRole('button', { name: /Pay via QR/ }));
  expect(await screen.findByRole('link', { name: 'QR not working? Open link directly' }))
    .toHaveAttribute('href', 'https://paypal.me/offline-test/88.00USD');
  expect(screen.getByText('≈ ₩118,560')).toBeVisible();
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
