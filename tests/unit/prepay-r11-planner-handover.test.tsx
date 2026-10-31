// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r11 — Astra r10 P2 + minor. 실 PayPal 0.
 *   1) 플래너 키의 Q 가 풀리면(NOT_CAPTURED·다른 탭 삭제) 공용 키에 남은 유료 플래너 주문 P 를 그 자리에서 승계 — Book now 금지.
 *   2) 다른 상품 화면이 놓은(forget) 주문 P 는 다른 탭이 다시 저장해도 이 화면 패널로 되살아나지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
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
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { recoveryKey, PLANNER_RECOVERY_SCOPE } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const ptr = (orderID: string, status: string, productType = 'ai_planner_full') => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType, updatedAt: 1 });
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const notCaptured = (orderID: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const planner = () => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />;
function captureReplies(body: unknown, status = 409) {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/capturePaypalOrder') return { ok: status < 300, status, json: async () => body };
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r11-1 — when the planner key\'s order is released, the paid planner order left on the shared key takes over', () => {
  it('shared P (CAPTURED) + planner Q → Check Q → NOT_CAPTURED → P panel, no Book now; P moved to the planner key', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURED'));
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN'));
    captureReplies(notCaptured('ORD-Q'));
    render(planner());
    expect(shownOrder()).toBe('ORD-Q');
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBe('ORD-P');
    expect(screen.queryByText('Book now')).toBeNull();
    expect(JSON.parse(localStorage.getItem(PLANNER) || 'null')).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(localStorage.getItem(SHARED)).toBeNull();
  });
  it('another tab deletes Q (StorageEvent) → P panel, no Book now', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURED'));
    const q = ptr('ORD-Q', 'CAPTURE_UNKNOWN');
    localStorage.setItem(PLANNER, q);
    render(planner());
    expect(shownOrder()).toBe('ORD-Q');
    await act(async () => {
      localStorage.removeItem(PLANNER); // 다른 탭이 확정 답을 보고 지움
      window.dispatchEvent(new StorageEvent('storage', { key: PLANNER, oldValue: q, newValue: null }));
    });
    expect(shownOrder()).toBe('ORD-P');
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('the shared key only holds another product\'s order → nothing taken over, Book now', async () => {
    const charter = ptr('ORD-C', 'CAPTURE_UNKNOWN', 'charter_dmz');
    localStorage.setItem(SHARED, charter);
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN'));
    captureReplies(notCaptured('ORD-Q'));
    render(planner());
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
    expect(localStorage.getItem(SHARED)).toBe(charter);
  });
});

describe('r11-2 — an order this screen let go is not revived by another tab re-saving it', () => {
  it('charter screen: P (planner) final → neutral notice; another tab re-saves P → still the notice, no panel (once only)', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURE_UNKNOWN'));
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN')); // r10 (a): P 는 공용 키에 남는다
    captureReplies(final('ORD-P'), 200);
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />);
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    const again = ptr('ORD-P', 'CAPTURED');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: again })); });
    expect(shownOrder()).toBeNull();
    expect(screen.getByText(/confirmed for a different order/)).toBeInTheDocument();
  });
});
