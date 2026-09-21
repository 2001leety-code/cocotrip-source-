// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { BookingInfoForm } from '../../src/components/booking/BookingInfoForm';

const { authFetch, authState, getAvailableAiCoupon, firestore } = vi.hoisted(() => ({
  authFetch: vi.fn(),
  authState: { current: { user: null as { uid: string; email?: string } | null, loading: false } },
  getAvailableAiCoupon: vi.fn(),
  firestore: {
    doc: vi.fn((...path: unknown[]) => path),
    collection: vi.fn((...path: unknown[]) => path),
    query: vi.fn((value: unknown) => value),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(() => vi.fn()),
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState.current }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/authFetch', () => ({ authFetch }));
vi.mock('@/lib/firebase', () => ({ db: {}, signInWithGoogle: vi.fn(), getAvailableAiCoupon }));
vi.mock('@/lib/analytics', () => ({
  trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null,
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));

import { PurchaseSection } from '../../src/pages/PlannerPage/components/PurchaseSection';
import { translations } from '../../src/i18n';

// Firebase adapters are replaced before the actual UI module is evaluated.
const { PayPalBookingButton } = await vi.importActual<{
  PayPalBookingButton: React.ComponentType<{
    productType: string; passengers: number; dateStart: string; dateEnd: string;
    priceKRW: number; expectedUSD: number; lang: string; userEmail: string;
    termsAgreed: boolean; marketingConsent: boolean;
    p: { paypalBookBtn: string; paypalLoading: string };
    onPaymentSuccess: (orderID: string) => void;
  }>;
}>('../../src/components/PayPalBookingButton');

const props = {
  eyebrow: 'Booking', title: 'Tour', dateText: '2030-01-01', paxText: '2', isAirport: true,
  meetingLabel: 'Meeting', baseStr: '₩100', meetingStr: '₩0', childSeatStr: '₩0', totalStr: '₩100', usdStr: '$1', ctaLabel: 'Pay',
  onSubmit: vi.fn(), hideCta: true,
};

afterEach(() => {
  cleanup();
  authFetch.mockReset();
  getAvailableAiCoupon.mockReset();
  authState.current = { user: null, loading: false };
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.paypal;
});

function EchoingPhoneForm({ onEcho }: { onEcho: (phone: string) => void }) {
  const [phone, setPhone] = useState('+81 90 1234 5678');
  return (
    <MemoryRouter>
      <BookingInfoForm
        {...props}
        phone={phone}
        onPhoneChange={(nextPhone) => { setPhone(nextPhone); onEcho(nextPhone); }}
      />
    </MemoryRouter>
  );
}

describe('BookingInfoForm external synchronization', () => {
  it('prefills mounted external arrival and phone values, then preserves a manually edited arrival time', () => {
    const view = render(<MemoryRouter><BookingInfoForm {...props} phone="+81 90 1234 5678" externalArrivalTime="10:30:45" /></MemoryRouter>);
    const time = view.container.querySelector('input[type="time"]') as HTMLInputElement;
    const phone = view.container.querySelector('input[inputmode="tel"]') as HTMLInputElement;
    expect(time.value).toBe('10:30');
    expect(phone.value).toBe('9012345678');

    fireEvent.change(time, { target: { value: '11:15' } });
    view.rerender(<MemoryRouter><BookingInfoForm {...props} phone="+81 90 1234 5678" externalArrivalTime="12:45:00" /></MemoryRouter>);
    expect(time.value).toBe('11:15');

    view.rerender(<MemoryRouter><BookingInfoForm {...props} phone="" externalArrivalTime="12:45:00" /></MemoryRouter>);
    expect(phone.value).toBe('');
  });

  it('keeps a controlled user echo in the chosen dial and normalized national number', () => {
    const onEcho = vi.fn();
    const view = render(<EchoingPhoneForm onEcho={onEcho} />);
    const phone = view.container.querySelector('input[inputmode="tel"]') as HTMLInputElement;

    fireEvent.change(phone, { target: { value: '91 0000 0000' } });

    expect(onEcho).toHaveBeenLastCalledWith('+81 9100000000');
    expect(phone.value).toBe('91 0000 0000');
  });
});

describe('PayPalBookingButton payment handoff', () => {
  it('creates the displayed USD-checked order and captures it with the required consent metadata', async () => {
    vi.stubEnv('VITE_PAYPAL_ENV', 'sandbox');
    vi.stubEnv('VITE_PAYPAL_SANDBOX_CLIENT_ID', 'test-sandbox-client-id');
    let buttonsConfig: Record<string, unknown> | undefined;
    window.paypal = {
      FUNDING: {},
      Buttons: vi.fn((config: Record<string, unknown>) => {
        buttonsConfig = config;
        return { render: vi.fn(), isEligible: () => true };
      }),
    };
    const createOrder = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { orderID: 'ORDER-123', usdAmount: '10.00', currentRate: 1300, displayKRW: '₩13,000', displayUSD: '$10.00' } }),
    }));
    vi.stubGlobal('fetch', createOrder);
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { orderID: 'ORDER-123', payerName: 'Guest', payerEmail: 'guest@example.com', amount: '10.00' } }),
    });
    const onPaymentSuccess = vi.fn();

    const view = render(
      <MemoryRouter>
        <PayPalBookingButton
          productType="ai_planner"
          passengers={2}
          dateStart="2030-01-01"
          dateEnd="2030-01-02"
          priceKRW={13000}
          expectedUSD={10}
          lang="en"
          userEmail="guest@example.com"
          termsAgreed
          marketingConsent
          p={{ paypalBookBtn: 'Book with PayPal', paypalLoading: 'Loading' }}
          onPaymentSuccess={onPaymentSuccess}
        />
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole('button', { name: /book with paypal/i }));

    await waitFor(() => expect(buttonsConfig).toBeDefined());
    expect(JSON.parse(createOrder.mock.calls[0][1].body)).toMatchObject({
      productType: 'ai_planner', passengers: 2, expectedUSD: 10, termsAgreed: true,
    });

    await act(async () => {
      await (buttonsConfig?.onApprove as (data: { orderID: string }) => Promise<void>)({ orderID: 'ORDER-123' });
    });

    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toMatchObject({
      orderID: 'ORDER-123', product: 'ai_planner', termsAgreed: true, marketingConsent: true,
    });
    expect(JSON.parse(authFetch.mock.calls[0][1].body).termsAgreedAt).toEqual(expect.any(String));
    expect(onPaymentSuccess).toHaveBeenCalledWith('ORDER-123');
  });
});

