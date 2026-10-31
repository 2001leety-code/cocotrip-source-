// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r15 — Astra r14. 실 PayPal·Firestore 0.
 *   1) 유료 플래너 주문의 복구 포인터는 플랜이 **최종 발급**된 뒤에만 지운다 — streaming 200(firestoreSaved:false)은 유지 + planId 표식,
 *      플랜 상세가 ready 를 보면 삭제, error 면 유지(같은 주문 재발급). 저장 완료 200 은 즉시 삭제. 플랜 주소 없음은 유지.
 *   2) 비교 후 쓰기 사이 탭 경합으로 내 주문 Q 가 있던 키가 곧바로 다른 주문 P 로 바뀌면 Q 를 잃지 않는다(메모리 + 패널, 플래너면 다른 키).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-id-token' } }, db: {} }));
vi.mock('../../src/lib/firebase-auth.js', () => ({ auth: { currentUser: { getIdToken: async () => 'test-id-token' } } }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { useNavigate: () => vi.fn(), Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});
vi.mock('../../src/lib/guestReader', () => ({ isGuestAnonEnabled: () => false, shouldAttachGuestAnonToken: () => false }));
vi.mock('../../src/lib/analytics', () => ({ markPlannerPendingComplete: () => {}, trackPlannerOutcomeFromStatus: () => {}, trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/lib/analytics', () => ({ markPlannerPendingComplete: () => {}, trackPlannerOutcomeFromStatus: () => {}, trackPaidConversion: vi.fn(), trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('../../src/lib/posthog', () => ({ track: async () => {} }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));

import { recoveryKey, PLANNER_RECOVERY_SCOPE, settlePlannerIssue, markPlannerIssuePending } from '../../src/lib/paymentRecovery';
import { usePlanCompletionTracking } from '../../src/pages/PlanDetailPage/hooks/usePlanCompletionTracking';
const { usePlannerHandlers } = await import('../../src/pages/PlannerPage/hooks/usePlannerHandlers');
const { PayPalBookingButton } = await import('../../src/components/PayPalBookingButton');

const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const SHARED = recoveryKey('single');
const ORDER = '5O190127TN364715T';
const ptr = (orderID: string, productType = 'ai_planner_full', status = 'CAPTURED') => JSON.stringify({ orderID, flow: 'single', paymentStatus: status, review: false, productType, updatedAt: 1 });
const orderOn = (k: string) => { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as { orderID: string }).orderID : null; };

beforeEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* */ } });

async function issue(data: Record<string, unknown>) {
  localStorage.setItem(PLANNER, ptr(ORDER));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data }) } as Response);
  const { result } = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} }));
  await act(async () => { await result.current.handleSubmit({ regions: ['Seoul'], cityKeys: ['seoul'], durationDays: 2, pax: 2, reservation_status: 'nothing' } as unknown as PlannerFormValues); });
  await act(async () => { await result.current.handlePaymentSuccess(ORDER); });
}

describe('r15-1 — the paid planner pointer is cleared only once the plan is really issued', () => {
  it('streaming 200 (firestoreSaved:false) → pointer kept; plan detail sees ready → removed', async () => {
    await issue({ planId: 'plan-s', planUrl: '/my-plans/plan-s', status: 'streaming', firestoreSaved: false });
    expect(orderOn(PLANNER)).toBe(ORDER);
    const { rerender } = renderHook(({ status }) => usePlanCompletionTracking('plan-s', status, true), { initialProps: { status: 'streaming' as 'streaming' | 'ready' | 'error' } });
    expect(orderOn(PLANNER)).toBe(ORDER);
    rerender({ status: 'ready' });
    expect(orderOn(PLANNER)).toBeNull();
  });
  it('streaming 200 → worker fails (error) → pointer kept → the planner shows "Check this order", not Book now', async () => {
    await issue({ planId: 'plan-e', planUrl: '/my-plans/plan-e', status: 'streaming', firestoreSaved: false });
    renderHook(() => usePlanCompletionTracking('plan-e', 'error', true));
    expect(orderOn(PLANNER)).toBe(ORDER);
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
  });
  it('saved 200 (firestoreSaved:true) → removed at once', async () => {
    await issue({ planId: 'plan-r', planUrl: '/my-plans/plan-r', firestoreSaved: true });
    expect(orderOn(PLANNER)).toBeNull();
  });
  it('200 without a plan address → pointer kept (NO_PLAN_URL path)', async () => {
    await issue({ status: 'streaming', firestoreSaved: false });
    expect(orderOn(PLANNER)).toBe(ORDER);
  });
  it('pure: settlePlannerIssue only acts on the marked plan; streaming waits', () => {
    localStorage.setItem(PLANNER, ptr(ORDER));
    markPlannerIssuePending('plan-x', ORDER);
    settlePlannerIssue('plan-other', 'ready');
    settlePlannerIssue('plan-x', 'streaming');
    expect(orderOn(PLANNER)).toBe(ORDER);
    settlePlannerIssue('plan-x', 'ready');
    expect(orderOn(PLANNER)).toBeNull();
  });
});

describe('r15-2 — a tab whose key was overwritten in the compare/write race keeps its own order', () => {
  it('my planner Q on the planner key → another tab writes P over it (Q → P event) → Q panel stays, Q moved to the shared key, P untouched', async () => {
    const q = ptr('ORD-Q');
    localStorage.setItem(PLANNER, q);
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now' }} />);
    const p = ptr('ORD-P');
    await act(async () => { localStorage.setItem(PLANNER, p); window.dispatchEvent(new StorageEvent('storage', { key: PLANNER, oldValue: q, newValue: p })); });
    expect((document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent).toBe('ORD-Q');
    expect(screen.queryByText('Book now')).toBeNull();
    expect(orderOn(PLANNER)).toBe('ORD-P');
    expect(orderOn(SHARED)).toBe('ORD-Q');
  });
  it('single tab, normal sequence (remove then write) still follows the other tab', async () => {
    const q = ptr('ORD-Q', 'charter_dmz', 'CAPTURE_UNKNOWN');
    localStorage.setItem(SHARED, q);
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={vi.fn()} p={{ paypalBookBtn: 'Book now' }} />);
    const p = ptr('ORD-P', 'charter_dmz', 'CAPTURE_UNKNOWN');
    await act(async () => {
      localStorage.removeItem(SHARED); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: q, newValue: null }));
      localStorage.setItem(SHARED, p); window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: null, newValue: p }));
    });
    expect((document.querySelector('.customer-paypal-recovery .font-mono') as HTMLElement | null)?.textContent).toBe('ORD-P');
  });
});
