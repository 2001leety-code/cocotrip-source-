// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r5 — 같은 주문 확인의 중간 단계가 상품·흐름을 덮어쓰지 않는다 + QR 노출 뒤 재결제 권유 금지.
 *   Astra r4 P1-1·P1-2 · 적대적 r4 major(X1·X1b·X2·X2-review·X3·relabel A/A2) 재현을 뒤집은 회귀. 실 PayPal·paypal.me 0.
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
import { recoveryKey, readRecoveryOrder } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const SHARED = recoveryKey('single');
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '9.90', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const pending = (orderID: string, extra: Record<string, unknown> = {}) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false, ...extra });
const review = (orderID: string) => ({ ok: false, bookingStatus: 'PAYMENT_REVIEW', paymentCaptured: true, captureID: 'CAP1', orderID });
const pointer = (orderID: string, productType: string) => JSON.stringify({ orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType, updatedAt: 1 });

/** capture 응답 순서(마지막 값 반복). 'NETWORK' = fetch 실패(reconcilePayment 가 pending 으로 본다). */
function captures(seq: unknown[], extra: (url: string) => unknown = () => null) {
  let i = 0;
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/capturePaypalOrder') {
      const v = seq[Math.min(i++, seq.length - 1)];
      if (v === 'NETWORK') throw new TypeError('Failed to fetch');
      return reply(v && (v as { code?: string }).code === 'PAYMENT_RECOVERY_PENDING' ? 202 : 200, v);
    }
    const r = extra(url); if (r) return r;
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}
const check = async () => { await act(async () => { fireEvent.click(screen.getByText('Check this order')); }); };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

