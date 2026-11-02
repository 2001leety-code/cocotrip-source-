// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r8 — Astra r7 (P1 2 + P2 1). 실 PayPal 0.
 *   1) 이 화면이 만든 주문(fresh·own 증거)도 생성 당시 상품과 지금 화면 상품을 대조 — 결제 대기 중 상품을 바꾸면 성공 대신 "다른 주문" 안내.
 *   2) 옛 플래너 포인터를 전용 키로 옮기다 저장 실패 → persisted:false → 같은 주문 확인이 성공 1회(영구 차단 아님).
 *   3) 이 탭 쓰기 실패(Quota) 뒤 다른 탭이 새 주문을 저장 → 이벤트 전에 도착한 옛 주문 pending 응답이 새 주문을 덮지 않는다.
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, readRecoveryOrder, resetPaymentRecoveryMemory } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const pending = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false });
const createOk = (orderID: string) => reply(200, { ok: true, data: { orderID, usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });
const quota = () => { throw new DOMException('quota', 'QuotaExceededError'); };
const SINGLE = recoveryKey('single');

/** capture 응답 순서(첫 = onApprove capture, 이후 = reconcile). */
function captures(seq: Array<[number, unknown]>, orderID = 'ORD-1') {
  let i = 0;
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/createPaypalOrder') return createOk(orderID);
    if (url === '/api/capturePaypalOrder') { const [s, b] = seq[Math.min(i++, seq.length - 1)]; return reply(s, b); }
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}
const button = (productType: string, onPaymentSuccess: () => void) => (
  <PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />
);

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0;
  resetPaymentRecoveryMemory(); // r16: setItem Quota mock → 모듈 메모리 주문 — 테스트 간 누수 방지
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r8-1 — the order\'s product at creation is compared with the product on screen (fresh and own evidence)', () => {
  const pairs: Array<[string, string]> = [['charter_oneway', 'charter_roundtrip'], ['kpop_concert_oneway', 'kpop_concert_roundtrip'], ['tour_dmz', 'tour_dmz_private']];
  it.each(pairs)('%s approved → switched to %s while waiting → capture error → own evidence final → "different order" notice, no success', async (from, to) => {
    captures([[500, { ok: false, error: 'Payment failed' }], [200, final('ORD-1')]]);
    const success = vi.fn();
    const view = render(button(from, success));
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    view.rerender(button(to, success)); // 결제 대기 중 상품 변경
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });
  it('switched product + direct final on the fresh capture → "different order" notice, no success', async () => {
    captures([[200, final('ORD-1')]]);
    const success = vi.fn();
    const view = render(button('charter_oneway', success));
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    view.rerender(button('charter_roundtrip', success));
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });
  it.each([[[[200, final('ORD-1')]]], [[[500, { ok: false, error: 'Payment failed' }], [200, final('ORD-1')]]]] as Array<[Array<[number, unknown]>]>)(
    'no switch → success once (seq %#)', async (seq) => {
      captures(seq);
      const success = vi.fn();
      render(button('charter_oneway', success));
      fireEvent.click(screen.getByText('Book now'));
      await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
      await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
      await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
      expect(success).toHaveBeenCalledWith('ORD-1');
    });
});

describe('r8-2 — legacy planner pointer: moving it to the planner key fails → check still succeeds once', () => {
  it('shared-key planner order → planner-key setItem Quota → Check → final → onPaymentSuccess once', async () => {
    localStorage.setItem(SINGLE, JSON.stringify({ orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'ai_planner_full', updatedAt: 1 }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(quota);
    captures([[200, final('ORD-P')]], 'ORD-P');
    const success = vi.fn(async () => {});
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    // r16: 이동 자체가 없다 — 옛 공용 키는 읽기만(삭제·이전 없음), 플래너 화면이 그대로 맡는다.
    expect(localStorage.getItem(recoveryKey('single', PLANNER_RECOVERY_SCOPE))).toBeNull();
    expect(localStorage.getItem(SINGLE)).not.toBeNull();
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('ORD-P');
  });
});

describe('r8-3 — a never-persisted pointer still reads a readable storage: another tab\'s new order is not overwritten', () => {
  it('OLD write fails → other tab saves NEW (no event yet) → late OLD pending → NEW kept', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(quota);
    captures([[202, pending('ORD-OLD')], [202, pending('ORD-OLD')]], 'ORD-OLD');
    render(button('charter_oneway', vi.fn()));
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-OLD' }); });
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    spy.mockRestore();
    const NEW = JSON.stringify({ orderID: 'ORD-NEW', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'tour_dmz', updatedAt: 2 });
    localStorage.setItem(SINGLE, NEW); // 다른 탭(StorageEvent 전)
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(localStorage.getItem(SINGLE)).toBe(NEW);
    // r16: 주문별 저장 — NEW 는 그대로, OLD 도 자기 주문으로 남는다(어느 쪽도 덮이거나 사라지지 않음).
    expect(readRecoveryOrder('ORD-NEW')).toMatchObject({ productType: 'tour_dmz' });
    expect(readRecoveryOrder('ORD-OLD')).toMatchObject({ productType: 'charter_oneway' });
  });
});
