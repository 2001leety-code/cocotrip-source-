// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r22 (단순화) — r20·r21 의 결과 복원 화면(보관 결과 B-I1~I5)은 삭제됐다. 이 파일은 남은 계약을 고정한다
 *   (실제 React + 실제 paymentRecovery, authFetch·PayPal SDK 모의, 로그인 장바구니 = 공유 목록 모의, 실 PayPal·네트워크 0):
 * B-I6 미결제 문구 수명: "결제 안 됨" 문구는 그 orderID 가 CAPTURED·검토 포인터 또는 'final' 완료 표식으로 보이면 즉시 지워지고
 *      ('void' 표식은 지우는 근거가 아니다), 다른 주문이 선택돼도 지워진다(단건·장바구니 화면 자체 문구 모두).
 * 확정 화면 날짜 = 주문 당시 날짜(결제 대기 중 화면 날짜를 바꿔도).
 * 화면을 떠났다 돌아오면 단건은 Book now(새 구매 — main 과 같음), 결제 진행 중이면 '같은 주문 확인' 비활성(r19 유지).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), items: [] as unknown[], listeners: new Set<() => void>(), createIds: [] as string[] }));
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
const VOIDED = (id: string, flow = 'single', extra: Record<string, unknown> = {}) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: id, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: false, evidence: 'order_voided', error: 'Payment was not completed. You can start a new payment.', ...extra });
const GENERIC = { ok: false, code: 'INTERNAL_ERROR', error: 'Internal error' };
type Call = { url: string; resolve: (v: unknown) => void };
const q: Call[] = [];
const settle = async (ms = 15) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const answer = async (i: number, status: number, body: unknown) => { await act(async () => { q[i].resolve(reply(status, body)); }); await settle(); };
const has = (t: string | RegExp) => screen.queryAllByText(t).length > 0;
const btn = (t: string) => screen.queryAllByText(t)[0] as HTMLButtonElement | undefined;
const PAY_AGAIN = /You can start a new payment|You can pay again/;
const DATE = '2099-12-05';
const ITEM = { id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, addedAt: 1, booking: { productType: 'airport_pickup', dateStart: '2026-12-01', passengers: 2 } };
const P_PROPS = { paypalBookBtn: 'Book now', paypalRetry: 'Retry', errors: { DIETARY_COVERAGE_UNAVAILABLE: 'Some meals cannot be matched to your diet' } };
const openCart = async () => { await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); }); await settle(); };
const closeX = async () => { const x = document.querySelector('.customer-cart-header button:last-child') as HTMLButtonElement; await act(async () => { fireEvent.click(x); }); await settle(); };
const singlePanel = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
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
const otherTabFinishes = (id: string) => otherTab([[PR.doneRecoveryKey(id), String(Date.now())], [PR.orderRecoveryKey(id), null]]);
const otherTabPending = (id: string, flow: 'single' | 'cart' = 'single', productType = 'charter_dmz') =>
  otherTab([[PR.orderRecoveryKey(id), JSON.stringify({ orderID: id, flow, paymentStatus: 'CAPTURE_UNKNOWN', review: false, ...(flow === 'single' ? { productType } : {}), updatedAt: Date.now(), createdAt: Date.now(), v: 2 })]]);
const charter = (productType = 'charter_dmz', dateStart = DATE) => <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" dateStart={dateStart} p={P_PROPS} />;

