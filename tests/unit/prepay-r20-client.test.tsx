// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r20 — 클라이언트(로그인 장바구니 모의 + 실제 CartPanel/CartCheckout/PayPalBookingButton). 실 PayPal·네트워크 0.
 *   8) 미결제(order_voided)로 생긴 완료 표식은 서버의 뒤늦은 CAPTURED·검토 증거가 이긴다(Astra #3). 확정 표식은 그대로.
 *   10) 주문 A 의 최종 "결제 안 됨" 문구는 A 를 방금 확인한 화면에서만 — 다른 주문으로 바뀌면 지운다(X1 차터·E6c 장바구니).
 *   11) 빈 장바구니 고정 화면의 일반 오류(status error) 뒤 다른 탭 완료 → 빈 장바구니 안내(E2d).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), items: [] as unknown[], listeners: new Set<() => void>(), createReplies: [] as unknown[] }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {}, markPlannerPendingComplete: () => {} }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', email: 'u@example.invalid' } }) }));
vi.mock('@/hooks/useCart', async () => {
  const R = await import('react');
  const emit = () => { for (const f of [...mocks.listeners]) f(); };
  return {
    useCart: () => {
      const items = R.useSyncExternalStore((fn: () => void) => { mocks.listeners.add(fn); return () => { mocks.listeners.delete(fn); }; }, () => mocks.items);
      return { items, loading: false, clear: async () => { mocks.items = []; emit(); }, remove: vi.fn(), add: vi.fn(), isInCart: () => false };
    },
  };
});
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

import * as PR from '@/lib/paymentRecovery';
import { CartPanel } from '@/components/CartButton';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';

const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const VOIDED = (id: string, flow = 'cart') => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: id, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: false, evidence: 'order_voided', error: 'Payment was not completed. You can start a new payment.' });
type Call = { url: string; resolve: (v: unknown) => void };
const q: Call[] = [];
const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const answer = async (i: number, status: number, body: unknown) => { await act(async () => { q[i].resolve(reply(status, body)); }); await settle(); };
const has = (t: string | RegExp) => screen.queryAllByText(t).length > 0;
const btn = (t: string) => screen.queryAllByText(t)[0] as HTMLButtonElement | undefined;
const PAY_AGAIN = /You can start a new payment|You can pay again/;
const ITEM = { id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, addedAt: 1, booking: { productType: 'airport_pickup', dateStart: '2026-12-01', passengers: 2 } };
const openCart = async () => { await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); }); await settle(); };
const cartRecoveryOrder = () => (document.querySelector('.customer-checkout-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const singleRecoveryOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const cartRec = (id: string) => ({ orderID: id, flow: 'cart' as const, paymentStatus: 'CAPTURE_UNKNOWN' as const, review: false });
const otherTabFinishes = async (id: string) => {
  await act(async () => {
    for (const [k, v] of [[PR.doneRecoveryKey(id), '1'], [PR.orderRecoveryKey(id), null]] as Array<[string, string | null]>) {
      const old = localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: old, newValue: v }));
    }
  });
  await settle();
};
const charter = () => <PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" dateStart="2099-12-05" p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />;

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); q.length = 0; mocks.createReplies = [];
  PR.resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client'); vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: () => ({ render: () => {}, isEligible: () => true }), FUNDING: {} };
  mocks.authFetch.mockImplementation((url: string) => new Promise((resolve) => {
    if (url === '/api/createCartOrder') { resolve(reply(200, mocks.createReplies.shift() || { ok: true, data: { orderID: 'CART-NEW', usdAmount: '100.00', totalKRW: 135000 } })); return; }
    if (url === '/api/createPaypalOrder') { resolve(reply(200, { ok: true, data: { orderID: 'ORD-NEW', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } })); return; }
    q.push({ url, resolve });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r20-8 — a "not paid" done marker yields to later server CAPTURED / review evidence', () => {
  it('Astra #3: cart order voided → a webhook conflict makes the server block the new order with 409 pending CAPTURED → the panel explains it ("Payment received"), no pay button', async () => {
    mocks.items = [ITEM];
    PR.saveRecoveryOrder(cartRec('CART-Q'));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('CART-Q'));
    expect(PR.isRecoveryDone('CART-Q')).toBe(true);
    mocks.createReplies.push({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'CART-Q', flow: 'cart', paymentStatus: 'CAPTURED', finalized: false, error: 'Payment was received.' });
    fireEvent.click(screen.getByText('Confirm & pay')); await settle();
    expect(cartRecoveryOrder()).toBe('CART-Q');
    expect(has('Payment received; your booking is being recorded')).toBe(true);
    expect(btn('Check this order')).toBeDefined();
    expect(btn('Confirm & pay')).toBeUndefined();
    expect(PR.isRecoveryDone('CART-Q')).toBe(false);
  });
  it('void markers yield only to CAPTURED / review; a confirmed (final) marker never yields', () => {
    PR.finishRecoveryOrder('ORD-V', 'void');
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-V', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false })).toBeNull();
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-V', flow: 'single', paymentStatus: 'CAPTURED', review: false })).not.toBeNull();
    expect(PR.isRecoveryDone('ORD-V')).toBe(false);
    PR.finishRecoveryOrder('ORD-R', 'void');
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-R', flow: 'single', paymentStatus: 'NOT_CAPTURED', review: true })).not.toBeNull();
    PR.finishRecoveryOrder('ORD-F');
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-F', flow: 'single', paymentStatus: 'CAPTURED', review: false })).toBeNull();
    PR.finishRecoveryOrder('ORD-F', 'void'); // never downgrades a final marker
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-F', flow: 'single', paymentStatus: 'CAPTURED', review: false })).toBeNull();
  });
});

