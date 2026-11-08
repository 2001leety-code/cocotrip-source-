// @vitest-environment jsdom
/**
 * Payment recovery UI behaviour (single + cart), fully offline: authFetch, PayPal SDK, analytics and hooks
 * are mocked. Covers pointer-before-capture, 202 never success, reload/restore, same-order reconcile,
 * NOT_CAPTURED clearing, review handling, cart kept intact while pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ user: {uid:'scope-owner',email:'synthetic@example.invalid'}, authFetch: vi.fn(), clear: vi.fn(async () => {}), track: vi.fn(), paid: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: mocks.track }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: mocks.paid, trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { get currentUser() { return mocks.user; } } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/exchange-rate', () => ({ formatPrice: (n: number) => String(n) }));
vi.mock('@/lib/discountFlags', () => ({ discountV2Enabled: () => false }));
vi.mock('@/lib/charterExtras', () => ({ charterOptionsBody: (o: unknown) => o }));
vi.mock('@/lib/tourSlotBooking', () => ({ tourSlotBody: () => ({}), SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('@/lib/charterUsd', () => ({ charterCheckoutExpectedUsd: () => undefined, charterUsdFromKrw: () => 100 }));
vi.mock('@/components/GuestSignupNudge', () => ({ GuestSignupNudge: () => null }));
vi.mock('../../src/components/PayPalQrPanel', async () => {
  const R = await import('react');
  return { PayPalQrPanel: () => R.createElement('div', null, 'QR PANEL') };
});
vi.mock('react-router-dom', async () => {
  const R = await import('react');
  return { Link: ({ children, to }: { children: React.ReactNode; to: string }) => R.createElement('a', { href: to }, children) };
});

import { PayPalBookingButton } from '../../src/components/PayPalBookingButton';
import { recoveryKey } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { createOrder: () => string; onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
/** Real server statuses: success 200, capture 202 for recovery-pending, 409 for a create block / NOT_CAPTURED / generic errors. */
function json(url: string, body: unknown) {
  const value = (body || {}) as { ok?: boolean; code?: string; bookingStatus?: string };
  const status = value.ok === true ? 200
    : value.code === 'PAYMENT_RECOVERY_PENDING' && url.startsWith('/api/capture') ? 202 : 409;
  return { ok: status < 300, status, json: async () => body };
}
function route(table: Record<string, (body: Record<string, unknown>) => unknown>) {
  mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    const reply = table[url];
    if (!reply) throw new Error(`OFFLINE: unexpected ${url}`);
    return json(url, await reply(body));
  });
}
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100.00', currency: 'USD', payerName: 'Pay Er', payerEmail: 'payer@example.invalid' } });
const createOk = { ok: true, data: { orderID: 'ORD-1', usdAmount: '100.00', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000원', displayUSD: '$100.00 USD' } };
/** Server terminal proof (capturePaypalOrder PROMO path): proven full refund + confirmed booking transition. */

beforeEach(() => {
  mocks.user = {uid:'scope-owner',email:'synthetic@example.invalid'};
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});




import { readAiCheckoutScope } from '../../src/lib/aiCheckoutScope';
it('observer throw pauses this tab across component remount without attributing an order to current UID',async()=>{
 const order='OBSERVER-THROW';route({'/api/createPaypalOrder':()=>({...createOk,data:{...createOk.data,orderID:order}}),'/api/capturePaypalOrder':()=>final(order)});
 const {isAiCheckoutHeldInThisTab}=await import('../../src/lib/aiPlanIssuanceNotice');
 const view=()=> <PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" canStartAiCheckout={()=>!isAiCheckoutHeldInThisTab()} onVerifiedPayPalFinal={()=>{throw new Error('synthetic observer');}} onPaymentSuccess={vi.fn()} aiCheckoutBlockedMessage="Check existing order" p={{paypalBookBtn:'Book now'}}/>;
 expect(isAiCheckoutHeldInThisTab()).toBe(false);
 {
  const mounted=render(view());fireEvent.click(screen.getByText('Book now'));await waitFor(()=>expect(buttons).toHaveLength(1));
  await act(async()=>buttons[0].onApprove({orderID:order}));mounted.unmount();
 }
 expect(isAiCheckoutHeldInThisTab()).toBe(true);
 mocks.authFetch.mockClear();render(view());fireEvent.click(screen.getByText('Book now'));expect(mocks.authFetch).not.toHaveBeenCalled();
 expect(screen.getByText('Check existing order')).toBeVisible();
});

describe('AI-only verified-final source and checkout boundary', () => {
  it('blocks actual create when the AI gate refuses; other products stay unchanged', async () => {
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" canStartAiCheckout={()=>false} onVerifiedPayPalFinal={()=>true} aiCheckoutBlockedMessage="Check existing order" p={{paypalBookBtn:'Book now'}}/>);
    fireEvent.click(screen.getByText('Book now'));
    expect(mocks.authFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Check existing order')).toBeVisible();
  });
  it('pins original create scope across latest callback/account switch and blocks stale SDK start', async () => {
    const order='SCOPE-ACCOUNT-SWITCH';
    route({'/api/createPaypalOrder':()=>({...createOk,data:{...createOk.data,orderID:order}}),'/api/capturePaypalOrder':()=>final(order)});
    const success=vi.fn(); const observer=vi.fn(()=>false);
    const view=(observe:typeof observer)=><PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" canStartAiCheckout={()=>true} onVerifiedPayPalFinal={observe} onPaymentSuccess={success} aiCheckoutBlockedMessage="Check original account" p={{paypalBookBtn:'Book now'}}/>;
    const mounted=render(view(observer)); fireEvent.click(screen.getByText('Book now'));
    await waitFor(()=>expect(buttons).toHaveLength(1));
    expect(readAiCheckoutScope(order)?.uid).toBe('scope-owner');
    expect(buttons[0].createOrder()).toBe(order);
    mocks.user={uid:'different-owner',email:'different@example.invalid'};
    const latest=vi.fn(()=>false); mounted.rerender(view(latest));
    expect(()=>buttons[0].createOrder()).toThrow('Check original account');
    await act(async()=>{await buttons[0].onApprove({orderID:order});});
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({uid:'scope-owner',orderId:order}),order);
    expect(observer).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
  });
  it('never attributes a legacy restored pointer to current UID', async () => {
    const order='LEGACY-UNKNOWN-SCOPE';
    localStorage.setItem(recoveryKey('single'),JSON.stringify({orderID:order,flow:'single',productType:'ai-planner-full',paymentStatus:'CAPTURED',review:false,updatedAt:1}));
    route({'/api/capturePaypalOrder':()=>final(order)});
    const observer=vi.fn(()=>false),success=vi.fn();
    render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" onVerifiedPayPalFinal={observer} onPaymentSuccess={success} p={{paypalBookBtn:'Book now'}}/>);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(()=>expect(observer).toHaveBeenCalledWith(null,order));
    expect(success).not.toHaveBeenCalled(); expect(readAiCheckoutScope(order)).toBeNull();
  });
});


it('refuses a stale same-UID scope with a different attempt before exposing SDK',async()=>{
 const order='STALE-ATTEMPT';const {rememberAiCheckoutScope}=await import('../../src/lib/aiCheckoutScope');
 rememberAiCheckoutScope({uid:mocks.user.uid,orderId:order,attemptId:'old-attempt'});
 route({'/api/createPaypalOrder':()=>({...createOk,data:{...createOk.data,orderID:order}})});
 render(<PayPalBookingButton productType="ai-planner-full" passengers={1} priceKRW={1} lang="en" canStartAiCheckout={()=>true} onVerifiedPayPalFinal={()=>true} aiCheckoutBlockedMessage="Check existing order" p={{paypalBookBtn:'Book now'}}/>);
 fireEvent.click(screen.getByText('Book now'));await screen.findByText('Check existing order');
 expect(buttons).toHaveLength(0);expect(mocks.authFetch.mock.calls.filter(c=>c[0]==='/api/capturePaypalOrder')).toHaveLength(0);
});