async function singleCaptureThenUnmount(orderID: string, productType = 'charter_dmz', dateStart = DATE) {
  mocks.createIds.push(orderID);
  const view = render(charter(productType, dateStart));
  fireEvent.click(await screen.findByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await settle();
  view.unmount();
  await settle();
}
async function cartCaptureThenClose(orderID: string) {
  mocks.items = [ITEM]; mocks.createIds.push(orderID);
  render(<CartPanel />);
  await openCart();
  fireEvent.click(screen.getByText('Proceed to checkout'));
  fireEvent.click(await screen.findByText('Confirm & pay'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await settle();
  await closeX();
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0; q.length = 0; mocks.createIds = [];
  PR.resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network blocked'); }));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client'); vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: BC) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
  mocks.authFetch.mockImplementation((url: string) => new Promise((resolve) => {
    if (url === '/api/createCartOrder') { resolve(reply(200, { ok: true, data: { orderID: mocks.createIds.shift() || 'CART-F', usdAmount: '100.00', totalKRW: 135000 } })); return; }
    if (url === '/api/createPaypalOrder') { resolve(reply(200, { ok: true, data: { orderID: mocks.createIds.shift() || 'ORD-F', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } })); return; }
    q.push({ url, resolve });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

/** 이 화면(마운트 유지)에서 결제 → 409 order_voided → "결제 안 됨" 문구. */
async function singleMountedVoided(orderID: string) {
  mocks.createIds.push(orderID);
  render(charter());
  fireEvent.click(await screen.findByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  act(() => { void buttons[buttons.length - 1].onApprove({ orderID }); });
  await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
  await answer(q.length - 1, 409, VOIDED(orderID));
  expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
}
const otherTabCaptured = (id: string, flow: 'single' | 'cart' = 'single') => otherTab([
  [PR.doneRecoveryKey(id), null],
  [PR.orderRecoveryKey(id), JSON.stringify({ orderID: id, flow, paymentStatus: 'CAPTURED', review: false, ...(flow === 'single' ? { productType: 'charter_dmz' } : {}), updatedAt: Date.now(), createdAt: Date.now(), v: 2 })],
]);

describe('B-I6 — the "not paid" text follows its own orderID (I1a–I1e)', () => {
  it('a plain void stays: nothing else happens → the notice stays (void is not payment evidence)', async () => {
    await singleMountedVoided('ORD-A');
    await settle();
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    expect(PR.hasPaymentEvidence('ORD-A')).toBe(false);
  });
  it('I1b: voided while mounted → another tab stores A CAPTURED → notice gone at once ("Payment received" panel) → A finishes → still no "pay again"', async () => {
    await singleMountedVoided('ORD-A');
    await otherTabCaptured('ORD-A');
    expect(has(PAY_AGAIN)).toBe(false);
    expect(has('Payment received; your booking is being recorded')).toBe(true);
    await otherTabFinishes('ORD-A');
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('I1c: voided → another screen of this tab stores A CAPTURED → check → final → Done → no "pay again" for the order just confirmed', async () => {
    await singleMountedVoided('ORD-A');
    await act(async () => { PR.placeForeignPending({ orderID: 'ORD-A', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz' }); });
    await settle();
    expect(has(PAY_AGAIN)).toBe(false);
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(q.length - 1, 200, FINAL('ORD-A'));
    expect(has('Booking Confirmed!')).toBe(true);
    fireEvent.click(screen.getByText('Done')); await settle();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('a review pointer for the same order clears the notice', async () => {
    await singleMountedVoided('ORD-A');
    await act(async () => { PR.placeForeignPending({ orderID: 'ORD-A', flow: 'single', paymentStatus: 'NOT_CAPTURED', review: true, productType: 'charter_dmz' }); });
    await settle();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('a "final" done marker (confirmed / refunded) for that order clears the notice; a "void" one does not', async () => {
    await singleMountedVoided('ORD-A');
    await otherTab([[PR.doneRecoveryKey('ORD-A'), `void:${Date.now()}`]]);
    expect(has(PAY_AGAIN)).toBe(true);
    await otherTab([[PR.doneRecoveryKey('ORD-A'), String(Date.now())]]);
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('another order selected clears the notice; that order finishing never brings it back', async () => {
    await singleMountedVoided('ORD-A');
    await otherTabPending('ORD-B');
    expect(singlePanel()).toBe('ORD-B');
    expect(has(PAY_AGAIN)).toBe(false);
    await otherTabFinishes('ORD-B');
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('I1d cart: voided while mounted → another tab stores CART-A CAPTURED → notice gone → it finishes and the shared cart empties → no "pay again"', async () => {
    mocks.items = [ITEM]; mocks.createIds.push('CART-A');
    render(<CartPanel />); await openCart();
    fireEvent.click(screen.getByText('Proceed to checkout'));
    fireEvent.click(await screen.findByText('Confirm & pay'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'CART-A' }); });
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
    await answer(0, 409, VOIDED('CART-A', 'cart'));
    expect(has(PR.PAYMENT_RECOVERY_COPY.en.notCaptured)).toBe(true);
    await otherTabCaptured('CART-A', 'cart');
    expect(has(PAY_AGAIN)).toBe(false);
    await otherTabFinishes('CART-A');
    await act(async () => { mocks.items = []; for (const f of [...mocks.listeners]) f(); }); await settle();
    expect(has(PAY_AGAIN)).toBe(false);
  });
});

describe('after leaving the screen (restore screens removed — main-equivalent policy)', () => {
  it('single: unmount → capture 500 → evidence final → the order is done; a remounted screen offers Book now (a new purchase, as on main)', async () => {
    await singleCaptureThenUnmount('ORD-E');
    await answer(0, 500, GENERIC);
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(2));
    await answer(1, 200, FINAL('ORD-E'));
    render(charter()); await settle();
    expect(PR.isRecoveryDone('ORD-E')).toBe(true);
    expect(singlePanel()).toBeNull();
    expect(btn('Book now')).toBeDefined();
    expect(has(PAY_AGAIN)).toBe(false);
  });
  it('single: remounted while the capture is still in flight → the same-order panel with the check disabled (r19 kept)', async () => {
    await singleCaptureThenUnmount('ORD-E');
    render(charter()); await settle();
    expect(singlePanel()).toBe('ORD-E');
    expect(btn('Check this order')!.disabled).toBe(true);
    expect(btn('Book now')).toBeUndefined();
  });
  it('cart (logged-in): X → capture 500 → evidence final → reopen → the paid items are gone (no Confirm & pay)', async () => {
    await cartCaptureThenClose('CART-E');
    await answer(0, 500, GENERIC);
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(2));
    await answer(1, 200, FINAL('CART-E'));
    await openCart();
    expect(PR.isRecoveryDone('CART-E')).toBe(true);
    expect(has('Your cart is empty')).toBe(true);
    expect(btn('Confirm & pay')).toBeUndefined();
  });
});

describe('r22-3 — the confirmation shows the date of the order, not a date changed while paying', () => {
  it('order created for 12-05 → the screen date is changed to 12-20 while waiting → final → "Booking Confirmed!" with 12-05', async () => {
    mocks.createIds.push('ORD-D');
    const view = render(charter('charter_dmz', '2099-12-05'));
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    act(() => { void buttons[buttons.length - 1].onApprove({ orderID: 'ORD-D' }); });
    await waitFor(() => expect(q.length).toBeGreaterThanOrEqual(1));
    await act(async () => { view.rerender(charter('charter_dmz', '2099-12-20')); });
    await answer(0, 200, FINAL('ORD-D'));
    expect(has('Booking Confirmed!')).toBe(true);
    expect(has('2099-12-05')).toBe(true);
    expect(has('2099-12-20')).toBe(false);
  });
  it('an order this screen did not create (restored pointer) keeps the current screen date (unchanged behaviour)', async () => {
    PR.saveRecoveryOrder({ orderID: 'ORD-R', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    render(charter('charter_dmz', '2099-12-07')); await settle();
    fireEvent.click(screen.getByText('Check this order')); await settle();
    await answer(0, 200, FINAL('ORD-R'));
    expect(has('Booking Confirmed!')).toBe(true);
    expect(has('2099-12-07')).toBe(true);
  });
});

