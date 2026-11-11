// @vitest-environment jsdom
// Onboarding r1 E3 — PayPal coupon picker: an email-less member gets the connect prompt, not an
// /api/applyPromoCode call. Price and order code are untouched (guard only). Offline mocks as in
// payment-recovery-ui.test.tsx.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const mocks = vi.hoisted(() => ({
  user: { uid: 'u', isAnonymous: false, email: null as string | null },
  authFetch: vi.fn(),
}));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({
  useLoyalty: () => ({ activeCoupons: [{ id: 'c1', code: 'WELCOME-CHARTER-ABC123', type: 'percent', value: 5, currency: 'USD', label: 'Welcome 5% off Charter', productScope: 'charter', isUsed: false, expiresAt: 4_102_444_800_000 }] }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [], clear: vi.fn() }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { get currentUser() { return mocks.user; } } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => true }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('../../src/components/PayPalQrPanel', () => ({ PayPalQrPanel: () => null }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { CONNECT_EMAIL_EVENT } from '../../src/lib/connectEmail';

const prompts = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { valid: false } }) });
  window.addEventListener(CONNECT_EMAIL_EVENT, prompts);
});
afterEach(() => { cleanup(); window.removeEventListener(CONNECT_EMAIL_EVENT, prompts); });

function pickCoupon() {
  render(<PayPalBookingButton productType="charter" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Use a coupon'));
  fireEvent.click(screen.getByText('Welcome 5% off Charter'));
}

describe('PayPalBookingButton coupon guard for email-less members', () => {
  it('phone member: no applyPromoCode call, the connect prompt is requested', () => {
    mocks.user = { uid: 'phone-uid', isAnonymous: false, email: null };
    pickCoupon();
    expect(mocks.authFetch.mock.calls.filter(c => c[0] === '/api/applyPromoCode')).toHaveLength(0);
    expect(prompts).toHaveBeenCalledOnce();
  });

  it('control: an email member still calls applyPromoCode and sees no prompt', () => {
    mocks.user = { uid: 'g-uid', isAnonymous: false, email: 'person@example.invalid' };
    pickCoupon();
    expect(mocks.authFetch.mock.calls.filter(c => c[0] === '/api/applyPromoCode')).toHaveLength(1);
    expect(prompts).not.toHaveBeenCalled();
  });
});
