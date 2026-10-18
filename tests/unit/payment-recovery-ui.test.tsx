// @vitest-environment jsdom
/**
 * Payment recovery UI behaviour (single + cart), fully offline: authFetch, PayPal SDK, analytics and hooks
 * are mocked. Covers pointer-before-capture, 202 never success, reload/restore, same-order reconcile,
 * NOT_CAPTURED clearing, review handling, cart kept intact while pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}), track: vi.fn(), paid: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/posthog', () => ({ track: mocks.track }));
vi.mock('@/lib/analytics', () => ({ trackPaidConversion: mocks.paid, trackBeginCheckout: vi.fn(), getAttributionSnapshot: () => null }));
vi.mock('@/hooks/useLoyalty', () => ({ useLoyalty: () => ({ activeCoupons: [] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn(), auth: { currentUser: null } }));
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
import { CartCheckout } from '../../src/components/CartCheckout';
import { recoveryKey } from '../../src/lib/paymentRecovery';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
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
const pending = (orderID: string) => ({ ok: false, code: 'PAYMENT_RECOVERY_PENDING', orderID, flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', bookingStatus: 'BOOKING_STATE_UNKNOWN', finalized: false, retryable: false });
const notCaptured = (orderID: string, flow = 'single') => ({ ok: false, code: 'PAYMENT_NOT_CAPTURED', orderID, flow, paymentStatus: 'NOT_CAPTURED', finalized: false, retryable: true, error: 'Payment was not completed (declined). You can start a new payment.' });
const final = (orderID: string) => ({ ok: true, finalized: true, data: { orderID, amount: '100.00', currency: 'USD', payerName: 'Pay Er', payerEmail: 'payer@example.invalid' } });
const createOk = { ok: true, data: { orderID: 'ORD-1', usdAmount: '100.00', krwAmount: 135000, currentRate: 1350, displayKRW: '135,000원', displayUSD: '$100.00 USD' } };
const REFUNDED_MSG = 'Promo code "EARLY50" reached its usage limit. Your payment has been refunded — please retry without the promo code.';
/** Server terminal proof (capturePaypalOrder PROMO path): proven full refund + confirmed booking transition. */
const refunded = (orderID: string, extra: Record<string, unknown> = {}) => ({ ok: false, code: 'PROMO_LIMIT_EXCEEDED', error: REFUNDED_MSG, orderID, finalized: true, paymentStatus: 'REFUNDED', refundID: 'REF-1', ...extra });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
});

async function approveSingle(onPaymentSuccess = vi.fn(), productType = 'airport_seoul_central') {
  render(<PayPalBookingButton productType={productType} passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onPaymentSuccess} p={{ paypalBookBtn: 'Book now', paypalRetry: 'Retry' }} />);
  fireEvent.click(screen.getByText('Book now'));
  await waitFor(() => expect(buttons).toHaveLength(1));
  return onPaymentSuccess;
}

