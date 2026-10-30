// @vitest-environment jsdom
/**
 * 2026-10-28 B6-1 r6 — 다른 탭이 삭제·이동·교체한 주문을 늦은 확인 응답이 되살리지 않는다.
 *   r5 T1·T1b·T1c와 StorageEvent 이전 경합, QR 일반 오류 재확인을 뒤집은 회귀. 실 PayPal·paypal.me 0.
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

import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { recoveryKey, PLANNER_RECOVERY_SCOPE } from '@/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const SHARED = recoveryKey('single');
const PLANNER = recoveryKey('single', PLANNER_RECOVERY_SCOPE);
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '90.00', currency: 'USD', payerName: 'P', payerEmail: 'p@example.invalid' } });
const PENDING = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', finalized: false });
const pointer = (orderID: string, productType: string) => JSON.stringify({ orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType, updatedAt: 1 });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('OFFLINE fetch'); }));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

/** first capture call parks until release(); then answers first; later calls answer final(orderID). */
function parkedCheck(orderID: string, first: 'NETWORK' | 'PENDING' | 'FINAL') {
  const st: { n: number; release: (() => void) | null } = { n: 0, release: null };
  mocks.authFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url !== '/api/capturePaypalOrder') throw new Error('OFFLINE: unexpected ' + url);
    st.n += 1;
    if (st.n === 1) {
      await new Promise<void>((r) => { st.release = r; });
      if (first === 'NETWORK') throw new TypeError('Failed to fetch');
      return first === 'PENDING' ? reply(202, PENDING(orderID)) : reply(200, final(orderID));
    }
    const requested = init && init.body ? JSON.parse(init.body).orderID || orderID : orderID;
    return reply(200, final(requested));
  });
  return st;
}
async function otherTabRemoves(key: string, raw: string) {
  await act(async () => {
    localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: raw, newValue: null }));
  });
}

describe('T1 two tabs: pointer resolved+removed by the other tab while this tab is checking', () => {
  it.each([['NETWORK'], ['PENDING']] as const)('tour order on the charter page, in-flight check answers %s', async (first) => {
    const raw = pointer('ORD-T', 'tour_dmz_day');
    localStorage.setItem(SHARED, raw);
    const st = parkedCheck('ORD-T', first);
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} dateStart="2099-12-05" priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    await otherTabRemoves(SHARED, raw);

    await act(async () => { st.release!(); await new Promise((r) => setTimeout(r, 10)); });
    const after = localStorage.getItem(SHARED);

    if (after) expect(JSON.parse(after)).toMatchObject({ orderID: 'ORD-T', productType: 'tour_dmz_day' });
    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) { await act(async () => { fireEvent.click(again); await new Promise(r => setTimeout(r, 20)); }); }
    const confirmed = !!screen.queryByText('Booking Confirmed!');

    expect(confirmed).toBe(false);
  });

  it('removal does not send the tour order to the charter success callback', async () => {
    const raw = pointer('ORD-T', 'tour_dmz_day');
    localStorage.setItem(SHARED, raw);
    const st = parkedCheck('ORD-T', 'PENDING');
    const onPaymentSuccess = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    await otherTabRemoves(SHARED, raw);
    await act(async () => { st.release!(); await new Promise((r) => setTimeout(r, 10)); });
    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) { await act(async () => { fireEvent.click(again); await new Promise(r => setTimeout(r, 20)); }); }

    expect(onPaymentSuccess).not.toHaveBeenCalled();
  });

  it('migration of a planner pointer never triggers the charter success callback', async () => {
    const raw = pointer('ORD-P', 'ai-planner-full');
    localStorage.setItem(SHARED, raw);
    const st = parkedCheck('ORD-P', 'PENDING');
    const charterSuccess = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={charterSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    await act(async () => {
      localStorage.setItem(PLANNER, raw);
      localStorage.removeItem(SHARED);
      window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: raw, newValue: null }));
    });
    await act(async () => { st.release!(); await new Promise((r) => setTimeout(r, 10)); });

    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) { await act(async () => { fireEvent.click(again); await new Promise(r => setTimeout(r, 20)); }); }

    expect(charterSuccess).not.toHaveBeenCalled();
  });

  it('control: no other-tab removal -> pending keeps tour -> final is neutral (r5 fix holds)', async () => {
    const raw = pointer('ORD-T', 'tour_dmz_day');
    localStorage.setItem(SHARED, raw);
    const st = parkedCheck('ORD-T', 'PENDING');
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    await act(async () => { st.release!(); await new Promise((r) => setTimeout(r, 10)); });
    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) { await act(async () => { fireEvent.click(again); await new Promise(r => setTimeout(r, 20)); }); }

    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
  });
});

