// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r7 — 저장소를 못 읽거나 못 쓰는 브라우저에서도 같은 주문 확인 결과가 적용된다(Astra r6 P1 · 적대적 r6 major).
 *   SecurityError(쿠키 전면 차단·일부 웹뷰)·QuotaExceeded(시크릿 모드) → ref 비교만으로 판정(저장소 없는 브라우저엔 StorageEvent 도 없다).
 *   + 이 화면 자신의 주문 증거는 포인터 교체와 무관하게 적용(QR 노출 뒤 NOT_CAPTURED 는 '다시 결제하지 마세요'). 실 PayPal 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
import { resetPaymentRecoveryMemory } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const pending = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false });
const notCaptured = (orderID: string) => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true, error: 'Payment was not completed (order-VOIDED). You can start a new payment.' });
const createOk = (orderID: string) => reply(200, { ok: true, data: { orderID, usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });
const realStorage = window.localStorage;

function captures(seq: unknown[], orderID = 'ORD-1') {
  let i = 0;
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/createPaypalOrder') return createOk(orderID);
    if (url === '/api/capturePaypalOrder') {
      const v = seq[Math.min(i++, seq.length - 1)];
      return reply((v as { code?: string }).code === 'PAYMENT_RECOVERY_PENDING' ? 202 : (v as { ok?: boolean }).ok ? 200 : 409, v);
    }
    throw new Error(`OFFLINE: unexpected ${url}`);
  });
}
async function payThenCheck(onPaymentSuccess: () => void) {
  render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
  await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-1' }); });
  expect(await screen.findByText('Check this order')).toBeInTheDocument(); // PENDING → 같은 주문 확인 패널
  await act(async () => { fireEvent.click(screen.getByText('Check this order')); await new Promise((r) => setTimeout(r, 10)); });
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); buttons.length = 0;
  resetPaymentRecoveryMemory(); // r16: 저장 실패 주문·완료는 모듈 메모리(persisted:false) — 테스트 간 누수 방지
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});
afterEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { return realStorage; } });
  vi.restoreAllMocks();
  try { realStorage.clear(); } catch { /* */ }
});

describe('r7-1 — storage unreadable (SecurityError): check results still apply (ref comparison)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
  });
  it('capture PENDING → Check → final → success callback once (not stuck on "do not pay again")', async () => {
    captures([pending('ORD-1'), final('ORD-1')]);
    const success = vi.fn();
    await payThenCheck(success);
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('ORD-1');
  });
  it('capture PENDING → Check → NOT_CAPTURED → pointer cleared, payment possible again', async () => {
    captures([pending('ORD-1'), notCaptured('ORD-1')]);
    await payThenCheck(vi.fn());
    // r19: 서버 영어 원문 대신 4개 언어 rc.notCaptured("…You can pay again.")
    expect(await screen.findByText(/You can pay again/)).toBeInTheDocument();
    expect(screen.queryByText('Check this order')).toBeNull();
  });
});

describe('r7-1 — storage write fails (QuotaExceeded): the never-persisted pointer is compared by ref only', () => {
  it('Astra repro: setItem throws → capture PENDING → Check → final → success callback once', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    captures([pending('ORD-1'), final('ORD-1')]);
    const success = vi.fn();
    await payThenCheck(success);
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
  });
});

describe('r7-3 — this page\'s own order evidence (fresh error → reconcile) applies; after a QR, NOT_CAPTURED never invites a new payment', () => {
  it('QR shown → Back → SDK order → capture 503 → reconcile NOT_CAPTURED → "Do not pay again", QR kept', async () => {
    let createCalls = 0; let captureCalls = 0;
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/createPaypalOrder') { createCalls += 1; return createCalls === 1 ? reply(500, { ok: false, error: 'boom' }) : createOk('ORD-Q'); }
      if (url === '/api/capturePaypalOrder') { captureCalls += 1; return captureCalls === 1 ? reply(503, { ok: false, code: 'ORDER_CHECK_UNAVAILABLE', error: 'Could not verify' }) : reply(409, notCaptured('ORD-Q')); }
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })) as never;
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled onPaymentSuccess={vi.fn(async () => {})}
      plannerInput={{ regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3 }} p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />);
    fireEvent.click(screen.getByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-Q' }); });
    expect(await screen.findByText('Do not pay again. It may result in a duplicate charge.')).toBeInTheDocument();
    expect(screen.queryByText(/You can start a new payment/)).toBeNull();
    expect(screen.getByText('Pay via QR (PayPal direct redirect)')).toBeInTheDocument();
  });
});

describe('r7-4 — QR report alert keeps the coverage details', () => {
  it('manual-payment-request dietary alert carries details (e.g. seoul:halal)', () => {
    const src = readFileSync(resolve(process.cwd(), 'api/manual-payment-request.js'), 'utf8');
    expect(src).toContain('${prepayCheck.code}${prepayCheck.details ? ` (${prepayCheck.details})` : \'\'} — 입금 및 생성 요청의 식이 조건을 확인하세요');
  });
});
