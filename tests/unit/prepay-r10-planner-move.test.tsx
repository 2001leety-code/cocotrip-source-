// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r10 — Astra r9 P2. 다른 상품 화면에서 플래너 주문 P 가 final 로 확인됐을 때의 플래너 키 이전. 실 PayPal 0.
 *   (a) 플래너 키에 다른 미발급 주문 Q → Q 를 덮지 않고 P 는 공용 키에 CAPTURED 로 남긴다.
 *   (b) 이동 저장 실패(Quota) → 공용 키를 지우지 않는다(양쪽 소실 금지).
 *   (c) 플래너 키가 비어 있으면 정상 이전 + 공용 키 삭제. (d) 같은 주문이 양쪽에 있으면 이전 뒤 1개.
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const ptr = (orderID: string, status = 'CAPTURE_UNKNOWN') => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType: 'ai_planner_full', updatedAt: 1 });
const read = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) as { orderID: string; paymentStatus: string } : null; };
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });

async function checkOnCharterScreen() {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/capturePaypalOrder') return { ok: true, status: 200, json: async () => final('ORD-P') };
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
  const success = vi.fn();
  render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
  await act(async () => { fireEvent.click(await screen.findByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
  expect(await screen.findByText(/confirmed for a different order/)).toBeInTheDocument();
  expect(success).not.toHaveBeenCalled(); // 차터 화면의 성공으로 쓰지 않는다
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r10 — moving a planner order found on another product\'s screen', () => {
  it('(a) planner key holds another unissued order Q → Q kept, P stays on the shared key as CAPTURED', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P'));
    localStorage.setItem(PLANNER, ptr('ORD-Q'));
    await checkOnCharterScreen();
    expect(read(PLANNER)?.orderID).toBe('ORD-Q');
    expect(read(SHARED)).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
  });
  it('(b) Quota: the move cannot be saved → the shared key is not removed (no loss on both keys)', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await checkOnCharterScreen();
    expect(read(SHARED)?.orderID).toBe('ORD-P');
    expect(read(PLANNER)).toBeNull();
  });
  it('(c) planner key empty → moved there as CAPTURED, shared key removed', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P'));
    await checkOnCharterScreen();
    expect(read(PLANNER)).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(read(SHARED)).toBeNull();
  });
  it('(d) the same order on both keys → one copy left (planner key, CAPTURED)', async () => {
    localStorage.setItem(SHARED, ptr('ORD-P'));
    localStorage.setItem(PLANNER, ptr('ORD-P'));
    await checkOnCharterScreen();
    expect(read(PLANNER)).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(read(SHARED)).toBeNull();
  });
});
