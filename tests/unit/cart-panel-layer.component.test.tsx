// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

void React;
const mocks = vi.hoisted(() => ({
  enabled: true,
  useCart: vi.fn(() => ({ items: [], remove: vi.fn(), clear: vi.fn(), loading: false })),
}));
vi.mock('@/hooks/useCart', () => ({ useCart: mocks.useCart }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { cart: { title: 'Cart', empty: 'Your cart is empty' }, a11y: { close: 'Close' } } }),
}));
vi.mock('@/lib/cart-types', () => ({ isCartEnabled: () => mocks.enabled }));
import { CartPanel } from '../../src/components/CartButton';

beforeEach(() => { mocks.enabled = true; mocks.useCart.mockClear(); });
afterEach(cleanup);

describe('Cart panel above the common header', () => {
  it('keeps feature-off inert without subscribing to cart', () => {
    mocks.enabled = false;
    const onOpen = vi.fn();
    render(<CartPanel onOpen={onOpen} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.useCart).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('portals above the header using the full-screen modal layer', () => {
    const { container } = render(<CartPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));
    const panel = document.querySelector('.customer-cart-panel')!;
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement?.parentElement).toBe(document.body);
    expect(panel.parentElement?.classList.contains('z-[10000]')).toBe(true);
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(document.querySelector('.customer-cart-header')?.classList.contains('z-10')).toBe(true);
  });

  it('notifies the header on each open so its mobile menu can close', () => {
    const onOpen = vi.fn();
    render(<CartPanel onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const close = screen.getByRole('button', { name: 'Close', exact: true });
    expect(close.classList.contains('min-h-[44px]')).toBe(true);
    expect(close.classList.contains('min-w-[44px]')).toBe(true);
    fireEvent.click(close);
    expect(document.querySelector('.customer-cart-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps inside clicks open and closes on the backdrop', () => {
    render(<CartPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));
    fireEvent.mouseDown(screen.getByText('Your cart is empty'));
    const panel = document.querySelector('.customer-cart-panel')!;
    expect(panel).toBeTruthy();
    fireEvent.mouseDown(panel.parentElement!);
    expect(document.querySelector('.customer-cart-panel')).toBeNull();
  });
});
