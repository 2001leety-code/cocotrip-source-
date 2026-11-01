// @vitest-environment jsdom
/**
 * 2026-11-01 B6-1 r18 — Astra r17 (no_attempt_record 주변 P1 2 + P3 1). 실 PayPal 0.
 *   1) 옛 키에 있는 주문도 no_attempt_record 로 완료 표식이 생기지 않는다(옛 키 존재 ≠ 종료 증거) — 다음 조회 때 복사돼 패널이 돌아온다.
 *   2) 확인을 시작한 뒤 CAPTURED 가 저장되고 그 다음 늦은 no_attempt 가 오면 주문을 지우지 않는다(단건·장바구니).
 *   3) 빈 장바구니 + 미해결 주문 → 확정 → 결과 화면(완료 안내·Done)이 닫을 때까지 유지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}), items: [] as unknown[] }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null, trackPlannerOutcomeFromStatus: () => {} }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: mocks.items, clear: mocks.clear, remove: vi.fn(), add: vi.fn(), isInCart: () => false, loading: false }) }));
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

import { recoveryKey, readRecoveryOrder, saveRecoveryOrder, isRecoveryDone, finishRecoveryOrder, resetPaymentRecoveryMemory } from '../../src/lib/paymentRecovery';
import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { CartPanel } from '../../src/components/CartButton';

const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const NOT_DONE = 'Payment was not completed. You can start a new payment.';
const noAttempt = (orderID: string, flow = 'single') => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, evidence: 'no_attempt_record', error: NOT_DONE });
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const booking = () => <PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />;
/** 확인 요청을 붙잡아 두는 서버 — answer 로 나중에 답한다. */
function heldCheck(url: string) {
  let answer!: (v: unknown) => void;
  mocks.authFetch.mockImplementation(async (u: string) => { if (u === url) return new Promise((r) => { answer = r; }); throw new Error(`OFFLINE ${u}`); });
  return (v: unknown) => answer(v);
}
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); resetPaymentRecoveryMemory(); localStorage.clear(); mocks.items = [];
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: () => ({ render: () => {}, isEligible: () => true }), FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r18-1 — a legacy-key order never gets a done marker from no_attempt_record', () => {
  it('legacy single order + check → no_attempt → no done marker; the next read copies it back (panel returns)', async () => {
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-L', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz', updatedAt: 1 }));
    mocks.authFetch.mockImplementation(async (u: string) => { if (u === '/api/capturePaypalOrder') return reply(409, noAttempt('ORD-L')); throw new Error(`OFFLINE ${u}`); });
    render(booking());
    expect(shownOrder()).toBe('ORD-L');
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await tick(); });
    expect(isRecoveryDone('ORD-L')).toBe(false);
    expect(readRecoveryOrder('ORD-L')).not.toBeNull(); // 옛 키에서 다시 복사
    expect(shownOrder()).toBe('ORD-L');
  });
  // 옛 키 주문은 서버의 최종 order_voided 로만 끝난다(완료 표식, 옛 키는 그대로 두고 숨김).
  it('legacy cart order + order_voided → done marker, hidden (legacy key untouched)', () => {
    localStorage.setItem(recoveryKey('cart'), JSON.stringify({ orderID: 'CART-L', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false, updatedAt: 1 }));
    expect(readRecoveryOrder('CART-L')).not.toBeNull();
    finishRecoveryOrder('CART-L');
    expect(isRecoveryDone('CART-L')).toBe(true);
    expect(readRecoveryOrder('CART-L')).toBeNull();
    expect(localStorage.getItem(recoveryKey('cart'))).not.toBeNull();
  });
});

describe('r18-2 — a late no_attempt answer never removes a CAPTURED saved in between', () => {
  it('single: check starts on CAPTURE_UNKNOWN → CAPTURED saved → no_attempt arrives → order kept, no "pay again" text', async () => {
    saveRecoveryOrder({ orderID: 'ORD-R', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    const answer = heldCheck('/api/capturePaypalOrder');
    render(booking());
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await tick(); });
    await act(async () => { saveRecoveryOrder({ orderID: 'ORD-R', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'charter_dmz' }); });
    await act(async () => { answer(reply(409, noAttempt('ORD-R'))); await tick(); });
    expect(readRecoveryOrder('ORD-R')).toMatchObject({ paymentStatus: 'CAPTURED' });
    expect(isRecoveryDone('ORD-R')).toBe(false);
    expect(screen.queryByText(NOT_DONE)).toBeNull();
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('cart: same order of events → order kept, no "pay again" text', async () => {
    mocks.items = [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }];
    saveRecoveryOrder({ orderID: 'CART-R', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
    const answer = heldCheck('/api/captureCartOrder');
    const { CartCheckout } = await import('../../src/components/CartCheckout');
    render(<CartCheckout onClose={() => {}} />);
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await tick(); });
    await act(async () => { saveRecoveryOrder({ orderID: 'CART-R', flow: 'cart', paymentStatus: 'CAPTURED', review: false }); });
    await act(async () => { answer(reply(409, noAttempt('CART-R', 'cart'))); await tick(); });
    expect(readRecoveryOrder('CART-R')).toMatchObject({ paymentStatus: 'CAPTURED' });
    expect(screen.queryByText(NOT_DONE)).toBeNull();
    expect(screen.getByText('CART-R')).toBeInTheDocument();
  });
  // r19: no_attempt_record 는 UNKNOWN — 상태가 그대로여도 놓지 않는다(새 서버가 묘비로 최종 답을 준다).
  it('unchanged record → an old-server no_attempt answer keeps it (UNKNOWN, no done marker, no "pay again")', async () => {
    saveRecoveryOrder({ orderID: 'ORD-U', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'charter_dmz' });
    mocks.authFetch.mockImplementation(async (u: string) => { if (u === '/api/capturePaypalOrder') return reply(409, noAttempt('ORD-U')); throw new Error(`OFFLINE ${u}`); });
    render(booking());
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await tick(); });
    expect(readRecoveryOrder('ORD-U')).not.toBeNull();
    expect(isRecoveryDone('ORD-U')).toBe(false);
    expect(screen.queryByText(NOT_DONE)).toBeNull();
  });
});

describe('r18-3 — empty cart + recovery order → final keeps the result screen until closed', () => {
  it('open the cart → check → final → "Booking confirmed!" and Done stay; Done closes the panel', async () => {
    saveRecoveryOrder({ orderID: 'CART-Q', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN', review: false });
    mocks.authFetch.mockImplementation(async (u: string) => { if (u === '/api/captureCartOrder') return reply(200, { ok: true, finalized: true, data: { orderID: 'CART-Q' } }); throw new Error(`OFFLINE ${u}`); });
    render(<CartPanel />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); });
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await tick(); });
    expect(isRecoveryDone('CART-Q')).toBe(true);
    expect(screen.getByText('Booking confirmed!')).toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Done')); });
    expect(screen.queryByText('Booking confirmed!')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByLabelText('Cart')); });
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
  });
});