describe('r5-1 — intermediate check results keep the restored pointer\'s product and flow', () => {
  it.each([
    ['X1 tour pointer, charter page, pending', 'ORD-T', 'tour_dmz_day', 'charter_dmz', pending('ORD-T')],
    ['X2 legacy planner pointer, charter page, pending', 'ORD-P', 'ai-planner-full', 'charter_dmz', pending('ORD-P')],
    ['X2-review legacy planner pointer, charter page, PAYMENT_REVIEW', 'ORD-P', 'ai-planner-full', 'charter_dmz', review('ORD-P')],
    ['X3 legacy planner pointer, K-pop page, network error', 'ORD-P', 'ai-planner-full', 'kpop_shuttle_oneway', 'NETWORK'],
    ['relabel auth_required, tour page', 'ORD-P', 'ai-planner-full', 'tour_dmz_day', { ok: false, code: 'RECOVERY_AUTH_REQUIRED' }],
  ])('%s → Check → final: neutral notice, never this page\'s confirmation', async (_label, orderID, owner, page, middle) => {
    // r16: 다른 상품(투어·플래너) 주문은 이 화면에 선택되지 않는다 — 패널 없이 Book now, 서버 409(그 주문 미결) → 중립 안내.
    //   그 주문은 원래 상품·flow 그대로 남는다(이 화면 상품으로 바뀌지 않음).
    localStorage.setItem(SHARED, pointer(orderID, owner));
    captures([middle, final(orderID)], (url) => (url === '/api/createPaypalOrder' ? reply(409, pending(orderID, { productType: owner })) : null));
    const onPaymentSuccess = vi.fn();
    render(<PayPalBookingButton productType={page} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.queryByText('Check this order')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Book now')); });
    expect(await screen.findByText(new RegExp(`Another order \\(${orderID}\\) in this browser is still being confirmed`))).toBeInTheDocument();
    expect(readRecoveryOrder(orderID)).toMatchObject({ orderID, productType: owner, flow: 'single' });
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    expect(onPaymentSuccess).not.toHaveBeenCalled();

    // r16: 중간 단계가 상품을 덮지 않는다는 원래 회귀는 이 화면이 맡는 '상품 미상' 주문으로 — 이 화면 상품으로 재표기되지 않고, final 은 중립 안내.
    cleanup(); localStorage.clear();
    localStorage.setItem(SHARED, JSON.stringify({ orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    captures([middle, final(orderID)]);
    render(<PayPalBookingButton productType={page} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    await check();
    const kept = readRecoveryOrder(orderID);
    expect(kept).toMatchObject({ orderID, flow: 'single' });
    expect(kept?.productType).toBeUndefined();
    // review 화면·auth_required(같은 기기 전용 — 확인 버튼 비활성)는 포인터 보존과 거짓 확정 없음만 확인
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) {
      await check();
      expect(await screen.findByText(new RegExp(`different order \\(${orderID}\\)`))).toBeInTheDocument();
      expect(screen.queryByText('Booking Confirmed!')).toBeNull();
      expect(onPaymentSuccess).not.toHaveBeenCalled();
    }
  });
  it('relabel A2: charter page WITHOUT onPaymentSuccess → no "Booking Confirmed!"; the planner page then offers "Check this order", not "Book now"', async () => {
    localStorage.setItem(SHARED, pointer('ORD-P', 'ai-planner-full'));
    // r16: 차터 화면은 플래너 주문을 맡지 않는다 — Book now → 409(미결 플래너 주문) → 중립 안내, 기사 안내·확정 없음.
    captures([pending('ORD-P'), final('ORD-P')], (url) => (url === '/api/createPaypalOrder' ? reply(409, pending('ORD-P', { productType: 'ai-planner-full' })) : null));
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.queryByText('Check this order')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Book now')); });
    expect(await screen.findByText(/Another order \(ORD-P\) in this browser is still being confirmed/)).toBeInTheDocument();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    expect(screen.queryByText(/Driver details/)).toBeNull();
    cleanup();
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('X1b: create 409 names a tour order on the charter page → pending → final → neutral notice', async () => {
    captures([pending('ORD-T'), final('ORD-T')], (url) => (url === '/api/createPaypalOrder' ? reply(409, pending('ORD-T', { productType: 'tour_dmz_day' })) : null));
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    await act(async () => { fireEvent.click(screen.getByText('Book now')); });
    // r16: 투어 주문은 그 주문 키에 투어 상품 그대로 — 차터 화면은 맡지 않고(패널·확인 버튼 없음) 미결 중립 안내만, 다시 결제 경로 없음.
    expect(await screen.findByText(/Another order \(ORD-T\) in this browser is still being confirmed/)).toBeInTheDocument();
    expect(readRecoveryOrder('ORD-T')).toMatchObject({ productType: 'tour_dmz_day', flow: 'single' });
    expect(screen.queryByText('Check this order')).toBeNull();
    expect(screen.queryByText('Book now')).toBeNull();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
  });
  it('a NEW payment on this page still records this page\'s product (fresh path unchanged)', async () => {
    captures(['NETWORK'], (url) => (url === '/api/createPaypalOrder' ? reply(200, { ok: true, data: { orderID: 'ORD-N', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } }) : null));
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons).toHaveLength(1));
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-N' }); });
    expect(readRecoveryOrder('ORD-N')).toMatchObject({ orderID: 'ORD-N', productType: 'charter_dmz' }); // r16: 주문별 키
  });
});

describe('r5-2 — after a QR was shown, no NOT_CAPTURED answer invites a new payment', () => {
  const plannerInput = { regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3 };
  it.each([
    ['order-VOIDED', 'Payment was not completed (order-VOIDED). You can start a new payment.'],
    ['no_attempt_record', 'Payment was not completed (no_attempt_record). You can start a new payment.'],
  ])('QR shown → Back → SDK order → capture NOT_CAPTURED (%s) → "Do not pay again", QR report path kept', async (_reason, message) => {
    let createCalls = 0;
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') {
        createCalls += 1;
        return createCalls === 1 ? reply(500, { ok: false, error: 'boom' })
          : reply(200, { ok: true, data: { orderID: 'ORD-Q', usdAmount: '9.90', krwAmount: 14000, currentRate: 1400, displayKRW: '14,000', displayUSD: '$9.90' } });
      }
      if (url === '/api/capturePaypalOrder') return reply(409, { ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: 'ORD-Q', flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true, error: message });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })) as never;
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled plannerInput={plannerInput} onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />);
    fireEvent.click(screen.getByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-Q' }); });
    expect(await screen.findByText('Do not pay again. It may result in a duplicate charge.')).toBeInTheDocument();
    expect(screen.queryByText(/You can start a new payment/)).toBeNull();
    expect(screen.queryByText(/not been charged/)).toBeNull();
    expect(screen.getByText('Pay via QR (PayPal direct redirect)')).toBeInTheDocument();
  });
});
