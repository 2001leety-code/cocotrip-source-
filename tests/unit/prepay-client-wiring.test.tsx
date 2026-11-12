// @vitest-environment jsdom
// Minimal prepayment wiring; all payment and identity transports are mocked.
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ user: {uid:'scope-owner',email:'synthetic@example.invalid'}, authFetch: vi.fn(), clear: vi.fn(async () => {}), track: vi.fn(), paid: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: mocks.track }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: mocks.paid, trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { get currentUser() { return mocks.user; } } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('../../src/components/PayPalQrPanel', async () => {
  const R = await import('react');
  return { PayPalQrPanel: () => R.createElement('div', null, 'QR PANEL') };
});
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { buildPlannerOrderInput, buildFullPlannerIntentPayload } from '../../src/pages/PlannerPage/lib/plannerIntent';
import { resolvePrepayErrorMessage, resolveErrorMessage } from '../../src/pages/PlannerPage/hooks/errorMessages';
import { translations } from '../../src/i18n';
import type { PlannerFormValues } from '../../src/components/PlannerForm';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';
import { recoveryKey, recoveryCopy, classifyCaptureResponse } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { createOrder: () => string; onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
beforeEach(() => {
  mocks.user = {uid:'scope-owner',email:'synthetic@example.invalid'};
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

const values: PlannerFormValues = {
  regions: ['Seoul', 'Busan'], cityKeys: ['seoul', 'busan'], arrival_city: 'seoul',
  departure_city: 'busan', startDate: '2030-01-01', endDate: '2030-01-03',
  durationDays: 3, dietaryRestrictions: ['Halal'], dietPrefs: ['Seafood'], pax: 2,
};

it('builds the same travel fields as the existing generation request', () => {
  const { flat } = buildFullPlannerIntentPayload(values, 'en');
  expect(buildPlannerOrderInput(values, 'en')).toEqual({
    area: 'seoul_city', arrival_city: values.arrival_city, departure_city: values.departure_city, ...flat,
  });
});

it.each(['ai-planner-full', 'ai_planner_full', 'charter_dmz', 'tour_hourly'])('sends plannerInput only for full AI planner: %s', async (productType) => {
  mocks.authFetch.mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'PREPAY_INPUT_MISSING', error: 'raw server diagnostic' }) });
  const plannerInput = buildPlannerOrderInput(values, 'en');
  render(<PayPalBookingButton productType={productType} passengers={1} priceKRW={1} lang="en"
    plannerInput={plannerInput} p={{ ...translations.en.planner, paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Book now'));
  await screen.findByText(translations.en.planner.prepayErrors.PREPAY_INPUT_MISSING);
  const body = JSON.parse(mocks.authFetch.mock.calls[0][1].body);
  expect(body.plannerInput).toEqual(productType.startsWith('ai') ? JSON.parse(JSON.stringify(plannerInput)) : undefined);
  expect(buttons).toHaveLength(0);
});

it('preserves the existing AI scope gate before creating an order', async () => {
  render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en"
    plannerInput={buildPlannerOrderInput(values, 'en')} canStartAiCheckout={() => false}
    aiCheckoutBlockedMessage="Check existing order" p={{ paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Book now'));
  expect(mocks.authFetch).not.toHaveBeenCalled();
  expect(screen.getByText('Check existing order')).toBeVisible();
});

it.each(['ko', 'en', 'ja', 'zh'] as const)('localizes every prepay code without using the unpaid copy for generation: %s', (lang) => {
  const p = { ko, en: translations.en, ja, zh }[lang].planner;
  for (const code of ['DIETARY_COVERAGE_UNAVAILABLE', 'PREPAY_INPUT_MISSING', 'PREPAY_INPUT_MISMATCH', 'PREPAY_INPUT_INVALID', 'PREPAY_CITIES_MISSING', 'PREPAY_DIETARY_MISSING', 'PREPAY_DATES_MISSING', 'PLANNER_INPUT_CONFLICT', 'PLANNER_DATE_TOO_SOON']) {
    const hint = resolvePrepayErrorMessage(code, p.prepayErrors);
    expect(hint).toBeTruthy();
    expect(hint).not.toMatch(/\?{2,}/);
    const afterPayment = resolveErrorMessage(code as Parameters<typeof resolveErrorMessage>[0], 'raw server diagnostic', p.errors);
    expect(afterPayment).not.toBe('raw server diagnostic');
    expect(afterPayment).not.toBe(hint);
    expect(afterPayment).not.toMatch(/\?{2,}/);
  }
});

it.each(['ko', 'en', 'ja', 'zh'] as const)('maps proven pre-capture refusal in %s without changing the recovery classification', async (lang) => {
  const p = { ko, en: translations.en, ja, zh }[lang].planner;
  mocks.authFetch.mockImplementation(async (url: string) => ({
    ok: url.includes('create'),
    json: async () => url.includes('create')
      ? { ok: true, data: { orderID: 'ORDER-PREPAY', usdAmount: '10.00', currentRate: 1300, displayUSD: '$10', displayKRW: '13000' } }
      : { ok: false, code: 'PAYMENT_NOT_CAPTURED', paymentStatus: 'NOT_CAPTURED', orderID: 'ORDER-PREPAY', finalized: false, preCaptureCode: 'PREPAY_INPUT_MISSING', error: 'raw server diagnostic' },
  }));
  render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang={lang} p={{ ...p, paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons).toHaveLength(1));
  await act(async () => { await buttons[0].onApprove({ orderID: 'ORDER-PREPAY' }); });
  expect(screen.getByText(p.prepayErrors.PREPAY_INPUT_MISSING)).toBeVisible();
  expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
});

it.each(['CAPTURE_UNKNOWN', 'CAPTURED'])('never shows an unpaid hint for a 202 %s capture outcome', async (paymentStatus) => {
  mocks.authFetch.mockImplementation(async (url: string) => ({
    ok: true, status: url.includes('create') ? 200 : 202,
    json: async () => url.includes('create')
      ? { ok: true, data: { orderID: 'ORDER-PREPAY', usdAmount: '10.00', currentRate: 1300, displayUSD: '$10', displayKRW: '13000' } }
      : { ok: false, code: 'PAYMENT_RECOVERY_PENDING', paymentStatus, orderID: 'ORDER-PREPAY', finalized: false, preCaptureCode: 'PREPAY_INPUT_MISSING', error: 'raw server diagnostic' },
  }));
  const success = vi.fn();
  render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" onPaymentSuccess={success}
    p={{ ...translations.en.planner, paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons).toHaveLength(1));
  await act(async () => { await buttons[0].onApprove({ orderID: 'ORDER-PREPAY' }); });
  expect(screen.queryByText(translations.en.planner.prepayErrors.PREPAY_INPUT_MISSING)).toBeNull();
  expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || '{}').paymentStatus).toBe(paymentStatus);
  expect(success).not.toHaveBeenCalled();
});

it.each(['ko', 'en', 'ja', 'zh'] as const)('keeps 503 capture and reconcile on the same order with localized uncertainty: %s', async (lang) => {
  const p = { ko, en: translations.en, ja, zh }[lang].planner;
  const unavailable = { ok: false, code: 'PREPAY_CHECK_UNAVAILABLE', error: 'Could not verify the order right now' };
  expect(classifyCaptureResponse(unavailable, 'ORDER-PREPAY')).toMatchObject({ kind: 'error', code: 'PREPAY_CHECK_UNAVAILABLE' });
  mocks.authFetch.mockImplementation(async (url: string) => ({
    ok: url.includes('create'), status: url.includes('create') ? 200 : 503,
    json: async () => url.includes('create')
      ? { ok: true, data: { orderID: 'ORDER-PREPAY', usdAmount: '10.00', currentRate: 1300, displayUSD: '$10', displayKRW: '13000' } }
      : unavailable,
  }));
  const success = vi.fn();
  const props = { productType: 'ai-planner-full', passengers: 1, priceKRW: 1, lang, onPaymentSuccess: success, p: { ...p, paypalBookBtn: 'Book now' } };
  render(<PayPalBookingButton {...props} />);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons).toHaveLength(1));
  await act(async () => { await buttons[0].onApprove({ orderID: 'ORDER-PREPAY' }); });
  const assertPending = () => {
    expect(screen.getByText(p.errors.PREPAY_CHECK_UNAVAILABLE)).toBeVisible();
    expect(screen.queryByText(p.prepayErrors.PREPAY_CHECK_UNAVAILABLE)).toBeNull();
    expect(screen.queryByText('Book now')).toBeNull();
    expect(screen.queryByText('QR PANEL')).toBeNull();
    expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || '{}')).toMatchObject({ orderID: 'ORDER-PREPAY', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(success).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
  };
  assertPending();
  cleanup();
  render(<PayPalBookingButton {...props} />);
  fireEvent.click(screen.getByText(recoveryCopy(lang).check));
  await screen.findByText(p.errors.PREPAY_CHECK_UNAVAILABLE);
  assertPending();
  const last = mocks.authFetch.mock.calls.at(-1);
  expect(JSON.parse(last![1].body)).toEqual({ orderID: 'ORDER-PREPAY', reconcile: true });
});
