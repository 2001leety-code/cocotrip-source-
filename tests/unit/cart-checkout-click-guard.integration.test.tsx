// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (value: null) => void) => {
    callback(null);
    return vi.fn();
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
  onSnapshot: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));

import { CartCheckout } from '../../src/components/CartCheckout';
import { LanguageProvider } from '../../src/hooks/useLanguage';
import { setLocalCart } from '../../src/lib/cart-storage';

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('CartCheckout duplicate-click guard', () => {
  beforeEach(() => {
    localStorage.setItem('cocotrip_lang', 'en');
    setLocalCart([{
      id: 'synthetic-private', type: 'tour', productType: 'charter_seoul_city',
      displayName: 'Synthetic private tour', priceKRW: 337500, addedAt: 1,
      booking: { productType: 'charter_seoul_city', passengers: 2, dateStart: '2030-01-05' },
    }]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(502, { ok: false, error: 'synthetic order failure' }))
      .mockResolvedValueOnce(response(502, { ok: false, error: 'synthetic retry failure' })));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends one order request for two native clicks in one event and allows retry after server failure', async () => {
    render(<LanguageProvider><CartCheckout onClose={() => {}} /></LanguageProvider>);
    const button = screen.getByRole('button', { name: 'Confirm & pay' });

    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(screen.getByText('synthetic order failure')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/createCartOrder');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & pay' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('synthetic retry failure')).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === '/api/createCartOrder')).toBe(true);
  });
});
