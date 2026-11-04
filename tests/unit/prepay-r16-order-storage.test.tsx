// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r16 — 저장 구조 전환(Astra 설계 A): 주문별 키 + 별도 완료 표식. 실 PayPal 0.
 *   동시 P/Q 저장·삭제 · 같은 주문의 늦은 쓰기·이전 · 지연 이벤트(완료 뒤 옛 이벤트) · 저장 실패(SecurityError·Quota) ·
 *   발급 상태 전환(streaming/error/ready/DUPLICATE_ORDER) · 옛 키 이전(구버전 탭 공존) · 화면 선택(플래너·단건 상품·장바구니).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {} }));
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
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children), useNavigate: () => vi.fn() };
});

import {
  saveRecoveryOrder, finishRecoveryOrder, readRecoveryOrder, listRecoveryOrders, isRecoveryDone, orderRecoveryKey, doneRecoveryKey,
  recoveryKey, PLANNER_RECOVERY_SCOPE, markPlannerIssuePending, settlePlannerIssue, finishPaidPlannerOrder, resetPaymentRecoveryMemory,
  matchesScreen, isCurrentPointer,
} from '../../src/lib/paymentRecovery';
import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { CartCheckout } from '../../src/components/CartCheckout';

const realStorage = window.localStorage;
const planner = (onPaymentSuccess = vi.fn(async () => {})) => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />;
const charter = (productType = 'charter_dmz') => <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />;
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const P = (orderID: string, productType = 'ai_planner_full', status: 'CAPTURE_UNKNOWN' | 'CAPTURED' = 'CAPTURE_UNKNOWN') => ({ orderID, flow: 'single' as const, paymentStatus: status, review: false, productType });
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const notCaptured = (orderID: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); resetPaymentRecoveryMemory(); realStorage.clear();
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: () => ({ render: () => {}, isEligible: () => true }), FUNDING: {} };
});
afterEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { return realStorage; } });
  vi.restoreAllMocks();
  try { realStorage.clear(); } catch { /* */ }
});

