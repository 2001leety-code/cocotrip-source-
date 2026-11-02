// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r3 (G) — AI 플래너가 발급까지 유지하는 CAPTURED 복구 포인터는 플래너 전용 키에 산다.
 *   적대적 r2 재현: 공용 'single' 키에 두면 차터·투어·InlineBookingCard 결제 버튼이 막히고, 그 화면의 '같은 주문 확인'이
 *   결제하지 않은 상품의 'Booking Confirmed!' 를 띄웠다. 실 PayPal 호출 0 (authFetch·SDK mock).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, orderRecoveryKey, readRecoveryOrder } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const createOk = { ok: true, data: { orderID: 'ORD-P', usdAmount: '9.90', krwAmount: 14000, currentRate: 1400, displayKRW: '14,000원', displayUSD: '$9.90 USD' } };
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '9.90', currency: 'USD', payerName: 'Pay Er', payerEmail: 'payer@example.invalid' } });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
  mocks.authFetch.mockImplementation(async (url: string) => {
    const body = url === '/api/createPaypalOrder' ? createOk : url === '/api/capturePaypalOrder' ? final('ORD-P') : null;
    if (!body) throw new Error(`OFFLINE: unexpected ${url}`);
    return { ok: true, status: 200, json: async () => body };
  });
});

describe('planner CAPTURED pointer is scoped to the planner (charter / tour / InlineBookingCard unaffected)', () => {
  it('planner payment final → pointer kept under the planner key only; a charter button on the same browser still shows "Book now"', async () => {
    const onPaymentSuccess = vi.fn(async () => {});
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" onPaymentSuccess={onPaymentSuccess} keepRecoveryUntilFulfilled p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />);
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons).toHaveLength(1));
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-P' }); });
    await waitFor(() => expect(onPaymentSuccess).toHaveBeenCalledWith('ORD-P'));

    // r16: 플래너 전용 범위 키 → 그 주문 자신의 키(order:ORD-P)에 CAPTURED 로 유지. 옛 범위 키는 쓰지 않는다.
    const planner = JSON.parse(localStorage.getItem(orderRecoveryKey('ORD-P')) || 'null');
    expect(planner).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED', productType: 'ai-planner-full' });
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
    expect(localStorage.getItem(recoveryKey('single', PLANNER_RECOVERY_SCOPE))).toBeNull();

    cleanup();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.getByText('Book now')).toBeInTheDocument();
    expect(screen.queryByText('Check this order')).toBeNull();
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ paymentStatus: 'CAPTURED' }); // r16: 차터 화면은 플래너 주문을 건드리지 않는다
  });

  it('a reloaded planner page still sees its own pointer (same order check instead of a new payment)', () => {
    localStorage.setItem(recoveryKey('single', PLANNER_RECOVERY_SCOPE), JSON.stringify({ orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'ai-planner-full', updatedAt: 1 }));
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
  });
});
