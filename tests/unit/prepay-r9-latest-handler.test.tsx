// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r9 — Astra r8 (P1 1 + P3 1). 실 PayPal 0.
 *   1) 자동 증거 조회·'같은 주문 확인' 응답은 **도착 시점의 최신** 처리 함수로 적용 — 조회 도중 상품을 바꾸면(편도 → 왕복)
 *      바뀐 화면에 "예약 확정"이 아니라 중립 "다른 주문" 안내.
 *   2) onPaymentSuccess 는 주문별 1회 — 자동 증거 조회와 수동 확인이 동시에 final 이어도.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { removePaymentRecovery, PLANNER_RECOVERY_SCOPE } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const pending = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false });
const createOk = (orderID: string) => reply(200, { ok: true, data: { orderID, usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });

/** capture 응답: 함수면 그 Promise 를 기다린다(조회 도중 화면을 바꾸기 위해). */
function captures(seq: Array<[number, unknown] | (() => Promise<[number, unknown]>)>) {
  let i = 0;
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/createPaypalOrder') return createOk('ORD-1');
    if (url === '/api/capturePaypalOrder') {
      const item = seq[Math.min(i++, seq.length - 1)];
      const [s, b] = typeof item === 'function' ? await item() : item;
      return reply(s, b);
    }
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}
function deferred() {
  let resolve!: (v: [number, unknown]) => void;
  const promise = new Promise<[number, unknown]>((r) => { resolve = r; });
  return { promise, resolve };
}
const button = (productType: string, onPaymentSuccess: () => void) => (
  <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />
);
async function openButtons() {
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r9-1 — a lookup answer is applied with the handler that is current when it arrives', () => {
  it('① capture error → automatic evidence lookup in flight → product switched → final → neutral notice, no success', async () => {
    const d = deferred();
    captures([[500, { ok: false, error: 'Payment failed' }], () => d.promise]);
    const success = vi.fn();
    const view = render(button('charter_oneway', success));
    await openButtons();
    let approving!: Promise<void>;
    act(() => { approving = buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    await waitFor(() => expect(mocks.authFetch.mock.calls.filter(([u]) => u === '/api/capturePaypalOrder').length).toBe(2)); // 증거 조회 시작
    view.rerender(button('charter_roundtrip', success)); // 조회 도중 상품 변경
    await act(async () => { d.resolve([200, final('ORD-1')]); await approving; });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });
  it('② pending → "Check this order" in flight → product switched → final → neutral notice, no success', async () => {
    const d = deferred();
    captures([[202, pending('ORD-1')], () => d.promise]);
    const success = vi.fn();
    const view = render(button('charter_oneway', success));
    await openButtons();
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    fireEvent.click(await screen.findByText('Check this order'));
    view.rerender(button('charter_roundtrip', success));
    await act(async () => { d.resolve([200, final('ORD-1')]); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });
  it.each([['capture error → evidence', [[500, { ok: false, error: 'Payment failed' }], [200, final('ORD-1')]]], ['pending → check', [[202, pending('ORD-1')], [200, final('ORD-1')]]]] as Array<[string, Array<[number, unknown]>]>)(
    'no switch (%s) → success once', async (name, seq) => {
      captures(seq);
      const success = vi.fn();
      render(button('charter_oneway', success));
      await openButtons();
      await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
      if (name.startsWith('pending')) await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
      await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
      expect(success).toHaveBeenCalledWith('ORD-1');
    });
});

describe('r9-2 — onPaymentSuccess never overlaps for one order, but a legitimate re-delivery still runs', () => {
  it('automatic evidence lookup and a manual check both answer final while the callback is in flight → callback once', async () => {
    const auto = deferred();
    const manual = deferred();
    captures([[500, { ok: false, error: 'Payment failed' }], () => auto.promise, () => manual.promise]);
    let finishIssuance!: () => void;
    const issuing = new Promise<void>((r) => { finishIssuance = r; });
    const success = vi.fn(() => issuing); // 플랜 발급처럼 오래 걸리는 콜백(진행 중)
    render(button('charter_oneway', success));
    await openButtons();
    let approving!: Promise<void>;
    act(() => { approving = buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    fireEvent.click(await screen.findByText('Check this order')); // 자동 조회 진행 중 수동 확인
    await waitFor(() => expect(mocks.authFetch.mock.calls.filter(([u]) => u === '/api/capturePaypalOrder').length).toBe(3));
    await act(async () => { auto.resolve([200, final('ORD-1')]); manual.resolve([200, final('ORD-1')]); await new Promise((r) => setTimeout(r, 10)); });
    expect(success).toHaveBeenCalledTimes(1);
    await act(async () => { finishIssuance(); await approving; });
    expect(success).toHaveBeenCalledTimes(1);
  });
  it('planner: CAPTURED → issuance failed (callback done, pointer kept) → "Check this order" → final → callback again (2 total)', async () => {
    captures([[200, final('ORD-1')], [200, final('ORD-1')]]);
    const success = vi.fn(async () => {}); // 발급 실패를 콜백 안에서 처리(포인터는 호출자가 지우지 않음)
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    await openButtons();
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    expect(success).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    await waitFor(() => expect(success).toHaveBeenCalledTimes(2));
  });
});

describe('r9-3 — a legacy shared-key planner pointer that could not move (Quota) is removed once the order is resolved', () => {
  it('N7b: shared ORD-P + setItem Quota → Check → NOT_CAPTURED → shared key gone → remount shows Book now, no panel', async () => {
    const SHARED = 'cocotrip:payment-recovery:single';
    localStorage.setItem(SHARED, JSON.stringify({ orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'ai_planner_full', updatedAt: 1 }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/capturePaypalOrder') return reply(409, { ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: 'ORD-P', flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    const planner = () => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />;
    render(planner());
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(localStorage.getItem(SHARED)).toBeNull();
    cleanup();
    render(planner());
    expect(screen.queryByText('Check this order')).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
  });
  it('another order / a non-planner product on the shared key is left alone', () => {
    // 공용 키의 다른 주문(차터) — 플래너 범위 삭제가 건드리지 않는다.
    const SHARED = 'cocotrip:payment-recovery:single';
    const other = JSON.stringify({ orderID: 'ORD-C', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz', updatedAt: 1 });
    localStorage.setItem(SHARED, other);
    removePaymentRecovery('single', 'ORD-C', PLANNER_RECOVERY_SCOPE);
    expect(localStorage.getItem(SHARED)).toBe(other);
  });
});
