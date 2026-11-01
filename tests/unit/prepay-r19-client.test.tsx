// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r19 — 클라이언트 단순화(서버 묘비 전제). 적대적 r18 재현(A1·A2·A3·M1·E1b·E2a·E2b·E3a·E3b·E4a·E4c·E5a·E6c·E7a·E8a·E8b)이
 *   전부 안전한 결과인지 실제 React(CartPanel → CartCheckout, PayPalBookingButton)로 확인. 실 PayPal·네트워크 0.
 *   - order_voided = 최종 미결제 → 완료 표식(옛 키 주문도 숨김) + 4개 언어 rc.notCaptured
 *   - 구 서버의 지연된 no_attempt_record = UNKNOWN(주문 유지, 재결제 권유 없음)
 *   - 진행 중 capture = 모듈 집합(패널 닫기·재마운트에도 '같은 주문 확인' 비활성)
 *   - 오류 문구는 그 주문에 묶임, 목록 병합은 CAPTURED 를 UNKNOWN 으로 강등하지 않음, 빈 장바구니 고정은 모든 닫기에서 해제
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), items: [] as unknown[], listeners: new Set<() => void>() }));
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

type BC = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: BC[] = [];
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const FINAL = (id: string) => ({ ok: true, finalized: true, data: { orderID: id, amount: '100.00', currency: 'USD' } });
const notCaptured = (id: string, flow: string, evidence: string, reason: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: id, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, evidence, error: `Payment was not completed (${reason}). You can start a new payment.` });
const NO_ATTEMPT = (id: string, flow = 'cart') => notCaptured(id, flow, 'no_attempt_record', 'no_attempt_record'); // 구 서버(배포 전환기)
const VOIDED = (id: string, flow = 'cart') => ({ ...notCaptured(id, flow, 'order_voided', 'order_voided'), retryable: false, error: 'Payment was not completed. You can start a new payment.' });
type Call = { url: string; body: Record<string, unknown>; resolve: (v: unknown) => void };
const q: Call[] = [];
function queued() {
  q.length = 0;
  mocks.authFetch.mockImplementation((url: string, init?: { body?: string }) => new Promise((resolve) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url === '/api/createCartOrder') { resolve(reply(200, { ok: true, data: { orderID: 'CART-F', usdAmount: '100.00', totalKRW: 135000 } })); return; }
    if (url === '/api/createPaypalOrder') { resolve(reply(200, { ok: true, data: { orderID: 'ORD-F', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } })); return; }
    q.push({ url, body, resolve });
  }));
}
const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const answer = async (i: number, status: number, body: unknown) => { await act(async () => { q[i].resolve(reply(status, body)); }); await settle(); };
const has = (t: string | RegExp) => screen.queryAllByText(t).length > 0;
const btn = (t: string) => screen.queryAllByText(t)[0] as HTMLButtonElement | undefined;
const PAY_AGAIN = /You can start a new payment|You can pay again/;
const ITEM = { id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, addedAt: 1, booking: { productType: 'airport_pickup', dateStart: '2026-12-01', passengers: 2 } };
const openCart = async () => { await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); }); await settle(); };
const closeX = async () => { const x = document.querySelector('.customer-cart-header button:last-child') as HTMLButtonElement; await act(async () => { fireEvent.click(x); }); await settle(); };
const cartRecoveryOrder = () => (document.querySelector('.customer-checkout-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const singleRecoveryOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const cartRec = (id: string) => ({ orderID: id, flow: 'cart' as const, paymentStatus: 'CAPTURE_UNKNOWN' as const, review: false });
const otherTab = async (ops: Array<[string, string | null]>) => {
  await act(async () => {
    for (const [k, v] of ops) {
      const old = localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: old, newValue: v }));
    }
  });
  await settle();
};
const otherTabFinishes = (id: string) => otherTab([[PR.doneRecoveryKey(id), '1'], [PR.orderRecoveryKey(id), null]]);
const charter = (productType = 'charter_dmz', lang = 'en') => <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang={lang} dateStart="2099-12-05" p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />;
async function openLockedCart(id = 'CART-Q') {
  PR.saveRecoveryOrder(cartRec(id));
  const view = render(<CartPanel />);
  await openCart();
  await waitFor(() => expect(document.querySelector('.customer-checkout-recovery')).not.toBeNull());
  return view;
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0; q.length = 0;
  PR.resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client'); vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: BC) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
  queued();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('A / M — old-tab (legacy key) and memory evidence is never hidden or deleted', () => {
  it('A1: legacy UNKNOWN copied → check starts → old tab writes legacy CAPTURED (newer) → late no_attempt → CAPTURED shown, no "pay again", no Book now', async () => {
    const LEG = PR.recoveryKey('single');
    localStorage.setItem(LEG, JSON.stringify({ orderID: 'ORD-K', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz', updatedAt: 1000 }));
    render(charter()); await settle();
    expect(singleRecoveryOrder()).toBe('ORD-K');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await otherTab([[LEG, JSON.stringify({ orderID: 'ORD-K', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz', updatedAt: Date.now() + 1000 })]]);
    expect(PR.readRecoveryOrder('ORD-K')).toMatchObject({ paymentStatus: 'CAPTURED' }); // B12: 옛 키의 더 강한 상태가 이긴다
    await answer(0, 409, NO_ATTEMPT('ORD-K', 'single'));
    expect(PR.readRecoveryOrder('ORD-K')).toMatchObject({ paymentStatus: 'CAPTURED' });
    expect(has('Payment received; your booking is being recorded')).toBe(true);
    expect(has(PAY_AGAIN)).toBe(false);
    expect(btn('Book now')).toBeUndefined();
  });

  it.each(['single', 'cart'] as const)('A2-%s: the old tab finishes (removes its legacy key) between check start and a late no_attempt → order kept, no "pay again"', async (flow) => {
    const LEG = PR.recoveryKey(flow);
    const id = flow === 'cart' ? 'CART-M' : 'ORD-M';
    localStorage.setItem(LEG, JSON.stringify({ orderID: id, flow, paymentStatus: 'CAPTURE_UNKNOWN', review: false, ...(flow === 'single' ? { productType: 'charter_dmz' } : {}), updatedAt: 1000 }));
    if (flow === 'cart') { render(<CartPanel />); await openCart(); } else { render(charter()); await settle(); }
    fireEvent.click(await screen.findByText('Check this order')); await settle();
    await otherTab([[LEG, null]]);
    await answer(0, 409, NO_ATTEMPT(id, flow));
    expect(PR.readRecoveryOrder(id)).not.toBeNull();
    expect(PR.isRecoveryDone(id)).toBe(false);
    expect(has(PAY_AGAIN)).toBe(false);
    expect(btn('Book now')).toBeUndefined();
    expect(btn('Confirm & pay')).toBeUndefined();
  });

  it('A3 / E8b: legacy single pointer without product, no old tab, server voids it → done marker (legacy key kept, hidden), Book now returns, 4-language notice', async () => {
    const LEG = PR.recoveryKey('single');
    localStorage.setItem(LEG, JSON.stringify({ orderID: 'ORD-L', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    render(charter('tour_package')); await settle();
    expect(singleRecoveryOrder()).toBe('ORD-L');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('ORD-L', 'single'));
    expect(PR.isRecoveryDone('ORD-L')).toBe(true);
    expect(PR.readRecoveryOrder('ORD-L')).toBeNull();
    expect(localStorage.getItem(LEG)).not.toBeNull();
    expect(singleRecoveryOrder()).toBeNull();
    expect(btn('Book now')).toBeDefined();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    expect(has(/order_voided|no_attempt_record/)).toBe(false);
  });

  it('M1: this tab keeps a memory copy (storage write failed) → another tab stores CAPTURED → late no_attempt → storage CAPTURED kept, no "pay again"', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(PR.saveRecoveryOrder({ orderID: 'ORD-Q', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' })).toMatchObject({ persisted: false });
    spy.mockRestore();
    render(charter()); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await otherTab([[PR.orderRecoveryKey('ORD-Q'), JSON.stringify({ orderID: 'ORD-Q', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz', updatedAt: Date.now() + 1000, createdAt: 1, v: 2 })]]);
    expect(PR.readRecoveryOrder('ORD-Q')).toMatchObject({ paymentStatus: 'CAPTURED' });
    await answer(0, 409, NO_ATTEMPT('ORD-Q', 'single'));
    expect(localStorage.getItem(PR.orderRecoveryKey('ORD-Q'))).not.toBeNull();
    expect(has(PAY_AGAIN)).toBe(false);
    expect(btn('Book now')).toBeUndefined();
  });

  it('B12: saving an UNKNOWN over a known CAPTURED never downgrades it', () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-C', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz' });
    PR.saveRecoveryOrder({ orderID: 'ORD-C', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    expect(PR.readRecoveryOrder('ORD-C')).toMatchObject({ paymentStatus: 'CAPTURED' });
  });
});

describe('E1 / E2 — the empty-cart lock is released by every close and by another tab finishing', () => {
  it('E1b: lock → check → final → confirmation + Done stay; X (not Done) → reopen → "Your cart is empty"', async () => {
    await openLockedCart();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 200, FINAL('CART-Q'));
    expect(has('Booking confirmed!')).toBe(true);
    expect(has('Done')).toBe(true);
    await closeX();
    await openCart();
    expect(has('Your cart is empty')).toBe(true);
  });
  it('E2a: lock open → another tab finishes the order → "Your cart is empty" (no empty review screen)', async () => {
    await openLockedCart();
    await otherTabFinishes('CART-Q');
    expect(has('Your cart is empty')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
  });
  it('E2b: X → another tab finishes → reopen → "Your cart is empty"', async () => {
    await openLockedCart();
    await closeX();
    await otherTabFinishes('CART-Q');
    await openCart();
    expect(has('Your cart is empty')).toBe(true);
  });
  it('outside click also releases the lock', async () => {
    await openLockedCart();
    await act(async () => { fireEvent.mouseDown(document.body); }); await settle();
    await otherTabFinishes('CART-Q');
    await openCart();
    expect(has('Your cart is empty')).toBe(true);
  });
});

describe('E3 / E6c / E7a — result text belongs to its order; an old-server no_attempt never says "pay again"', () => {
  it('E3a: lock → check → old-server no_attempt → kept (UNKNOWN); another tab stores CAPTURED → "Payment received", no "pay again"', async () => {
    await openLockedCart();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, NO_ATTEMPT('CART-Q'));
    expect(cartRecoveryOrder()).toBe('CART-Q');
    expect(PR.isRecoveryDone('CART-Q')).toBe(false);
    expect(has(PAY_AGAIN)).toBe(false);
    await otherTab([[PR.orderRecoveryKey('CART-Q'), JSON.stringify({ orderID: 'CART-Q', flow: 'cart', paymentStatus: 'CAPTURED', review: false, updatedAt: Date.now() + 1000, createdAt: 1, v: 2 })]]);
    expect(cartRecoveryOrder()).toBe('CART-Q');
    expect(has('Payment received; your booking is being recorded')).toBe(true);
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('E3b: lock → check → old-server no_attempt → another tab finishes → empty cart, no "pay again"', async () => {
    await openLockedCart();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, NO_ATTEMPT('CART-Q'));
    await otherTabFinishes('CART-Q');
    expect(has(PAY_AGAIN)).toBe(false);
    expect(has('Your cart is empty')).toBe(true);
  });
  it('E6c: cart orders A, B → check A → order_voided → the panel moves to B without A\'s "not completed" text', async () => {
    PR.saveRecoveryOrder(cartRec('CART-A'));
    await new Promise((r) => setTimeout(r, 3));
    PR.saveRecoveryOrder(cartRec('CART-B'));
    render(<CartPanel />);
    await openCart();
    expect(cartRecoveryOrder()).toBe('CART-A');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('CART-A'));
    expect(PR.isRecoveryDone('CART-A')).toBe(true);
    expect(cartRecoveryOrder()).toBe('CART-B');
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('E7a: charter → check → old-server no_attempt → kept → another tab finishes → Book now back, no "pay again" text', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-X', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter()); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, NO_ATTEMPT('ORD-X', 'single'));
    expect(singleRecoveryOrder()).toBe('ORD-X');
    expect(has(PAY_AGAIN)).toBe(false);
    await otherTabFinishes('ORD-X');
    expect(singleRecoveryOrder()).toBeNull();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('a generic failure text for an order is cleared once that order is finished elsewhere', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-G', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter()); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 500, { ok: false, code: 'INTERNAL_ERROR', error: 'Payment failed for this order' });
    expect(has('Payment failed for this order')).toBe(true);
    await otherTabFinishes('ORD-G');
    expect(has('Payment failed for this order')).toBe(false);
  });
});

describe('E4 / E5 — a capture in flight in THIS tab survives close / remount (module-level set)', () => {
  async function startCartCapture() {
    mocks.items = [ITEM];
    render(<CartPanel />);
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Confirm & pay'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'CART-F' }); });
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
    await settle();
  }
  it('E4a / E4c: cart capture in flight → X → reopen → check disabled, no Confirm & pay (no second order); the capture final → confirmation', async () => {
    await startCartCapture();
    expect(btn('Check this order')!.disabled).toBe(true);
    await closeX();
    await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout')); await settle();
    expect(btn('Check this order')!.disabled).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
    expect(mocks.authFetch.mock.calls.filter((c) => c[0] === '/api/createCartOrder')).toHaveLength(1);
    await answer(0, 200, FINAL('CART-F'));
    expect(PR.isRecoveryDone('CART-F')).toBe(true);
    expect(PR.isCaptureInFlight('CART-F')).toBe(false);
    // r22: restore screens removed — the reopened checkout shows the emptied cart (the paid items are gone; no Confirm & pay)
    expect(has('Your cart is empty')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
  });
  it('E5a: charter capture in flight → unmount → remount → check disabled; the capture final finishes the order', async () => {
    const view = render(charter());
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'ORD-F' }); });
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
    await settle();
    view.unmount();
    render(charter()); await settle();
    expect(singleRecoveryOrder()).toBe('ORD-F');
    expect(btn('Check this order')!.disabled).toBe(true);
    await answer(0, 200, FINAL('ORD-F'));
    expect(PR.isRecoveryDone('ORD-F')).toBe(true);
    expect(PR.isCaptureInFlight('ORD-F')).toBe(false);
    // r22: restore screens removed — the remounted screen offers Book now again (a new purchase; same as main, accepted policy)
    expect(singleRecoveryOrder()).toBeNull();
    expect(btn('Book now')).toBeDefined();
  });
});

describe('E8a / B8 — order_voided finishes legacy and new orders; 4 languages', () => {
  it('E8a: empty cart + legacy cart pointer → check → order_voided → done; next visit → empty cart (never locked forever)', async () => {
    localStorage.setItem(PR.recoveryKey('cart'), JSON.stringify({ orderID: 'CART-L', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    const view = render(<CartPanel />);
    await openCart();
    expect(cartRecoveryOrder()).toBe('CART-L');
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 409, VOIDED('CART-L'));
    expect(PR.isRecoveryDone('CART-L')).toBe(true);
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    view.unmount();
    render(<CartPanel />);
    await openCart();
    expect(has('Your cart is empty')).toBe(true);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('order_voided notice in %s uses rc.notCaptured (no server English, no internal code)', async (lang) => {
    PR.saveRecoveryOrder({ orderID: 'ORD-V', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter('charter_dmz', lang)); await settle();
    fireEvent.click(screen.getByText(PR.PAYMENT_RECOVERY_COPY[lang].check)); await settle();
    await answer(0, 409, VOIDED('ORD-V', 'single'));
    expect(has(PR.PAYMENT_RECOVERY_COPY[lang].notCaptured)).toBe(true);
    expect(has(/start a new payment|order_voided|no_attempt_record/)).toBe(false);
    expect(PR.isRecoveryDone('ORD-V')).toBe(true);
  });
});
