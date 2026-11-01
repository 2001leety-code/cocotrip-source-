// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r17 — Astra r16 (P2 3 + P3 1 클라이언트). 실 PayPal 0.
 *   1) 옛 키에만 있던 미해결 주문은 읽는 순간 주문별 키로 복사 — 구버전 탭이 옛 키를 덮어도 유실 없음.
 *   2) 화면 조건(상품) 변경 → 즉시 재선택(B 상품으로 바꾸면 B 주문 패널, Book now 아님).
 *   3) 장바구니가 비어도(앞 주문 성공 뒤) 남은 cart 주문의 확인 화면으로 들어갈 수 있다(CartPanel → CartCheckout).
 *   5) 끝난 주문에 늦게 온 streaming 응답이 issue 를 다시 만들지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}), items: [] as unknown[] }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {} }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: mocks.items, clear: mocks.clear, remove: vi.fn(), add: vi.fn(), isInCart: () => false, loading: false }) }));
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
vi.mock('@/lib/cart-types', async (orig) => ({ ...(await orig() as object), isCartEnabled: () => true }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children), useNavigate: () => vi.fn() };
});

import { recoveryKey, PLANNER_RECOVERY_SCOPE, orderRecoveryKey, readRecoveryOrder, saveRecoveryOrder, finishPaidPlannerOrder, markPlannerIssuePending, resetPaymentRecoveryMemory } from '../../src/lib/paymentRecovery';
import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { CartPanel } from '../../src/components/CartButton';

const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const legacy = (orderID: string, productType = 'ai_planner_full') => JSON.stringify({ orderID, flow: 'single', paymentStatus: 'CAPTURED', review: false, productType, updatedAt: 1 });
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const booking = (productType: string) => <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />;

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: () => ({ render: () => {}, isEligible: () => true }), FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r17-1 — a legacy-only unresolved order is copied to its own order key', () => {
  it('Astra repro: legacy Q → planner shows Q → an old-version tab overwrites the legacy key with P → Q still listed and shown, P listed too', async () => {
    localStorage.setItem(PLANNER, legacy('ORD-Q'));
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />);
    expect(shownOrder()).toBe('ORD-Q');
    expect(localStorage.getItem(orderRecoveryKey('ORD-Q'))).not.toBeNull(); // 복사됨
    const p = legacy('ORD-P');
    await act(async () => { localStorage.setItem(PLANNER, p); window.dispatchEvent(new StorageEvent('storage', { key: PLANNER, oldValue: legacy('ORD-Q'), newValue: p })); });
    expect(shownOrder()).toBe('ORD-Q');
    expect(readRecoveryOrder('ORD-Q')).not.toBeNull();
    expect(readRecoveryOrder('ORD-P')).not.toBeNull();
    expect(localStorage.getItem(PLANNER)).toBe(p); // 옛 키는 그대로(읽기 전용)
  });
  it('a finished legacy order is not copied back', () => {
    localStorage.setItem(PLANNER, legacy('ORD-F'));
    finishPaidPlannerOrder('ORD-F');
    expect(readRecoveryOrder('ORD-F')).toBeNull();
    expect(localStorage.getItem(orderRecoveryKey('ORD-F'))).toBeNull();
  });
});

describe('r17-2 — switching the product re-selects at once', () => {
  it('saved order for product B, mounted as A → Book now; switched to B → B order panel, no Book now', async () => {
    saveRecoveryOrder({ orderID: 'ORD-B', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_roundtrip' });
    const view = render(booking('charter_oneway'));
    expect(shownOrder()).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
    await act(async () => { view.rerender(booking('charter_roundtrip')); });
    expect(shownOrder()).toBe('ORD-B');
    expect(screen.queryByText('Book now')).toBeNull();
  });
});

describe('r17-3 — an empty cart still reaches the next unresolved cart order', () => {
  it('cart order Q unresolved, cart emptied after P succeeded → open the cart → "Check this order" for Q', async () => {
    saveRecoveryOrder({ orderID: 'CART-Q', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
    render(<CartPanel />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); });
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    expect(screen.getByText('CART-Q')).toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).toBeNull();
  });
  it('no unresolved cart order + empty cart → the usual empty state', async () => {
    render(<CartPanel />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); });
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
  });
});

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const noAttempt = (orderID: string, flow = 'single') => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, evidence: 'no_attempt_record', error: 'Payment was not completed. You can start a new payment.' });
const pendingBody = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false });

