// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r11 — Astra r10 P2 + minor. 실 PayPal 0.
 *   1) 플래너 키의 Q 가 풀리면(NOT_CAPTURED·다른 탭 삭제) 공용 키에 남은 유료 플래너 주문 P 를 그 자리에서 승계 — Book now 금지.
 *   2) 다른 상품 화면이 놓은(forget) 주문 P 는 다른 탭이 다시 저장해도 이 화면 패널로 되살아나지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, readRecoveryOrder, isRecoveryDone, saveRecoveryOrder, orderRecoveryKey, doneRecoveryKey } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
// r16: 화면은 createdAt(옛 키 = updatedAt) → orderID 순으로 고른다 — "Q 를 먼저 보는" 이야기를 위해 P 를 더 늦게(updatedAt 2).
const ptr = (orderID: string, status: string, productType = 'ai_planner_full', updatedAt = orderID === 'ORD-P' ? 2 : 1) => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType, updatedAt });
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const notCaptured = (orderID: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const planner = () => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />;
function captureReplies(body: unknown, status = 409) {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/capturePaypalOrder') return { ok: status < 300, status, json: async () => body };
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r11-1 — when the planner key\'s order is released, the paid planner order left on the shared key takes over', () => {
  it('shared P (CAPTURED) + planner Q → Check Q → NOT_CAPTURED → P panel, no Book now; P moved to the planner key', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURED'));
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN'));
    captureReplies(notCaptured('ORD-Q'));
    render(planner());
    expect(shownOrder()).toBe('ORD-Q');
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBe('ORD-P');
    expect(screen.queryByText('Book now')).toBeNull();
    // r16: 이전 없음 — P 는 자기 주문(옛 공용 키 그대로, 읽기만)으로 CAPTURED 유지, Q 는 목록에서 빠짐.
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(localStorage.getItem(SHARED)).toBe(ptr('ORD-P', 'CAPTURED'));
    expect(readRecoveryOrder('ORD-Q')).toBeNull();
  });
  it('another tab deletes Q (StorageEvent) → P panel, no Book now', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURED'));
    const q = ptr('ORD-Q', 'CAPTURE_UNKNOWN');
    localStorage.setItem(PLANNER, q);
    render(planner());
    expect(shownOrder()).toBe('ORD-Q');
    // r17: 다른 탭(새 코드)의 해결 = 완료 표식 → 주문 키 삭제(옛 키는 건드리지 않는다). 이벤트는 재조회 신호.
    await act(async () => {
      localStorage.setItem(doneRecoveryKey('ORD-Q'), '1'); // 다른 탭이 확정 답을 보고 끝냄
      localStorage.removeItem(orderRecoveryKey('ORD-Q'));
      window.dispatchEvent(new StorageEvent('storage', { key: doneRecoveryKey('ORD-Q'), oldValue: null, newValue: '1' }));
    });
    expect(localStorage.getItem(PLANNER)).toBe(q);
    expect(shownOrder()).toBe('ORD-P');
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('the shared key only holds another product\'s order → nothing taken over, Book now', async () => {
    const charter = ptr('ORD-C', 'CAPTURE_UNKNOWN', 'charter_dmz');
    localStorage.setItem(SHARED, charter);
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN'));
    captureReplies(notCaptured('ORD-Q'));
    render(planner());
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
    expect(localStorage.getItem(SHARED)).toBe(charter);
  });
});

describe('r11-2 — an order this screen let go is not revived by another tab re-saving it', () => {
  it('charter screen: P (planner) final → neutral notice; another tab re-saves P → still the notice, no panel (once only)', async () => {
    // r16: 플래너 P 는 처음부터 차터 화면 몫이 아니다 — 다른 탭이 다시 저장해도 패널 없음(Book now).
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURE_UNKNOWN'));
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN'));
    const onSuccess = vi.fn();
    const charter = () => <PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onSuccess} p={{ paypalBookBtn: 'Book now' }} />;
    render(charter());
    expect(shownOrder()).toBeNull();
    await act(async () => {
      localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURED'));
      window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: ptr('ORD-P', 'CAPTURED') }));
    });
    expect(shownOrder()).toBeNull();
    expect(screen.getByText('Book now')).toBeInTheDocument();
    cleanup(); localStorage.clear();

    // r16: '1회만' 불변식은 이 화면이 맡는 상품 미상 주문으로 — final → 중립 안내 + 완료 표식. 다른 탭(구버전)이 옛 키에 다시 저장하거나
    //   새 코드가 다시 저장하려 해도(완료 주문은 저장 거부) 패널로 되살아나지 않는다.
    const unknown = (status: string) => JSON.stringify({ orderID: 'ORD-P', flow: 'single', paymentStatus: status, review: false, updatedAt: 1 });
    localStorage.setItem(SHARED, unknown('CAPTURE_UNKNOWN'));
    captureReplies(final('ORD-P'), 200);
    render(charter());
    await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
    // r17: 상품 미상 주문은 final 이어도 완료 처리하지 않는다(미발급 유료 플래너일 수 있음) — 이 화면에서만 놓는다.
    expect(isRecoveryDone('ORD-P')).toBe(false);
    await act(async () => {
      localStorage.setItem(SHARED, unknown('CAPTURED'));
      window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: unknown('CAPTURED') }));
    });
    expect(saveRecoveryOrder({ orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURED', review: false })).not.toBeNull(); // r17: 미해결로 유지
    expect(shownOrder()).toBeNull(); // 이 화면은 놓았으므로 되살리지 않는다
    expect(screen.getByText(/confirmed for a different order/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
