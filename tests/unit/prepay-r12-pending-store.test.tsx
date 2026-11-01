// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r12 — Astra r11 P2. 서버 409 PAYMENT_RECOVERY_PENDING 이 돌려준 미결 주문 P 를 저장할 때 대상 키의 다른 주문을 덮지 않는다
 *   (r10 이동 분기와 같은 공용 헬퍼 placeRecoveryPointer). 실 PayPal 0.
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, placeForeignPending, readRecoveryOrder, listRecoveryOrders, orderRecoveryKey } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const ptr = (orderID: string, status: string, productType = 'ai_planner_full') => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType, updatedAt: 1 });
const read = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) as { orderID: string; paymentStatus: string; productType?: string } : null; };
const shownOrder = () => (document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent || null;
const pending409 = (orderID: string, productType: string, paymentStatus = 'CAPTURE_UNKNOWN') => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus, productType, error: 'pending' }) });
const notCaptured = (orderID: string) => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' }) });
const planner = () => <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />;
const charter = () => <PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />;

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: () => ({ render: () => {}, isEligible: () => true }), FUNDING: {} };
});
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r12 — a pending order handed back by the server never overwrites another order', () => {
  it('Astra repro: planner Q (CAPTURED) + charter Book now → 409 planner P → Q kept, P on the shared key; Q released later → P taken over', async () => {
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURED'));
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return pending409('ORD-P', 'ai_planner_full');
      if (url === '/api/capturePaypalOrder') return notCaptured('ORD-Q');
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(charter());
    await act(async () => { fireEvent.click(screen.getByText('Book now')); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText(/still being confirmed/)).toBeInTheDocument(); // 중립 안내(pending)
    expect(read(PLANNER)).toMatchObject({ orderID: 'ORD-Q', paymentStatus: 'CAPTURED' });
    // r16: P 는 공용 키가 아니라 자기 주문 키에(Q 와 별개) — 둘 다 남는다.
    expect(read(SHARED)).toBeNull();
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'ai_planner_full' });
    expect(readRecoveryOrder('ORD-Q')).toMatchObject({ orderID: 'ORD-Q', paymentStatus: 'CAPTURED' });
    cleanup();
    render(planner());
    expect(shownOrder()).toBe('ORD-Q'); // Q 보존 — r16: 오래된 주문(createdAt) 먼저
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(shownOrder()).toBe('ORD-P'); // 순차 복구 — r16: Q 해결 뒤 다음 미해결 주문
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('target key empty → stored there as before (planner P → planner key)', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') return pending409('ORD-P', 'ai_planner_full');
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(charter());
    await act(async () => { fireEvent.click(screen.getByText('Book now')); await new Promise((r) => setTimeout(r, 10)); });
    // r16: 자기 주문 키에 저장(옛 범위 키는 쓰지 않는다) — 플래너 화면이 맡는다.
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P', productType: 'ai_planner_full' });
    expect(read(orderRecoveryKey('ORD-P'))?.orderID).toBe('ORD-P');
    expect(read(PLANNER)).toBeNull();
    expect(read(SHARED)).toBeNull();
  });
  it('same order already on the target key → updated, still one copy', () => {
    // r16: placeRecoveryPointer(target) → placeForeignPending/saveRecoveryOrder: 같은 주문은 갱신(createdAt 유지), 목록엔 1건.
    localStorage.setItem(PLANNER, ptr('ORD-P', 'CAPTURE_UNKNOWN'));
    expect(placeForeignPending({ orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'ai_planner_full' })).toMatchObject({ paymentStatus: 'CAPTURED', createdAt: 1 });
    expect(readRecoveryOrder('ORD-P')?.paymentStatus).toBe('CAPTURED');
    expect(listRecoveryOrders().filter((o) => o.orderID === 'ORD-P')).toHaveLength(1);
    expect(read(SHARED)).toBeNull();
  });
  it('helper: both keys hold other orders → none (nothing overwritten); shared target blocked → none (no planner fallback)', () => {
    // r16: 'none'(저장 포기) → 다른 주문을 덮을 길 자체가 없으므로 각자 주문 키에 저장된다 — Q·C 불변, P·T 추가, 아무것도 소실 없음.
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURED'));
    localStorage.setItem(SHARED, ptr('ORD-C', 'CAPTURE_UNKNOWN', 'charter_dmz'));
    const p = { orderID: 'ORD-P', flow: 'single' as const, paymentStatus: 'CAPTURE_UNKNOWN' as const, review: false, productType: 'ai_planner_full' };
    expect(placeForeignPending(p)).toMatchObject({ orderID: 'ORD-P' });
    expect(placeForeignPending({ ...p, orderID: 'ORD-T', productType: 'tour_dmz' })).toMatchObject({ orderID: 'ORD-T', productType: 'tour_dmz' });
    expect(read(PLANNER)?.orderID).toBe('ORD-Q');
    expect(read(SHARED)?.orderID).toBe('ORD-C');
    expect(listRecoveryOrders().map((o) => o.orderID).sort()).toEqual(['ORD-C', 'ORD-P', 'ORD-Q', 'ORD-T']);
  });
});