describe('r17-6 — a capture in flight is never turned into "you can pay again"', () => {
  async function approveInFlight(el: React.ReactElement, capture: Promise<unknown>) {
    const buttons: ButtonsConfig[] = [];
    (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return reply(200, { ok: true, data: { orderID: 'ORD-F', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });
      if (url === '/api/capturePaypalOrder') return capture;
      throw new Error(`OFFLINE ${url}`);
    });
    render(el);
    fireEvent.click(screen.getByText('Book now'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    let approving!: Promise<void>;
    act(() => { approving = buttons[buttons.length - 1].onApprove({ orderID: 'ORD-F' }); });
    return () => approving;
  }
  // 미시도 주문 = 구 서버 no_attempt_record 는 UNKNOWN(주문 유지), 새 서버는 묘비로 최종 답(별도 임시 해제 없음).
  it('F1 charter: during capture the check button is disabled; the order stays saved; the late PENDING keeps the panel (no Book now)', async () => {
    let answer!: (v: unknown) => void;
    const done = await approveInFlight(booking('charter_dmz'), new Promise((r) => { answer = r; }));
    expect(screen.getByText('Check this order')).toBeDisabled();
    expect(readRecoveryOrder('ORD-F')).not.toBeNull();
    await act(async () => { answer(reply(202, pendingBody('ORD-F'))); await done(); });
    expect(readRecoveryOrder('ORD-F')).not.toBeNull();
    expect(shownOrder()).toBe('ORD-F');
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('F3 planner: mid-capture the order stays saved, then the real final → plan issuance continues (onPaymentSuccess once, CAPTURED kept)', async () => {
    let answer!: (v: unknown) => void;
    const success = vi.fn(async () => {});
    const done = await approveInFlight(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />, new Promise((r) => { answer = r; }));
    expect(readRecoveryOrder('ORD-F')).not.toBeNull();
    await act(async () => { answer(reply(200, { ok: true, finalized: true, data: { orderID: 'ORD-F', amount: '100', currency: 'USD' } })); await done(); });
    expect(success).toHaveBeenCalledTimes(1);
    expect(readRecoveryOrder('ORD-F')).toMatchObject({ paymentStatus: 'CAPTURED' });
  });
  // r19: a (late, old-server) no_attempt_record is "no attempt at that moment" — UNKNOWN: order kept, no done marker, no "pay again".
  it('a restored order whose check answers no_attempt_record stays unresolved (UNKNOWN) — kept, no done marker, no "pay again"', async () => {
    saveRecoveryOrder({ orderID: 'ORD-R', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/capturePaypalOrder') return reply(409, noAttempt('ORD-R')); throw new Error(`OFFLINE ${url}`); });
    render(booking('charter_dmz'));
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(readRecoveryOrder('ORD-R')).not.toBeNull();
    const { isRecoveryDone } = await import('../../src/lib/paymentRecovery');
    expect(isRecoveryDone('ORD-R')).toBe(false);
    expect(shownOrder()).toBe('ORD-R');
    expect(screen.queryByText(/You can pay again|start a new payment/)).toBeNull();
  });
  it('F4 cart: during the cart capture the check button is disabled', async () => {
    const buttons: ButtonsConfig[] = [];
    (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
    document.body.insertAdjacentHTML('beforeend', '<div id="cart-paypal-btn"></div><script id="paypal-sdk" data-mode="live"></script>');
    mocks.items = [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }];
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') return reply(200, { ok: true, data: { orderID: 'CART-F', usdAmount: '100.00', totalKRW: 135000 } });
      if (url === '/api/captureCartOrder') return new Promise(() => {});
      throw new Error(`OFFLINE ${url}`);
    });
    const { CartCheckout } = await import('../../src/components/CartCheckout');
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByText('Confirm & pay'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'CART-F' }); });
    expect(await screen.findByText('Check this order')).toBeDisabled();
  });
  it('classifyCaptureResponse: no_attempt_record = UNKNOWN (r19), order_voided / plain NOT_CAPTURED = final nonpayment', async () => {
    const { classifyCaptureResponse } = await import('../../src/lib/paymentRecovery');
    expect(classifyCaptureResponse(noAttempt('X'), 'X')).toEqual({ kind: 'pending', status: 'CAPTURE_UNKNOWN' });
    expect(classifyCaptureResponse({ ...noAttempt('X'), evidence: 'order_voided' }, 'X')).toMatchObject({ kind: 'not_captured' });
    expect(classifyCaptureResponse({ ...noAttempt('X'), evidence: undefined }, 'X')).toMatchObject({ kind: 'not_captured' });
  });
});

describe('r17-8 — bfcache restore re-reads the orders', () => {
  it('an order written while the page was hidden (no storage event) shows after pageshow persisted', async () => {
    render(booking('charter_dmz'));
    expect(shownOrder()).toBeNull();
    localStorage.setItem(orderRecoveryKey('ORD-H'), JSON.stringify({ orderID: 'ORD-H', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz', v: 2, createdAt: 1, updatedAt: 1 }));
    await act(async () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    expect(shownOrder()).toBe('ORD-H');
  });
});

describe('r17-9 — a product-less single order is never finished by a final answer', () => {
  it('charter page: legacy single order without product → final → neutral notice, order kept unresolved (not done)', async () => {
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-N', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/capturePaypalOrder') return reply(200, { ok: true, finalized: true, data: { orderID: 'ORD-N', amount: '100', currency: 'USD' } }); throw new Error(`OFFLINE ${url}`); });
    render(booking('charter_dmz'));
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText(/confirmed for a different order/)).toBeInTheDocument();
    const { isRecoveryDone } = await import('../../src/lib/paymentRecovery');
    expect(isRecoveryDone('ORD-N')).toBe(false);
    expect(readRecoveryOrder('ORD-N')).not.toBeNull();
  });
});

describe('r17-5 — a late streaming answer does not recreate the issue of a finished order', () => {
  it('issue → finished + cleaned → late markPlannerIssuePending → no issue key', () => {
    saveRecoveryOrder({ orderID: 'ORD-I', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'ai_planner_full' });
    markPlannerIssuePending('plan-1', 'ORD-I');
    finishPaidPlannerOrder('ORD-I');
    expect(localStorage.getItem('cocotrip:payment-recovery:issue:plan-1')).toBeNull();
    markPlannerIssuePending('plan-1', 'ORD-I'); // 늦은 streaming 200
    expect(localStorage.getItem('cocotrip:payment-recovery:issue:plan-1')).toBeNull();
  });
});