describe('r16 storage layer — one key per order, done marker first', () => {
  it('P and Q saved in any interleaving stay separate; finishing P never touches Q', () => {
    saveRecoveryOrder(P('ORD-P')); saveRecoveryOrder(P('ORD-Q')); saveRecoveryOrder(P('ORD-P', 'ai_planner_full', 'CAPTURED'));
    expect(listRecoveryOrders().map((o) => o.orderID)).toEqual(['ORD-P', 'ORD-Q']);
    finishRecoveryOrder('ORD-P');
    expect(readRecoveryOrder('ORD-P')).toBeNull();
    expect(readRecoveryOrder('ORD-Q')).toMatchObject({ orderID: 'ORD-Q' });
    expect(realStorage.getItem(doneRecoveryKey('ORD-P'))).not.toBeNull();
    expect(realStorage.getItem(orderRecoveryKey('ORD-P'))).toBeNull();
  });
  it('createdAt is fixed on the first save and kept by later updates (stable order); v is recorded', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000); saveRecoveryOrder(P('ORD-B'));
    vi.spyOn(Date, 'now').mockReturnValue(2000); saveRecoveryOrder(P('ORD-A'));
    vi.spyOn(Date, 'now').mockReturnValue(3000); saveRecoveryOrder(P('ORD-B', 'ai_planner_full', 'CAPTURED'));
    expect(readRecoveryOrder('ORD-B')).toMatchObject({ createdAt: 1000, updatedAt: 3000, v: 2, paymentStatus: 'CAPTURED' });
    expect(listRecoveryOrders().map((o) => o.orderID)).toEqual(['ORD-B', 'ORD-A']);
  });
  it('a late write of a finished order (this code or an old tab writing the order key) never revives it', () => {
    saveRecoveryOrder(P('ORD-P'));
    finishRecoveryOrder('ORD-P');
    expect(saveRecoveryOrder(P('ORD-P', 'ai_planner_full', 'CAPTURED'))).toBeNull();
    realStorage.setItem(orderRecoveryKey('ORD-P'), JSON.stringify({ ...P('ORD-P'), updatedAt: 9 })); // 늦은 실제 쓰기
    expect(readRecoveryOrder('ORD-P')).toBeNull();
    expect(isRecoveryDone('ORD-P')).toBe(true);
  });
  it('legacy scope keys are read (old tab alive), never deleted; a finished legacy order stays hidden; a new legacy order from an old tab appears', () => {
    const legacy = JSON.stringify({ ...P('ORD-L'), updatedAt: 5 });
    realStorage.setItem(recoveryKey('single'), legacy);
    expect(readRecoveryOrder('ORD-L')).toMatchObject({ orderID: 'ORD-L', productType: 'ai_planner_full' });
    finishRecoveryOrder('ORD-L');
    expect(realStorage.getItem(recoveryKey('single'))).toBe(legacy); // 옛 키는 그대로(구버전 탭이 읽을 수 있음)
    expect(readRecoveryOrder('ORD-L')).toBeNull();
    realStorage.setItem(recoveryKey('single', PLANNER_RECOVERY_SCOPE), JSON.stringify({ ...P('ORD-N'), updatedAt: 6 })); // 구버전 탭의 새 주문
    expect(listRecoveryOrders().map((o) => o.orderID)).toEqual(['ORD-N']);
  });
  it('an order on both a legacy key and its order key appears once (order key wins)', () => {
    realStorage.setItem(recoveryKey('single', PLANNER_RECOVERY_SCOPE), JSON.stringify({ ...P('ORD-D'), updatedAt: 1 }));
    saveRecoveryOrder(P('ORD-D', 'ai_planner_full', 'CAPTURED'));
    expect(listRecoveryOrders()).toHaveLength(1);
    expect(readRecoveryOrder('ORD-D')?.paymentStatus).toBe('CAPTURED');
  });
  it('Quota: writes fail → tab memory (persisted:false); done marker fails → stored original kept, hidden in this tab only', () => {
    saveRecoveryOrder(P('ORD-S')); // 정상 저장된 원본
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(saveRecoveryOrder(P('ORD-M'))).toMatchObject({ orderID: 'ORD-M', persisted: false });
    expect(readRecoveryOrder('ORD-M')).toMatchObject({ persisted: false });
    expect(finishRecoveryOrder('ORD-S')).toBe(false);
    expect(realStorage.getItem(orderRecoveryKey('ORD-S'))).not.toBeNull(); // 원본 보존
    expect(readRecoveryOrder('ORD-S')).toBeNull(); // 이 탭에선 끝남
  });
  it('SecurityError (storage unreadable): orders live in tab memory; isCurrentPointer still holds for this tab', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    const saved = saveRecoveryOrder(P('ORD-X', 'charter_dmz'));
    expect(saved).toMatchObject({ persisted: false });
    expect(isCurrentPointer(saved, saved)).toBe(true);
    finishRecoveryOrder('ORD-X');
    expect(listRecoveryOrders()).toEqual([]);
  });
  it('screen selection: planner ↔ planner product, single ↔ same product or unknown, cart ↔ cart', () => {
    const plan = P('A', 'ai_planner_full'); const dmz = P('B', 'charter_dmz'); const none = { ...P('C'), productType: undefined }; const cart = { orderID: 'D', flow: 'cart' as const, paymentStatus: 'CAPTURE_UNKNOWN' as const, review: false };
    expect([plan, dmz, none, cart].map((o) => matchesScreen(o, { flow: 'single', planner: true }))).toEqual([true, false, false, false]);
    expect([plan, dmz, none, cart].map((o) => matchesScreen(o, { flow: 'single', productType: 'charter_dmz' }))).toEqual([false, true, true, false]);
    expect([plan, dmz, none, cart].map((o) => matchesScreen(o, { flow: 'single', productType: 'tour_dmz' }))).toEqual([false, false, true, false]);
    expect([plan, dmz, none, cart].map((o) => matchesScreen(o, { flow: 'cart' }))).toEqual([false, false, false, true]);
  });
});