describe('PayPalBookingButton — pending pointer and same-order reconcile', () => {
  it('writes the pointer before capture; a 202 recovery answer is never success: no callback, no conversion, create/retry/QR hidden', async () => {
    let pointerAtCapture: string | null = null;
    route({
      '/api/createPaypalOrder': () => createOk,
      '/api/capturePaypalOrder': () => { pointerAtCapture = localStorage.getItem(recoveryKey('single')); return pending('ORD-1'); },
    });
    const onSuccess = await approveSingle();
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-1' }); });
    expect(JSON.parse(pointerAtCapture || 'null')).toMatchObject({ orderID: 'ORD-1', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    expect(screen.queryByText(/Pay via QR/)).toBeNull();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
    expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || 'null')).toMatchObject({ orderID: 'ORD-1' });
  });

  it('a second approve for the same mount is ignored while a capture is in flight (synchronous guard)', async () => {
    let resolveCapture: (v: unknown) => void = () => {};
    route({ '/api/createPaypalOrder': () => createOk, '/api/capturePaypalOrder': () => new Promise((r) => { resolveCapture = r; }) });
    await approveSingle();
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = buttons[0].onApprove({ orderID: 'ORD-1' });
      await buttons[0].onApprove({ orderID: 'ORD-1' });
    });
    expect(mocks.authFetch.mock.calls.filter((c) => c[0] === '/api/capturePaypalOrder')).toHaveLength(1);
    await act(async () => { resolveCapture(pending('ORD-1')); await first; });
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
  });

  it('a fetch exception during capture keeps the order pending instead of showing a retry/new-payment path', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/createPaypalOrder') return json(url, createOk); throw new Error('network lost'); });
    const onSuccess = await approveSingle();
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-1' }); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || 'null')).toMatchObject({ orderID: 'ORD-1', paymentStatus: 'CAPTURE_UNKNOWN' });
  });

  it('a restored pointer (reload) shows the same order; a generic 503 keeps it; explicit NOT_CAPTURED clears it and re-enables payment', async () => {
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-9', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', review: false, productType: 'airport_seoul_central', updatedAt: 1 }));
    const calls: Record<string, unknown>[] = [];
    route({ '/api/capturePaypalOrder': (body) => { calls.push(body); return calls.length === 1 ? { ok: false, code: 'ORDER_CHECK_UNAVAILABLE', error: 'Could not verify the order right now — please retry' } : notCaptured('ORD-9'); } });
    render(<PayPalBookingButton productType="airport_seoul_central" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    expect(screen.getByText('ORD-9')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ orderID: 'ORD-9', reconcile: true });
    await screen.findByText('Could not verify the order right now — please retry');
    expect(localStorage.getItem(recoveryKey('single'))).not.toBeNull();
    expect(screen.queryByText('Book now')).toBeNull();
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(localStorage.getItem(recoveryKey('single'))).toBeNull());
    expect(await screen.findByText('Book now')).toBeInTheDocument();
  });

  it('durable success for the SAME product calls onPaymentSuccess once; a different product shows the confirmation instead', async () => {
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-9', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'airport_seoul_central', updatedAt: 1 }));
    route({ '/api/capturePaypalOrder': () => final('ORD-9') });
    const onSuccess = vi.fn();
    render(<PayPalBookingButton productType="airport_seoul_central" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith('ORD-9');
    expect(mocks.paid).not.toHaveBeenCalled(); // restored replay never re-fires conversions
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();

    cleanup();
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-9', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'airport_seoul_central', updatedAt: 1 }));
    const otherSuccess = vi.fn();
    render(<PayPalBookingButton productType="charter_dmz" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={otherSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Check this order'));
    expect(await screen.findByText('Booking Confirmed!')).toBeInTheDocument();
    expect(otherSuccess).not.toHaveBeenCalled();
  });

  it('PAYMENT_REVIEW keeps the order blocked with review copy; a server-side block on create adopts the pending order', async () => {
    route({ '/api/createPaypalOrder': () => createOk, '/api/capturePaypalOrder': () => ({ ok: true, finalized: false, retryable: false, paymentCaptured: true, paymentStatus: 'CAPTURED', bookingStatus: 'PAYMENT_REVIEW', orderID: 'ORD-1', captureID: 'CAP-1' }) });
    const onSuccess = await approveSingle();
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-1' }); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalledWith('payment_completed', expect.anything());
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Done'));
    expect(await screen.findByText('Payment received; our team is verifying it')).toBeInTheDocument();
    expect(screen.queryByText('Book now')).toBeNull();
    expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || 'null')).toMatchObject({ orderID: 'ORD-1', review: true });

    cleanup(); localStorage.clear(); buttons.length = 0;
    route({ '/api/createPaypalOrder': () => ({ ...pending('ORD-7'), flow: 'cart' }) });
    render(<PayPalBookingButton productType="airport_seoul_central" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now' }} />);
    fireEvent.click(screen.getByText('Book now'));
    expect(await screen.findByText('ORD-7')).toBeInTheDocument();
    expect(buttons).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(recoveryKey('cart')) || 'null')).toMatchObject({ orderID: 'ORD-7', flow: 'cart' });
  });

  it('no PayPal SDK initialisation, load or Buttons while a pointer is unresolved; normal SDK load resumes after NOT_CAPTURED', async () => {
    delete (window as unknown as { paypal?: unknown }).paypal; // a real browser would have to load the SDK script
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-9', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'airport_seoul_central', updatedAt: 1 }));
    route({ '/api/capturePaypalOrder': () => notCaptured('ORD-9') });
    render(<PayPalBookingButton productType="airport_seoul_central" passengers={2} priceKRW={135000} lang="en" p={{ paypalBookBtn: 'Book now', paypalSdkError: 'SDK ERROR' }} />);
    expect(screen.getByText('Check this order')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(document.getElementById('paypal-sdk')).toBeNull();
    expect(buttons).toHaveLength(0);
    expect(screen.queryByText('SDK ERROR')).toBeNull();
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(localStorage.getItem(recoveryKey('single'))).toBeNull());
    expect(await screen.findByText('Book now')).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('paypal-sdk')).not.toBeNull());
    expect((document.getElementById('paypal-sdk') as HTMLScriptElement).src).toContain('client-id=offline-client');
    expect(document.querySelectorAll('#paypal-sdk')).toHaveLength(1);
  });

  it('only a server-proven refund of the SAME order releases the pointer (legacy 409 / other order / empty refundID stay blocked); never success or conversion', async () => {
    localStorage.setItem(recoveryKey('single'), JSON.stringify({ orderID: 'ORD-9', flow: 'single', paymentStatus: 'CAPTURED', review: false, productType: 'airport_seoul_central', updatedAt: 1 }));
    const replies: unknown[] = [
      { ok: false, code: 'PROMO_LIMIT_EXCEEDED', error: 'Promo code "EARLY50" reached its usage limit. A manual refund will be issued — operator notified.', replayed: true },
      refunded('ORD-8'),
      refunded('ORD-9', { refundID: ' ' }),
      refunded('ORD-9', { paymentStatus: 'REFUND_PENDING' }),
      refunded('ORD-9', { replayed: true }),
    ];
    route({ '/api/capturePaypalOrder': () => replies.shift() });
    const onSuccess = vi.fn();
    render(<PayPalBookingButton productType="airport_seoul_central" passengers={2} priceKRW={135000} lang="en" onPaymentSuccess={onSuccess} p={{ paypalBookBtn: 'Book now' }} />);
    for (const left of [4, 3, 2, 1]) {
      fireEvent.click(await screen.findByText('Check this order'));
      await waitFor(() => expect(replies).toHaveLength(left));
      await screen.findByText('Check this order');
      expect(JSON.parse(localStorage.getItem(recoveryKey('single')) || 'null')).toMatchObject({ orderID: 'ORD-9' });
      expect(screen.queryByText('Book now')).toBeNull();
    }
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(localStorage.getItem(recoveryKey('single'))).toBeNull());
    expect(await screen.findByText('Book now')).toBeInTheDocument();
    expect(screen.getByText(REFUNDED_MSG)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(screen.queryByText('Booking Confirmed!')).toBeNull();
  });
});