describe('PurchaseSection coupon visibility', () => {
  it('drops a departed user coupon and only shows the next user coupon after its own response', async () => {
    authState.current = { user: { uid: 'user-a', email: 'guest@example.com' }, loading: false };
    const resolvers: Array<(coupon: { code: string; maxDays: number }) => void> = [];
    getAvailableAiCoupon.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const p = translations.en.planner;
    const onPaymentSuccess = vi.fn();
    const sectionProps = {
      p, language: 'en', userEmail: 'guest@example.com', setUserEmail: vi.fn(),
      isGeneratingPlan: false, planError: null, resultQuick: {},
      lastValues: { current: { durationDays: 3 } }, revisionMode: false,
      revisionPlanId: null, revisionToken: null, onPaymentSuccess, onRevisionRegenerate: vi.fn(),
    };
    const view = render(<MemoryRouter initialEntries={['/planner?coupon=FREE-3']}><PurchaseSection {...sectionProps} /></MemoryRouter>);

    await waitFor(() => expect(getAvailableAiCoupon).toHaveBeenCalledWith('user-a', 3));

    authState.current = { user: null, loading: false };
    view.rerender(<MemoryRouter initialEntries={['/planner?coupon=FREE-3']}><PurchaseSection {...sectionProps} /></MemoryRouter>);
    await act(async () => { resolvers[0]({ code: 'FREE-3', maxDays: 3 }); });

    authState.current = { user: { uid: 'user-b', email: 'next@example.com' }, loading: false };
    view.rerender(<MemoryRouter initialEntries={['/planner?coupon=FREE-3']}><PurchaseSection {...sectionProps} /></MemoryRouter>);
    await waitFor(() => expect(getAvailableAiCoupon).toHaveBeenCalledWith('user-b', 3));
    expect(view.queryByText(p.aiCouponApplied)).toBeNull();

    await act(async () => { resolvers[1]({ code: 'FREE-3', maxDays: 3 }); });

    await waitFor(() => expect(view.getByText(p.aiCouponApplied)).toBeTruthy());
    expect(onPaymentSuccess).not.toHaveBeenCalled();
  });
});