describe('r16 screens — one panel per screen, next order picked when one ends', () => {
  it('planner with P (older) and Q: shows P; P NOT_CAPTURED → Q at once, never Book now; Q is untouched', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000); saveRecoveryOrder(P('ORD-P'));
    vi.spyOn(Date, 'now').mockReturnValue(2000); saveRecoveryOrder(P('ORD-Q', 'ai_planner_full', 'CAPTURED'));
    vi.restoreAllMocks();
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/capturePaypalOrder') return reply(409, notCaptured('ORD-P')); throw new Error(`OFFLINE ${url}`); });
    render(planner());
    expect(shownOrder()).toBe('ORD-P');
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBe('ORD-Q');
    expect(screen.queryByText('Book now')).toBeNull();
    expect(readRecoveryOrder('ORD-Q')).toMatchObject({ paymentStatus: 'CAPTURED' });
  });
  it('another tab finishes the shown order (done marker + storage event) → the screen re-reads and moves on; a delayed stale event cannot bring it back', async () => {
    saveRecoveryOrder(P('ORD-P', 'charter_dmz'));
    render(charter());
    expect(shownOrder()).toBe('ORD-P');
    const staleValue = realStorage.getItem(orderRecoveryKey('ORD-P'));
    await act(async () => {
      realStorage.setItem(doneRecoveryKey('ORD-P'), '1'); realStorage.removeItem(orderRecoveryKey('ORD-P'));
      window.dispatchEvent(new StorageEvent('storage', { key: orderRecoveryKey('ORD-P'), oldValue: staleValue, newValue: null }));
    });
    expect(shownOrder()).toBeNull();
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: orderRecoveryKey('ORD-P'), oldValue: null, newValue: staleValue })); }); // 지연된 옛 이벤트
    expect(shownOrder()).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
  });
  it('a charter page does not show a tour order; a cart page does not show single orders', () => {
    saveRecoveryOrder(P('ORD-T', 'tour_dmz'));
    render(charter());
    expect(shownOrder()).toBeNull();
    cleanup();
    render(<CartCheckout onClose={() => {}} />);
    expect(screen.queryByText('Check this order')).toBeNull();
    expect(screen.getByText('Confirm & pay')).toBeInTheDocument();
  });
  it('the planner screen picks up a legacy shared-key planner order (transition), final → onPaymentSuccess once', async () => {
    realStorage.setItem(recoveryKey('single'), JSON.stringify({ ...P('ORD-L'), updatedAt: 1 }));
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/capturePaypalOrder') return reply(200, final('ORD-L')); throw new Error(`OFFLINE ${url}`); });
    const success = vi.fn(async () => {});
    render(planner(success));
    expect(shownOrder()).toBe('ORD-L');
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(success).toHaveBeenCalledWith('ORD-L');
    expect(readRecoveryOrder('ORD-L')).toMatchObject({ paymentStatus: 'CAPTURED' }); // 발급까지 유지(CAPTURED 만으로 완료 아님)
  });
});

describe('r16 planner issue transitions', () => {
  it('streaming keeps both; error removes the issue only; ready finishes the order and every issue linked to it', () => {
    saveRecoveryOrder(P('ORD-I', 'ai_planner_full', 'CAPTURED'));
    markPlannerIssuePending('plan-1', 'ORD-I'); markPlannerIssuePending('plan-2', 'ORD-I');
    settlePlannerIssue('plan-1', 'streaming');
    expect(readRecoveryOrder('ORD-I')).not.toBeNull();
    expect(realStorage.getItem('cocotrip:payment-recovery:issue:plan-1')).toBe('ORD-I');
    settlePlannerIssue('plan-1', 'error');
    expect(realStorage.getItem('cocotrip:payment-recovery:issue:plan-1')).toBeNull();
    expect(readRecoveryOrder('ORD-I')).not.toBeNull();
    settlePlannerIssue('plan-2', 'ready');
    expect(readRecoveryOrder('ORD-I')).toBeNull();
    expect(isRecoveryDone('ORD-I')).toBe(true);
    expect(realStorage.getItem('cocotrip:payment-recovery:issue:plan-2')).toBeNull();
  });
  it('DUPLICATE_ORDER / saved 200 path (finishPaidPlannerOrder) = done marker + linked issues cleared', () => {
    saveRecoveryOrder(P('ORD-U', 'ai_planner_full', 'CAPTURED'));
    markPlannerIssuePending('plan-9', 'ORD-U');
    finishPaidPlannerOrder('ORD-U');
    expect(isRecoveryDone('ORD-U')).toBe(true);
    expect(realStorage.getItem('cocotrip:payment-recovery:issue:plan-9')).toBeNull();
  });
  it('CAPTURED alone never finishes a planner order', () => {
    saveRecoveryOrder(P('ORD-C', 'ai_planner_full', 'CAPTURED'));
    expect(readRecoveryOrder('ORD-C')).not.toBeNull();
    expect(isRecoveryDone('ORD-C')).toBe(false);
  });
});