describe('CartCheckout — cart stays intact while a capture is unresolved', () => {
  async function approveCart() {
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByText('Confirm & pay'));
    await waitFor(() => expect(buttons).toHaveLength(1));
  }
  const cartCreate = { ok: true, data: { orderID: 'CART-1', usdAmount: '100.00', totalKRW: 135000 } };

  it('202 recovery pending: cart is NOT cleared, pointer kept, check-order shown; NOT_CAPTURED then clears and re-enables checkout', async () => {
    const replies = [{ ...pending('CART-1'), flow: 'cart' }, notCaptured('CART-1', 'cart')];
    route({ '/api/createCartOrder': () => cartCreate, '/api/captureCartOrder': () => replies.shift() });
    await approveCart();
    await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    expect(screen.queryByText('Booking confirmed!')).toBeNull();
    expect(JSON.parse(localStorage.getItem(recoveryKey('cart')) || 'null')).toMatchObject({ orderID: 'CART-1', flow: 'cart' });
    fireEvent.click(screen.getByText('Check this order'));
    await waitFor(() => expect(localStorage.getItem(recoveryKey('cart'))).toBeNull());
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(await screen.findByText('Confirm & pay')).toBeInTheDocument();
  });

  it('PAYMENT_REVIEW (even ok:true + finalized:true) is never success: original pointer kept as review, no confirmation, no paid conversion; a remount stays blocked', async () => {
    route({ '/api/createCartOrder': () => cartCreate, '/api/captureCartOrder': () => ({ ok: true, finalized: true, retryable: false, paymentCaptured: true, paymentStatus: 'CAPTURED', bookingStatus: 'PAYMENT_REVIEW', orderID: 'CART-1', captureID: 'CAP-1', data: { orderID: 'CART-1' } }) });
    await approveCart();
    await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    expect(screen.queryByText('Booking confirmed!')).toBeNull();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(recoveryKey('cart')) || 'null')).toMatchObject({ orderID: 'CART-1', flow: 'cart', review: true, paymentStatus: 'CAPTURED' });
    cleanup(); buttons.length = 0;
    render(<CartCheckout onClose={() => {}} />);
    expect(await screen.findByText('Payment received; our team is verifying it')).toBeInTheDocument();
    expect(screen.getByText('CART-1')).toBeInTheDocument();
    expect(screen.queryByText('Confirm & pay')).toBeNull();
    expect(buttons).toHaveLength(0);
  });

  it('a capture exception keeps the cart and the pointer; durable success clears both exactly once', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => { if (url === '/api/createCartOrder') return json(url, cartCreate); throw new Error('network lost'); });
    await approveCart();
    await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(await screen.findByText('Check this order')).toBeInTheDocument();
    route({ '/api/captureCartOrder': (body) => { expect(body).toEqual({ orderID: 'CART-1', reconcile: true }); return { ok: true, finalized: true, data: { orderID: 'CART-1', lineCount: 1, amount: '100.00', currency: 'USD' } }; } });
    fireEvent.click(screen.getByText('Check this order'));
    expect(await screen.findByText('Booking confirmed!')).toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(recoveryKey('cart'))).toBeNull();
  });

  it('a server-proven refund of the same order releases the pointer but keeps the cart: no success, checkout re-enabled', async () => {
    const replies = [{ ...pending('CART-1'), flow: 'cart' }, refunded('CART-1')];
    route({ '/api/createCartOrder': () => cartCreate, '/api/captureCartOrder': () => replies.shift() });
    await approveCart();
    await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
    fireEvent.click(await screen.findByText('Check this order'));
    await waitFor(() => expect(localStorage.getItem(recoveryKey('cart'))).toBeNull());
    expect(await screen.findByText('Confirm & pay')).toBeInTheDocument();
    expect(screen.getByText(REFUNDED_MSG)).toBeInTheDocument();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(screen.queryByText('Booking confirmed!')).toBeNull();
  });

  it('a server-side create block adopts the unresolved order and never renders PayPal buttons', async () => {
    route({ '/api/createCartOrder': () => ({ ...pending('ORD-3'), flow: 'single' }) });
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByText('Confirm & pay'));
    expect(await screen.findByText('ORD-3')).toBeInTheDocument();
    expect(buttons).toHaveLength(0);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});

