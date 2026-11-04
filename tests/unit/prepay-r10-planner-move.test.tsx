// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r10 — Astra r9 P2. 다른 상품 화면에서 플래너 주문 P 가 final 로 확인됐을 때의 플래너 키 이전. 실 PayPal 0.
 *   (a) 플래너 키에 다른 미발급 주문 Q → Q 를 덮지 않고 P 는 공용 키에 CAPTURED 로 남긴다.
 *   (b) 이동 저장 실패(Quota) → 공용 키를 지우지 않는다(양쪽 소실 금지).
 *   (c) 플래너 키가 비어 있으면 정상 이전 + 공용 키 삭제. (d) 같은 주문이 양쪽에 있으면 이전 뒤 1개.
 * r16: 범위 키 이전 자체가 없다(주문별 키). 같은 사용자 이야기의 새 불변식 —
 *   차터 화면은 플래너 주문 P·Q 를 맡지 않고(Book now, 확인·성공 없음), 외부 final 은 P 자기 키에 CAPTURED(settleForeignFinal),
 *   Q 는 그대로, 둘 다 남고 플래너 화면이 오래된 순(Q → P)으로 하나씩 맡는다. 저장 실패면 이 탭 메모리 + 옛 키 보존.
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
import { recoveryKey, PLANNER_RECOVERY_SCOPE, readRecoveryOrder, listRecoveryOrders, settleForeignFinal, orderRecoveryKey, resetPaymentRecoveryMemory, type PaymentRecovery } from '../../src/lib/paymentRecovery';

const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const ptr = (orderID: string, status = 'CAPTURE_UNKNOWN', updatedAt = 1) => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType: 'ai_planner_full', updatedAt });
const notCaptured = (orderID: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, error: 'Payment was not completed. You can start a new payment.' });
const asP = (): PaymentRecovery => readRecoveryOrder('ORD-P') as PaymentRecovery;

/** r16: 차터 화면은 플래너 주문을 맡지 않는다 — 패널·같은 주문 확인·성공 콜백 없음. */
function charterScreenLeavesPlannerOrders() {
  mocks.authFetch.mockImplementation(async (url: string) => { throw new Error(`OFFLINE: unexpected ${url}`); });
  const success = vi.fn();
  render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
  expect(screen.getByText('Book now')).toBeInTheDocument();
  expect(screen.queryByText('Check this order')).toBeNull();
  expect(mocks.authFetch).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
  cleanup();
}
const plannerScreen = () => render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />);

beforeEach(() => { cleanup(); vi.clearAllMocks(); resetPaymentRecoveryMemory(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

describe('r10 — moving a planner order found on another product\'s screen', () => {
  it('(a) planner key holds another unissued order Q → Q kept, P stays on the shared key as CAPTURED', async () => {
    // r16: P·Q 는 각자 주문 — 어느 것도 덮이지 않고, 플래너 화면이 Q(오래된 쪽) → Q 해결 뒤 P 를 맡는다. 그동안 Book now 없음.
    localStorage.setItem(SHARED, ptr('ORD-P', 'CAPTURE_UNKNOWN', 2));
    localStorage.setItem(PLANNER, ptr('ORD-Q', 'CAPTURE_UNKNOWN', 1));
    charterScreenLeavesPlannerOrders();
    settleForeignFinal(asP());
    expect(readRecoveryOrder('ORD-Q')).toMatchObject({ orderID: 'ORD-Q', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(asP()).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(localStorage.getItem(PLANNER)).toBe(ptr('ORD-Q', 'CAPTURE_UNKNOWN', 1));

    mocks.authFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      const id = init && init.body ? JSON.parse(init.body).orderID : '';
      if (url === '/api/capturePaypalOrder' && id === 'ORD-Q') return { ok: false, status: 409, json: async () => notCaptured('ORD-Q') };
      throw new Error(`OFFLINE: unexpected ${url} ${id}`);
    });
    plannerScreen();
    expect(screen.getByText('ORD-Q')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText('ORD-P')).toBeInTheDocument();
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    expect(readRecoveryOrder('ORD-Q')).toBeNull();
  });
  it('(b) Quota: the move cannot be saved → the shared key is not removed (no loss on both keys)', () => {
    // r16: 저장 실패 → 이 탭 메모리(persisted:false) CAPTURED, 옛 공용 키는 그대로 — 어느 쪽도 소실 없음, 플래너 화면이 맡는다.
    localStorage.setItem(SHARED, ptr('ORD-P'));
    charterScreenLeavesPlannerOrders();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    settleForeignFinal(asP());
    expect(localStorage.getItem(SHARED)).toBe(ptr('ORD-P'));
    expect(localStorage.getItem(PLANNER)).toBeNull();
    expect(asP()).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED', persisted: false });
    plannerScreen();
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('(c) planner key empty → moved there as CAPTURED, shared key removed', () => {
    // r16: 그 주문 자기 키에 CAPTURED. 옛 공용 키는 지우지 않는다(읽기만) — 실효 값은 주문별 키가 우선.
    localStorage.setItem(SHARED, ptr('ORD-P'));
    charterScreenLeavesPlannerOrders();
    settleForeignFinal(asP());
    expect(JSON.parse(localStorage.getItem(orderRecoveryKey('ORD-P')) || 'null')).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
    expect(asP()).toMatchObject({ paymentStatus: 'CAPTURED' });
    expect(localStorage.getItem(SHARED)).toBe(ptr('ORD-P'));
    expect(localStorage.getItem(PLANNER)).toBeNull();
  });
  it('(d) the same order on both keys → one copy left (planner key, CAPTURED)', () => {
    // r16: 같은 주문은 목록에 1건(orderID 기준) — 정리 뒤에도 1건, CAPTURED.
    localStorage.setItem(SHARED, ptr('ORD-P'));
    localStorage.setItem(PLANNER, ptr('ORD-P'));
    charterScreenLeavesPlannerOrders();
    expect(listRecoveryOrders().filter((o) => o.orderID === 'ORD-P')).toHaveLength(1);
    settleForeignFinal(asP());
    expect(listRecoveryOrders().filter((o) => o.orderID === 'ORD-P')).toHaveLength(1);
    expect(asP()).toMatchObject({ orderID: 'ORD-P', paymentStatus: 'CAPTURED' });
  });
});
