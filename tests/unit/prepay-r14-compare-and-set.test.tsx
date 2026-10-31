// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r14 — Astra r13 P2. 복구 포인터 쓰기를 remember 한 곳에서 비교 후 쓰기(빈 키·같은 주문만)로 중앙화,
 *   외부 주문 판별 = flow + 상품(isForeignOrder), 장바구니의 늦은 응답 대조(isCurrentPointer). 실 PayPal 0.
 *   "다른 탭" = 이벤트 없이 저장소를 바꾸는 경우(이벤트 전 창) — 비교 후 쓰기가 덮지 않아야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
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
import { CartCheckout } from '../../src/components/CartCheckout';
import { recoveryKey, PLANNER_RECOVERY_SCOPE, isForeignOrder } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const CART = recoveryKey('cart');
const ptr = (orderID: string, flow: 'single' | 'cart', productType?: string, status = 'CAPTURE_UNKNOWN') => JSON.stringify({ orderID, flow, paymentStatus: status, review: false, ...(productType ? { productType } : {}), updatedAt: 1 });
const orderOn = (k: string) => { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as { orderID: string }).orderID : null; };
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const pending = (orderID: string, flow: 'single' | 'cart' = 'single', extra: Record<string, unknown> = {}) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow, paymentStatus: 'CAPTURE_UNKNOWN', finalized: false, ...extra });
const createOk = (orderID: string) => reply(200, { ok: true, data: { orderID, usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });
const charter = () => <PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />;

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

/** 단건 화면: Book now → 주문 ORD-P 생성 → (다른 탭이 이벤트 없이 키에 Q 저장) → onApprove. */
async function approveWhileAnotherTabWrites(key: string, q: string, capture: () => Promise<unknown>, el = charter()) {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/createPaypalOrder') return createOk('ORD-P');
    if (url === '/api/capturePaypalOrder') return capture();
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
  render(el);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  localStorage.setItem(key, q);
  await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-P' }); });
}

describe('r14 — isForeignOrder (flow + product)', () => {
  it.each([
    [{ flow: 'single' as const }, { flow: 'cart' as const }, true],
    [{ flow: 'cart' as const }, { flow: 'cart' as const }, false],
    [{ flow: 'single' as const, productType: 'ai_planner_full' }, { flow: 'single' as const }, true],
    [{ flow: 'single' as const, productType: 'ai_planner_full' }, { flow: 'single' as const, planner: true }, false],
    [{ flow: 'cart' as const, productType: 'cart' }, { flow: 'single' as const }, true],
    [{ flow: 'single' as const }, { flow: 'single' as const }, false],
  ])('%j on %j → %s', (p, screenDef, want) => { expect(isForeignOrder(p, screenDef)).toBe(want); });
});

describe('r14 — PayPalBookingButton write sites never overwrite another order', () => {
  it('Button:628 + 252 (pointer before capture, then pending) — another tab\'s Q on the key is kept', async () => {
    await approveWhileAnotherTabWrites(SHARED, ptr('ORD-Q', 'single', 'tour_dmz'), async () => reply(202, pending('ORD-P')));
    expect(orderOn(SHARED)).toBe('ORD-Q');
    expect(screen.getByText('Check this order')).toBeInTheDocument(); // 이 탭은 자기 주문 P 를 계속 확인(메모리)
  });
  it('Button:687 (capture throws) — Q kept', async () => {
    await approveWhileAnotherTabWrites(SHARED, ptr('ORD-Q', 'single', 'tour_dmz'), async () => { throw new Error('network'); });
    expect(orderOn(SHARED)).toBe('ORD-Q');
  });
  it('Astra #3 / Button:296 — new planner payment P final while the planner key became Q → Q kept, P goes to the shared key', async () => {
    const planner = <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />;
    await approveWhileAnotherTabWrites(PLANNER, ptr('ORD-Q', 'single', 'ai_planner_full', 'CAPTURED'), async () => reply(200, final('ORD-P')), planner);
    expect(orderOn(PLANNER)).toBe('ORD-Q');
    expect(orderOn(SHARED)).toBe('ORD-P');
  });
  it('Astra #2 / Button:858 — a cart order (flow cart, productType cart) from the server is foreign: the cart key\'s Q is kept, notice shown', async () => {
    localStorage.setItem(CART, ptr('ORD-Q', 'cart'));
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return reply(409, pending('ORD-P', 'cart', { productType: 'cart' }));
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(charter());
    await act(async () => { fireEvent.click(screen.getByText('Book now')); await new Promise((r) => setTimeout(r, 10)); });
    expect(orderOn(CART)).toBe('ORD-Q');
    expect(screen.getByText(/still being confirmed/)).toBeInTheDocument();
  });
  it('Button:858 same-scope 409 (single, unknown product) while another tab wrote Q without an event → Q kept', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') { localStorage.setItem(SHARED, ptr('ORD-Q', 'single', 'tour_dmz')); return reply(409, pending('ORD-P')); }
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(charter());
    await act(async () => { fireEvent.click(screen.getByText('Book now')); await new Promise((r) => setTimeout(r, 10)); });
    expect(orderOn(SHARED)).toBe('ORD-Q');
  });
  it('same order is still updated; an empty key is still written', async () => {
    await approveWhileAnotherTabWrites(SHARED, ptr('ORD-P', 'single', 'charter_dmz'), async () => reply(202, { ...pending('ORD-P'), paymentStatus: 'CAPTURED' }));
    expect(JSON.parse(localStorage.getItem(SHARED) || 'null')).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
  });
});