const plannerInput = { regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3 };

describe('Q - QR shown, SDK capture generic error, reconcile evidence NOT_CAPTURED', () => {
  it.each([
    ['503 ORDER_CHECK_UNAVAILABLE (pre-capture check failed, attempt discarded)', 503, { ok: false, error: 'Could not verify the order right now — please retry', code: 'ORDER_CHECK_UNAVAILABLE' }],
    ['400 NO_ORDER_SNAPSHOT', 400, { ok: false, error: 'Order details are missing. Please create a new order.', code: 'NO_ORDER_SNAPSHOT' }],
  ])('%s', async (label, status, captureBody) => {
    let createCalls = 0;
    const calls: string[] = [];
    mocks.authFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push(`${url}${body.reconcile ? ' reconcile' : ''}`);
      if (url === '/api/createPaypalOrder') {
        createCalls += 1;
        return createCalls === 1 ? reply(500, { ok: false, error: 'boom' })
          : reply(200, { ok: true, data: { orderID: 'ORD-Q', usdAmount: '9.90', krwAmount: 14000, currentRate: 1400, displayKRW: '14,000', displayUSD: '$9.90' } });
      }
      if (url === '/api/capturePaypalOrder' && body.reconcile) {
        return reply(409, { ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID: 'ORD-Q', flow: 'single', paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true, evidence: 'no_attempt_record', error: 'Payment was not completed (no_attempt_record). You can start a new payment.' });
      }
      if (url === '/api/capturePaypalOrder') return reply(status as number, captureBody);
      throw new Error(`OFFLINE: unexpected ${url}`);
    });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) })) as never;
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={14000} lang="en" keepRecoveryUntilFulfilled plannerInput={plannerInput} onPaymentSuccess={vi.fn(async () => {})} p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />);
    fireEvent.click(screen.getByText('Book now'));
    fireEvent.click(await screen.findByText('Pay via QR (PayPal direct redirect)'));
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument(); // QR shown
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(await screen.findByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    await act(async () => { await buttons[buttons.length - 1].onApprove({ orderID: 'ORD-Q' }); });
    expect(calls).toContain('/api/capturePaypalOrder reconcile');
    expect(screen.getByText('Do not pay again. It may result in a duplicate charge.')).toBeInTheDocument();
    expect(screen.queryByText(/You can start a new payment/)).toBeNull();
  });
});

