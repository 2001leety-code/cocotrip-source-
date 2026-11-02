// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r4 — 결제 복구 화면 회귀(Astra r3 P1-1·P1-2, 적대적 r3 G·C minor). 실 PayPal·paypal.me 호출 0 (authFetch·fetch·SDK mock).
 *   1 배포 전 번들이 공용 키에 남긴 플래너 포인터 → 플래너 키로 이전 → 처음부터 '같은 주문 확인' → final 이면 플랜 발급 재시도.
 *   2 다른 상품 화면(차터·투어·K-pop·InlineBookingCard)이 플래너 주문을 자기 결제로 확정하지 않는다('Booking Confirmed!' 금지).
 *   8 QR 을 본 뒤 Back → 다시 'Pay via QR' 해도 재검사 없이 같은 예약 번호·신고 버튼, '결제 안 됨' 단정 없음.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, readRecoveryOrder } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '9.90', currency: 'USD', payerName: 'Pay Er', payerEmail: 'payer@example.invalid' } });
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const plannerPointer = (paymentStatus = 'CAPTURE_UNKNOWN', extra: Record<string, unknown> = {}) => JSON.stringify({ orderID: 'ORD-P', flow: 'single', paymentStatus, review: false, productType: 'ai-planner-full', updatedAt: 1, ...extra });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

const planner = (onPaymentSuccess = vi.fn(async () => {}), extra: Record<string, unknown> = {}) => render(
  <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={onPaymentSuccess}
    p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} {...extra} />);

describe('r4-1 — legacy planner pointer in the shared key is migrated to the planner scope', () => {
  it('main-bundle seed {CAPTURE_UNKNOWN, ai-planner-full} → "Check this order" from the first render → final → plan issuance retried', async () => {
    localStorage.setItem(SHARED, plannerPointer());
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/capturePaypalOrder') return reply(200, final('ORD-P'));
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    const onPaymentSuccess = vi.fn(async () => {});
    planner(onPaymentSuccess);
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    // r16: 옛 공용 키는 읽기만(이전·삭제 없음) — 플래너 화면이 그 주문을 그대로 맡는다.
    expect(localStorage.getItem(SHARED)).not.toBeNull();
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P' });
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(onPaymentSuccess).toHaveBeenCalledWith('ORD-P'));
  });
  it('a shared pointer of another product is left alone', () => {
    localStorage.setItem(SHARED, JSON.stringify({ orderID: 'ORD-C', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz', updatedAt: 1 }));
    planner();
    expect(screen.getByText('Book now')).toBeInTheDocument();
    expect(localStorage.getItem(SHARED)).not.toBeNull();
  });
});

describe('r4-2 — other products never confirm a planner order as their own (Astra scenario)', () => {
  it.each([['charter_dmz'], ['tour_dmz_day'], ['kpop_dance_class'], ['charter_custom_estimate']])(
    '%s: planner-scoped unknown order → create 409 PAYMENT_RECOVERY_PENDING (planner) → neutral notice, no adoption, no confirmation', async (productType) => {
      localStorage.setItem(PLANNER, plannerPointer());
      mocks.authFetch.mockImplementation(async (url: string) => {
        if (url === '/api/createPaypalOrder') return reply(409, { ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'ai-planner-full', finalized: false });
        if (url === '/api/capturePaypalOrder') return reply(200, final('ORD-P')); // 늦은 플래너 COMPLETED
        throw new Error(`OFFLINE: unexpected ${url}`);
      });
      const onPaymentSuccess = vi.fn();
      render(<PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
      fireEvent.click(screen.getByText('Book now'));
      expect(await screen.findByText(/Another order \(ORD-P\) in this browser is still being confirmed/)).toBeInTheDocument();
      expect(screen.queryByText('Check this order')).toBeNull();
      expect(screen.queryByText('Booking Confirmed!')).toBeNull();
      expect(onPaymentSuccess).not.toHaveBeenCalled();
      expect(localStorage.getItem(SHARED)).toBeNull();
      expect(JSON.parse(localStorage.getItem(PLANNER) || 'null')).toMatchObject({ orderID: 'ORD-P', productType: 'ai-planner-full' });
    });
  it('an old shared pointer with NO product (or a planner one) on a charter page → never this page\'s confirmation; the planner order stays for the planner page', async () => {
    // r16: 플래너 주문은 플래너 화면만 맡는다 — 차터 화면엔 패널이 없고 Book now → 서버 409(미결 플래너 주문) → 중립 안내.
    localStorage.setItem(SHARED, plannerPointer('CAPTURE_UNKNOWN'));
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return reply(409, { ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'ai-planner-full', finalized: false });
      if (url === '/api/capturePaypalOrder') return reply(200, final('ORD-P'));
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    const onPaymentSuccess = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.queryByText('Check this order')).toBeNull();
    fireEvent.click(screen.getByText('Book now'));
    expect(await screen.findByText(/Another order \(ORD-P\) in this browser is still being confirmed/)).toBeInTheDocument();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    expect(onPaymentSuccess).not.toHaveBeenCalled();
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P', productType: 'ai-planner-full' });
    cleanup();
    planner(); // r16: 플래너 화면은 그 주문을 '같은 주문 확인'으로 맡는다(새 결제 아님)
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();

    cleanup(); localStorage.clear();
    localStorage.setItem(SHARED, JSON.stringify({ orderID: 'ORD-X', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    mocks.authFetch.mockImplementation(async () => reply(200, final('ORD-X')));
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    expect(await screen.findByText(/different order \(ORD-X\)/)).toBeInTheDocument();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
  });
});

describe('r4-8 — QR remount keeps the report path (adversarial qrremount repro)', () => {
  it('check passes → QR + report → Back → Book now fails → Pay via QR again with a failing re-check → same booking ref, report still there, never "not charged"', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return reply(500, { ok: false, error: 'boom' });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })) as never;
    planner(vi.fn(async () => {}), { plannerInput: { regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3 } });
    fireEvent.click(screen.getByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    const firstRef = (screen.getAllByText(/^CT-\d{8}-\d{3}$/)[0] as HTMLElement).textContent;

    // (송금) → Back → 재검사가 실패하는 상황(통신 실패)
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as never;
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(await screen.findByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    expect((screen.getAllByText(/^CT-\d{8}-\d{3}$/)[0] as HTMLElement).textContent).toBe(firstRef);
    expect(screen.queryByText(/You have not been charged/)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled(); // 재검사 없음
  });
  it('after a QR was shown, a later prepay refusal from the PayPal order neither hides QR nor claims "not charged"', async () => {
    let createCalls = 0;
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') {
        createCalls += 1;
        return createCalls === 1 ? reply(500, { ok: false, error: 'boom' }) : reply(400, { ok: false, code: 'PLANNER_DATE_TOO_SOON', error: 'Start date must be tomorrow or later' });
      }
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })) as never;
    planner(vi.fn(async () => {}), { plannerInput: { regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3 } });
    fireEvent.click(screen.getByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(await screen.findByText('Book now')); });
    expect(await screen.findByText('Pay via QR (PayPal direct redirect)')).toBeInTheDocument();
    expect(screen.queryByText(/not been charged/)).toBeNull();
  });
});