describe('r20-10 — A\'s final "not paid" text never appears after B finishes', () => {
  it('X1 (charter): A, B → check A → order_voided → panel B → another tab finishes B → Book now without A\'s "pay again" text', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-A', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    await new Promise((r) => setTimeout(r, 3));
    PR.saveRecoveryOrder({ orderID: 'ORD-B', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter()); await settle();
    expect(singleRecoveryOrder()).toBe('ORD-A');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('ORD-A', 'single'));
    expect(singleRecoveryOrder()).toBe('ORD-B');
    expect(has(PAY_AGAIN)).toBe(false);
    await otherTabFinishes('ORD-B');
    expect(singleRecoveryOrder()).toBeNull();
    expect(btn('Book now')).toBeDefined();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('E6c (cart): A, B → check A → order_voided → panel B → another tab finishes B → review screen without A\'s "pay again" text', async () => {
    mocks.items = [ITEM];
    PR.saveRecoveryOrder(cartRec('CART-A'));
    await new Promise((r) => setTimeout(r, 3));
    PR.saveRecoveryOrder(cartRec('CART-B'));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('CART-A'));
    expect(cartRecoveryOrder()).toBe('CART-B');
    await otherTabFinishes('CART-B');
    expect(cartRecoveryOrder()).toBeNull();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('the final text stays when no other order takes over (the order this tab just checked)', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-A', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter()); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('ORD-A', 'single'));
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
  });
});

describe('r20-11 — empty-cart lock after a generic error', () => {
  it('E2d: lock → check → 500 → another tab finishes the order → "Your cart is empty" (no empty review screen)', async () => {
    PR.saveRecoveryOrder(cartRec('CART-Q'));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(await screen.findByText('Check this order')); await settle();
    await answer(0, 500, { ok: false, code: 'INTERNAL_ERROR', error: 'Internal error' });
    expect(cartRecoveryOrder()).toBe('CART-Q');
    await otherTabFinishes('CART-Q');
    expect(has('Your cart is empty')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
  });
  it('this tab\'s own final "not paid" result screen stays (not bounced to the empty cart)', async () => {
    PR.saveRecoveryOrder(cartRec('CART-Q'));
    render(<CartPanel />);
    await openCart();
    fireEvent.click(await screen.findByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('CART-Q'));
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    expect(has('Your cart is empty')).toBe(false);
  });
});

// r22: the restore screens were removed — a remount after the order finished elsewhere offers Book now (a new purchase, as on main).
describe('r22 — a remounted single button after the capture finished with nothing mounted', () => {
  // r24 (L6b): back to r22 — r23's kept CAPTURED pointer was reverted (cookie-less guest: Check 403 → next purchase blocked;
  //   another date on reopen → the old order confirmed with the new date). The order is done; remount = Book now.
  it('E5a variant: capture in flight → unmount → final arrives with nothing mounted → remount: order done, no stale panel, Book now', async () => {
    const buttons: Array<{ onApprove: (d: { orderID: string }) => Promise<void> }> = [];
    (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: { onApprove: (d: { orderID: string }) => Promise<void> }) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
    const view = render(charter());
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'ORD-NEW' }); });
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
    view.unmount();
    await answer(0, 200, { ok: true, finalized: true, data: { orderID: 'ORD-NEW', amount: '100.00', currency: 'USD' } });
    render(charter()); await settle();
    expect(PR.isRecoveryDone('ORD-NEW')).toBe(true);
    expect(singleRecoveryOrder()).toBeNull();
    expect(btn('Book now')).toBeDefined();
    expect(has(PAY_AGAIN)).toBe(false);
  });
});