describe('r6 different order replaces pointer during recovery', () => {
  it.each(['NETWORK', 'PENDING'] as const)('preserves the new pointer when the old check returns %s', async (first) => {
    const old = pointer('ORD-T', 'tour_dmz_day');
    const replacement = pointer('ORD-NEW', 'charter_dmz');
    localStorage.setItem(SHARED, old);
    const st = parkedCheck('ORD-T', first);
    const success = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    await act(async () => {
      localStorage.setItem(SHARED, replacement);
      window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: old, newValue: replacement }));
    });
    await act(async () => { st.release!(); await new Promise(r => setTimeout(r, 10)); });
    expect(JSON.parse(localStorage.getItem(SHARED) || '{}')).toMatchObject({ orderID: 'ORD-NEW', productType: 'charter_dmz' });
    const again = screen.queryByText('Check this order') as HTMLButtonElement | null;
    if (again && !again.disabled) await act(async () => { fireEvent.click(again); await new Promise(r => setTimeout(r, 20)); });
    expect(success).not.toHaveBeenCalledWith('ORD-T');
  });
});
describe('r6 storage changes before a storage event arrives', () => {
  it.each([
    ['delete', 'PENDING'], ['delete', 'FINAL'], ['move', 'PENDING'], ['move', 'FINAL'],
  ] as const)('%s while a %s response is in flight', async (change, outcome) => {
    const raw = pointer('ORD-P', 'ai-planner-full');
    localStorage.setItem(SHARED, raw);
    const st = parkedCheck('ORD-P', outcome);
    const success = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(st.release).not.toBeNull());
    if (change === 'move') localStorage.setItem(PLANNER, raw);
    localStorage.removeItem(SHARED); // storage event intentionally delayed
    await act(async () => { st.release!(); await new Promise(r => setTimeout(r, 10)); });
    expect(localStorage.getItem(SHARED)).toBeNull();
    if (change === 'move') expect(localStorage.getItem(PLANNER)).toBe(raw);
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    expect(screen.queryByText(/different order/)).toBeNull();
  });
  it.each([
    ['flow', { flow: 'cart' }, 'PENDING'], ['flow', { flow: 'cart' }, 'FINAL'],
    ['product', { productType: 'tour_dmz_day' }, 'PENDING'], ['product', { productType: 'tour_dmz_day' }, 'FINAL'],
  ] as const)('same order with changed %s is not overwritten by stale %s evidence', async (_name, change, outcome) => {
    const raw = pointer('ORD-C', 'charter_dmz'); localStorage.setItem(SHARED, raw);
    const replacement = JSON.stringify({ ...JSON.parse(raw), ...change });
    const st = parkedCheck('ORD-C', outcome); const success = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order')); await waitFor(() => expect(st.release).not.toBeNull());
    localStorage.setItem(SHARED, replacement); // storage event intentionally delayed
    await act(async () => { st.release!(); await new Promise(r => setTimeout(r, 10)); });
    expect(localStorage.getItem(SHARED)).toBe(replacement);
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
  });
  // r7: 같은 주문·흐름·상품을 다른 탭이 새 시각으로 다시 저장한 것은 교체가 아니다 — 이 탭의 결과를 버리지 않는다.
  it.each(['PENDING', 'FINAL'] as const)('r7: same order re-saved with a new timestamp → the %s result still applies', async (outcome) => {
    const raw = pointer('ORD-C', 'charter_dmz'); localStorage.setItem(SHARED, raw);
    const resaved = JSON.stringify({ ...JSON.parse(raw), updatedAt: 2 });
    const st = parkedCheck('ORD-C', outcome); const success = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order')); await waitFor(() => expect(st.release).not.toBeNull());
    localStorage.setItem(SHARED, resaved);
    await act(async () => { st.release!(); await new Promise(r => setTimeout(r, 10)); });
    if (outcome === 'FINAL') expect(success).toHaveBeenCalledWith('ORD-C');
    else expect(JSON.parse(localStorage.getItem(SHARED) || '{}')).toMatchObject({ orderID: 'ORD-C', productType: 'charter_dmz' });
  });
});

describe('r6 fresh error reconcile does not touch a replacement pointer', () => {
  it.each(['before error', 'during reconcile'] as const)('replacement %s stays intact after stale final evidence', async (when) => {
    const replacement = pointer('ORD-NEW', 'charter_dmz');
    let releaseCapture: (() => void) | null = null;
    let releaseReconcile: (() => void) | null = null;
    mocks.authFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === '/api/createPaypalOrder') return reply(200, { ok: true, data: { orderID: 'ORD-OLD', usdAmount: '100', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000', displayUSD: '$100' } });
      if (url !== '/api/capturePaypalOrder') throw new Error('OFFLINE: unexpected ' + url);
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (!body.reconcile) {
        await new Promise<void>(r => { releaseCapture = r; });
        return reply(503, { ok: false, code: 'ORDER_CHECK_UNAVAILABLE', error: 'Could not verify' });
      }
      await new Promise<void>(r => { releaseReconcile = r; });
      return reply(200, final('ORD-OLD'));
    });
    const success = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={success} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Book now'));
    await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
    let approval: Promise<void> | undefined;
    act(() => { approval = buttons[buttons.length - 1].onApprove({ orderID: 'ORD-OLD' }); });
    await waitFor(() => expect(releaseCapture).not.toBeNull());
    const replace = async () => {
      await act(async () => {
        const old = localStorage.getItem(SHARED);
        localStorage.setItem(SHARED, replacement);
        window.dispatchEvent(new StorageEvent('storage', { key: SHARED, oldValue: old, newValue: replacement }));
      });
    };
    if (when === 'before error') await replace();
    act(() => { releaseCapture!(); });
    await waitFor(() => expect(releaseReconcile).not.toBeNull());
    if (when === 'during reconcile') await replace();
    await act(async () => { releaseReconcile!(); await approval; });
    expect(localStorage.getItem(SHARED)).toBe(replacement);
    // r7: 이 화면 자신의 주문(ORD-OLD) 증거는 버리지 않는다 — 결제된 주문을 재결제 권유로 보내지 않게(교체 포인터는 그대로).
    expect(success).toHaveBeenCalledWith('ORD-OLD');
  });
});