describe('r14 — CartCheckout write sites never overwrite another order', () => {
  async function approveCart(captureBody: () => Promise<unknown>, beforeApprove: () => void) {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') return reply(200, { ok: true, data: { orderID: 'CART-P', usdAmount: '100.00', totalKRW: 135000 } });
      if (url === '/api/captureCartOrder') return captureBody();
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByText('Confirm & pay'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    beforeApprove();
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'CART-P' }); });
  }
  it('Cart:226 + 101 (pointer before capture, then pending) — another tab\'s cart Q kept', async () => {
    await approveCart(async () => reply(202, pending('CART-P', 'cart')), () => localStorage.setItem(CART, ptr('CART-Q', 'cart')));
    expect(orderOn(CART)).toBe('CART-Q');
  });
  it('Cart:237 (capture throws) — cart Q kept', async () => {
    await approveCart(async () => { throw new Error('network'); }, () => localStorage.setItem(CART, ptr('CART-Q', 'cart')));
    expect(orderOn(CART)).toBe('CART-Q');
  });
  it('Cart:157 (409 own cart order) while another tab wrote cart Q without an event → Q kept', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') { localStorage.setItem(CART, ptr('CART-Q', 'cart')); return reply(409, pending('CART-P', 'cart')); }
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByText('Confirm & pay')); await new Promise((r) => setTimeout(r, 10)); });
    expect(orderOn(CART)).toBe('CART-Q');
  });
  it('Astra #1 / Cart:101 — checking a foreign planner P; another tab replaces the shared key with unissued Q (event) → late P pending dropped, Q kept', async () => {
    let answer!: (v: unknown) => void;
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/capturePaypalOrder') return new Promise((r) => { answer = r; });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    const p = ptr('ORD-P', 'single', 'ai_planner_full');
    await act(async () => { localStorage.setItem(SHARED, p); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: p })); });
    fireEvent.click(await screen.findByText('Check this order'));
    const q = ptr('ORD-Q', 'single', 'ai_planner_full', 'CAPTURED');
    await act(async () => { localStorage.setItem(SHARED, q); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: p, newValue: q })); });
    await act(async () => { answer(reply(202, pending('ORD-P'))); await new Promise((r) => setTimeout(r, 10)); });
    expect(orderOn(SHARED)).toBe('ORD-Q');
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
