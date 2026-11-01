// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r20 — 게스트 장바구니(실제 useCart + cart-storage, user=null). 실 PayPal·네트워크 0.
 *   G1) capture 진행 중 패널 닫기 → 다시 열기 → capture final → 확정 화면, 결제 끝난 상품의 'Confirm & pay' 없음(재결제 0).
 *   G2) 다른 탭이 그 주문을 끝내고 게스트 장바구니를 비움(storage 이벤트) → 빈 장바구니 안내, 'Confirm & pay' 없음.
 *   Astra #2) 첫 주문 → order_voided → 재결제 → 새 주문 → PayPal 버튼이 다시 그려짐.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {}, markPlannerPendingComplete: () => {} }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/firebase.js', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('@/hooks/useGuestSignup', () => ({ useGuestSignup: () => ({ signupLoading: false, signupError: null, handleGuestSignup: vi.fn() }) }));
vi.mock('@/lib/cart-types', async (orig) => ({ ...(await orig() as object), isCartEnabled: () => true }));

import * as PR from '@/lib/paymentRecovery';
import { CartPanel } from '@/components/CartButton';
import { CART_LS_KEY } from '@/lib/cart-storage';

type BC = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: BC[] = [];
let renders = 0;
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const FINAL = (id: string) => ({ ok: true, finalized: true, data: { orderID: id, amount: '100.00', currency: 'USD' } });
const VOIDED = (id: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: id, flow: 'cart', paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: false, evidence: 'order_voided', error: 'Payment was not completed. You can start a new payment.' });
type Call = { url: string; resolve: (v: unknown) => void };
const q: Call[] = [];
let created = 0;
const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const answer = async (i: number, status: number, body: unknown) => { await act(async () => { q[i].resolve(reply(status, body)); }); await settle(); };
const has = (t: string | RegExp) => screen.queryAllByText(t).length > 0;
const btn = (t: string) => screen.queryAllByText(t)[0] as HTMLButtonElement | undefined;
const ITEM = { id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, addedAt: 1, booking: { productType: 'airport_pickup', dateStart: '2026-12-01', passengers: 2 } };
const openCart = async () => { await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); }); await settle(); };
const closeX = async () => { const x = document.querySelector('.customer-cart-header button:last-child') as HTMLButtonElement; await act(async () => { fireEvent.click(x); }); await settle(); };

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0; q.length = 0; created = 0; renders = 0;
  PR.resetPaymentRecoveryMemory(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network blocked'); }));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: BC) => { buttons.push(cfg); return { render: () => { renders += 1; }, isEligible: () => true }; }, FUNDING: {} };
  mocks.authFetch.mockImplementation((url: string) => new Promise((resolve) => {
    if (url === '/api/createCartOrder') { created += 1; resolve(reply(200, { ok: true, data: { orderID: created === 1 ? 'CART-F' : 'CART-G', usdAmount: '100.00', totalKRW: 135000 } })); return; }
    q.push({ url, resolve });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

async function approveInCart() {
  fireEvent.click(await screen.findByText('Confirm & pay'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'CART-F' }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await settle();
}

describe('r20-9 guest cart — a capture that finishes after the panel was closed', () => {
  it('G1: in flight → X → reopen → Proceed → final → "Booking confirmed!", no Confirm & pay, cart emptied, no second order', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    await approveInCart();
    await closeX(); await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout')); await settle();
    expect(btn('Check this order')!.disabled).toBe(true);
    await answer(0, 200, FINAL('CART-F'));
    expect(has('Booking confirmed!')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
    expect(localStorage.getItem(CART_LS_KEY)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Done')); }); await settle();
    await openCart();
    expect(has('Your cart is empty')).toBe(true);
    expect(created).toBe(1);
  });

  it('G1b: in flight → X (panel stays closed) → final arrives → opening the cart shows the confirmation (until closed)', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    await approveInCart();
    await closeX();
    await answer(0, 200, FINAL('CART-F'));
    await openCart();
    expect(has('Booking confirmed!')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
    await closeX(); await openCart();
    expect(has('Booking confirmed!')).toBe(false);
    expect(has('Your cart is empty')).toBe(true);
  });

  it('G2: another tab finishes the shown order and empties the guest cart (storage events) → empty-cart notice, no Confirm & pay', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    PR.saveRecoveryOrder({ orderID: 'CART-Q', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout')); await settle();
    expect(has('Check this order')).toBe(true);
    await act(async () => {
      for (const [k, v] of [[PR.doneRecoveryKey('CART-Q'), '1'], [PR.orderRecoveryKey('CART-Q'), null], [CART_LS_KEY, null]] as Array<[string, string | null]>) {
        const old = localStorage.getItem(k);
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: old, newValue: v }));
      }
    });
    await settle();
    expect(btn('Confirm & pay')).toBeUndefined();
    expect(has('Your cart is empty')).toBe(true);
  });
});

describe('r20-7 — a new order after order_voided gets fresh PayPal buttons', () => {
  it('Astra #2: first order → order_voided → pay again → new order → SDK renders twice, the payment area is shown', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    await approveInCart();
    await answer(0, 409, VOIDED('CART-F'));
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    expect(renders).toBe(1);
    fireEvent.click(screen.getByText('Confirm & pay')); await settle();
    await waitFor(() => expect(renders).toBe(2));
    expect(created).toBe(2);
    expect(document.querySelector('#cart-paypal-btn')!.className).not.toMatch(/hidden/);
  });
});

// r21-10: the guest cart changes in another tab while a PayPal order is open ('ready') → the open order is dropped (review screen again).
const otherTabCart = async (value: string | null) => {
  await act(async () => {
    const old = localStorage.getItem(CART_LS_KEY);
    if (value === null) localStorage.removeItem(CART_LS_KEY); else localStorage.setItem(CART_LS_KEY, value);
    window.dispatchEvent(new StorageEvent('storage', { key: CART_LS_KEY, oldValue: old, newValue: value }));
  });
  await settle();
};
describe('r21-10 — cart changed in another tab while the PayPal order is open', () => {
  it('T1: order for [A] ready → another tab adds B → the [A] order is dropped (PayPal area hidden, Confirm & pay again for A+B)', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Confirm & pay'));
    await waitFor(() => expect(buttons.length).toBe(1));
    expect(document.querySelector('#cart-paypal-btn')!.className).not.toMatch(/hidden/);
    await otherTabCart(JSON.stringify([{ ...ITEM, id: 'item-2', displayName: 'Night tour' }, ITEM]));
    expect(document.querySelector('#cart-paypal-btn')!.className).toMatch(/hidden/);
    expect(has('Night tour')).toBe(true);
    expect(btn('Confirm & pay')).toBeDefined();
    fireEvent.click(screen.getByText('Confirm & pay')); await settle();
    expect(created).toBe(2);
  });
  it('T2: order ready → another tab paid and emptied the guest cart → no live PayPal button, empty-cart notice', async () => {
    localStorage.setItem(CART_LS_KEY, JSON.stringify([ITEM]));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Confirm & pay'));
    await waitFor(() => expect(buttons.length).toBe(1));
    await otherTabCart(null);
    const host = document.getElementById('cart-paypal-btn');
    expect(!host || host.className.includes('hidden')).toBe(true);
    expect(has('Your cart is empty')).toBe(true);
  });
});