describe('RECOVERY_AUTH_REQUIRED on a fresh order (2026-10-10 R2) — no flow-wide lock', () => {
  const authRequired = { ok: false, code: 'RECOVERY_AUTH_REQUIRED', error: 'The original checkout session is required for this order' };

  it('single: the pointer is cleared, the notice is shown as an error, and no "Check this order" panel locks the flow', async () => {
    route({ '/api/createPaypalOrder': () => createOk, '/api/capturePaypalOrder': () => authRequired });
    const onSuccess = await approveSingle();
    await act(async () => { await buttons[0].onApprove({ orderID: 'ORD-1' }); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(localStorage.getItem(recoveryKey('single'))).toBeNull();
    expect(await screen.findByText(/only be checked from the device/)).toBeInTheDocument();
    expect(screen.queryByText('Check this order')).toBeNull();
  });

  it('cart: same — pointer cleared, cart kept, error state', async () => {
    route({ '/api/createCartOrder': () => ({ ok: true, data: { orderID: 'CART-1', usdAmount: '100.00', totalKRW: 135000 } }), '/api/captureCartOrder': () => authRequired });
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByText('Confirm & pay'));
    await waitFor(() => expect(buttons).toHaveLength(1));
    await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
    expect(localStorage.getItem(recoveryKey('cart'))).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(await screen.findByText(/only be checked from the device/)).toBeInTheDocument();
    expect(screen.queryByText('Check this order')).toBeNull();
  });
});
