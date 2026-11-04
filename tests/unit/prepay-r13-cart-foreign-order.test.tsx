// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r13 — Astra r12 P2(형제 경로 CartCheckout). 실 PayPal 0.
 *   장바구니가 받은 다른 상품 주문(서버 409 미결 주문·다른 탭이 알린 단건/플래너 주문)은 원래 flow·상품을 보존하고 덮지 않는 공용 규칙으로 두며,
 *   확정돼도 장바구니를 비우거나 성공 처리하지 않는다(플래너 주문은 플래너 키로 CAPTURED — 발급 경로 보존).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { CartCheckout } from '../../src/components/CartCheckout';
import { recoveryKey, PLANNER_RECOVERY_SCOPE, readRecoveryOrder } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const CART = recoveryKey('cart');
const ptr = (orderID: string, status: string, productType = 'ai_planner_full') => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType, updatedAt: 1 });
const read = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) as { orderID: string; paymentStatus: string; productType?: string; flow: string } : null; };
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r13 — CartCheckout keeps foreign orders intact', () => {
  it('Astra repro: planner Q + shared planner P → "Confirm & pay" → 409 P → product kept, Q kept, neutral notice, cart untouched', async () => {
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURED'));
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURE_UNKNOWN'));
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') return reply(409, { ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'ORD-P', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'ai_planner_full' });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByText('Confirm & pay')); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText(/still being confirmed/)).toBeInTheDocument();
    expect(read(SHARED)).toMatchObject({ orderID: 'ORD-P', productType: 'ai_planner_full', flow: 'single' }); // 상품 정보 보존
    expect(read(PLANNER)?.orderID).toBe('ORD-Q');
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ productType: 'ai_planner_full', flow: 'single' }); // r16: 그 주문 키에도 상품 그대로
    expect(read(CART)).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('a planner order announced to the cart (other tab) → Check → final → cart NOT cleared, no success, P moved to the planner key as CAPTURED', async () => {
    // r16: 장바구니 화면은 cart 주문만 맡는다 — 다른 탭이 알린 플래너 단건 주문은 패널·확인·성공·장바구니 비우기 없이 그대로 남는다(플래너 화면 몫).
    mocks.authFetch.mockImplementation(async (url: string) => { throw new Error(`OFFLINE: unexpected ${url}`); });
    render(<CartCheckout onClose={() => {}} />);
    const p = ptr('ORD-P', 'CAPTURE_UNKNOWN');
    await act(async () => { localStorage.setItem(SHARED, p); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: p })); });
    expect(screen.queryByText('Check this order')).toBeNull();
    expect(screen.getByText('Confirm & pay')).toBeInTheDocument();
    expect(mocks.authFetch).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(screen.queryByText('Booking confirmed!')).toBeNull();
    expect(readRecoveryOrder('ORD-P')).toMatchObject({ orderID: 'ORD-P', flow: 'single', productType: 'ai_planner_full', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(localStorage.getItem(SHARED)).toBe(p);
  });
  it('a foreign single order still pending → its pointer keeps flow + product (not rewritten as a cart order)', async () => {
    // r16: 다른 탭이 알린 단건 주문은 장바구니 화면에 선택되지 않는다. 결제 시도 → 서버 409(그 단건 미결) → 원래 flow·상품 그대로 보존 + 중립 안내.
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') return reply(409, { ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'ORD-T', flow: 'single', paymentStatus: 'CAPTURED', productType: 'tour_dmz' });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    const t = ptr('ORD-T', 'CAPTURE_UNKNOWN', 'tour_dmz');
    await act(async () => { localStorage.setItem(SHARED, t); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: t })); });
    expect(screen.queryByText('Check this order')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Confirm & pay')); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText(/still being confirmed/)).toBeInTheDocument();
    expect(readRecoveryOrder('ORD-T')).toMatchObject({ orderID: 'ORD-T', flow: 'single', productType: 'tour_dmz', paymentStatus: 'CAPTURED' });
    expect(read(CART)).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('own cart order: 409 cart pointer → remembered on the cart key as before', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createCartOrder') return reply(409, { ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID: 'CART-1', flow: 'cart', paymentStatus: 'CAPTURE_UNKNOWN' });
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    render(<CartCheckout onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByText('Confirm & pay')); await new Promise((r) => setTimeout(r, 10)); });
    await waitFor(() => expect(readRecoveryOrder('CART-1')).toMatchObject({ orderID: 'CART-1', flow: 'cart' })); // r16: 주문별 키
    expect(screen.getByText('Check this order')).toBeInTheDocument();
  });
});
