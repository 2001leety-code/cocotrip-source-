// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { CartItem } from '@/lib/cart-types';

void React;
const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/hooks/useGuestSignup', () => ({ useGuestSignup: () => ({ signupLoading: false, signupError: null, handleGuestSignup: vi.fn() }) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/paymentRecovery', () => ({
  usePaymentRecovery: () => ({ recovery: null, remember: vi.fn(), clearRecovery: vi.fn() }),
  recoveryCopy: () => ({}), recoveryHeadline: vi.fn(), reconcilePayment: vi.fn(), classifyCaptureResponse: vi.fn(),
}));
import { useCart } from '@/hooks/useCart';
import { setLocalCart, subscribeLocalCart, CART_LS_KEY } from '@/lib/cart-storage';
import { CartCheckout } from '@/components/CartCheckout';
import { CartAddButton, CartPanel } from '@/components/CartButton';

const tour: CartItem = { id: 'tour-test', booking: { productType: 'charter_seoul_city', passengers: 2 }, displayName: 'Test tour', priceUSD: 250, priceKRW: 337500, addedAt: 1 };
const charter: CartItem = { id: 'charter-test', booking: { productType: 'airport_seoul_central', passengers: 2 }, displayName: 'Test charter', priceKRW: 124800, addedAt: 2 };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubEnv('VITE_FEATURE_CART', 'true'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('guest cart display regression', () => {
  it('shows both amounts and a complete USD total for an existing KRW-only charter', () => {
    setLocalCart([tour, charter]);
    render(<CartCheckout onClose={() => {}} />);
    expect(screen.getByText('$250')).toBeTruthy();
    expect(screen.getByText('$92')).toBeTruthy();
    expect(screen.getByText('$342.00')).toBeTruthy();
    expect(screen.queryByText('$250.00')).toBeNull();
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('does not label a partial sum as the total when one line has no usable price', () => {
    setLocalCart([tour, { ...charter, priceKRW: undefined }]);
    render(<CartCheckout onClose={() => {}} />);
    expect(screen.getByText('Shown at payment')).toBeTruthy();
    expect(screen.queryByText('$250.00')).toBeNull();
  });

  it('updates the already-mounted header, panel and add buttons without navigation', async () => {
    render(<><CartPanel /><CartAddButton {...tour} /><CartAddButton {...charter} /></>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]);
    expect(screen.getByRole('button', { name: 'Cart', exact: true }).textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(screen.getByRole('button', { name: 'Cart', exact: true }).textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Cart', exact: true }));
    expect(screen.getByText('Test tour')).toBeTruthy();
    expect(screen.getByText('Test charter')).toBeTruthy();
    expect(screen.getByText('$92')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.getByRole('button', { name: 'Cart', exact: true }).textContent).toBe('1');
    expect(screen.getAllByRole('button', { name: 'Add to cart' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }));
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add to cart' })).toHaveLength(2);
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('syncs another tab change, ignores other keys and syncs a storage clear', () => {
    const peer = renderHook(() => useCart());
    act(() => {
      localStorage.setItem(CART_LS_KEY, JSON.stringify([tour, charter]));
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(peer.result.current.count).toBe(0);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CART_LS_KEY })); });
    expect(peer.result.current.count).toBe(2);
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(peer.result.current.count).toBe(0);
  });
});
it('pins review lines during creation and after ready when another tab changes the cart', async () => {
  setLocalCart([tour, charter]);
  let answer: (value: unknown) => void = () => {};
  mocks.authFetch.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-test-client');
  const paypalWindow = window as unknown as { paypal?: unknown };
  let buttonConfig: { onError: (error: unknown) => void } | undefined;
  paypalWindow.paypal = { Buttons: (config: { onError: (error: unknown) => void }) => { buttonConfig = config; return { render: () => {} }; } };
  try {
    render(<CartCheckout onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & pay' }));
    act(() => setLocalCart([{ ...tour, id: 'later-item', displayName: 'Later item', priceUSD: 100 }]));
    expect(screen.getByText('Test charter')).toBeTruthy();
    expect(screen.getByText('$342.00')).toBeTruthy();
    expect(screen.queryByText('Later item')).toBeNull();
    await act(async () => { answer({ json: async () => ({ ok: true, data: { orderID: 'OFFLINE-TEST-ORDER', usdAmount: '342.00', totalKRW: 462300 } }) }); });
    act(() => setLocalCart([]));
    expect(screen.getByText('Test tour')).toBeTruthy();
    expect(screen.getByText('Test charter')).toBeTruthy();
    expect(screen.getByText(/342.00/)).toBeTruthy();
    const request = JSON.parse(mocks.authFetch.mock.calls[0][1].body);
    expect(request.items.map((item: CartItem) => item.id)).toEqual(['tour-test', 'charter-test']);
    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
    act(() => { setLocalCart([{ ...tour, id: 'later-item', displayName: 'Later item', priceUSD: 100 }]); buttonConfig!.onError(new Error('Offline SDK error')); });
    expect(screen.getByText('Later item')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.queryByText(/342.00/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & pay' }));
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.queryByText(/342.00/)).toBeNull();
    expect(mocks.authFetch).toHaveBeenCalledTimes(2);
  } finally { delete paypalWindow.paypal; }
});

it('unsubscribes guest storage listeners and ignores sessionStorage events', () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeLocalCart(onChange);
  window.dispatchEvent(new StorageEvent('storage', { key: CART_LS_KEY, storageArea: sessionStorage }));
  expect(onChange).not.toHaveBeenCalled();
  setLocalCart([tour]);
  expect(onChange).toHaveBeenCalledTimes(1);
  unsubscribe();
  setLocalCart([charter]);
  window.dispatchEvent(new StorageEvent('storage', { key: CART_LS_KEY }));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('restores persisted guest items when the hook remounts', () => {
  setLocalCart([tour,charter]);
  const first = renderHook(() => useCart());
  expect(first.result.current.count).toBe(2);
  first.unmount();
  const restored = renderHook(() => useCart());
  expect(restored.result.current.items.map(item => item.id)).toEqual(['tour-test','charter-test']);
});
