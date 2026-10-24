// @vitest-environment jsdom
/**
 * 2026-10-24 (유입·전환 점검) — 장바구니 결제 성공 화면의 게스트 → 회원 전환 넛지.
 *   비로그인 → GuestSignupNudge(결제자 이메일), 로그인 → 렌더 안 함. 결제 상태 흐름은 그대로(완전 오프라인 모킹).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), clear: vi.fn(async () => {}), user: null as null | { uid: string; email: string }, signIn: vi.fn(async () => {}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useCart', () => ({ useCart: () => ({ items: [{ id: 'item-1', displayName: 'Airport pickup', priceUSD: '100', priceKRW: 135000, booking: { dateStart: '2026-12-01', passengers: 2 } }], clear: mocks.clear }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: mocks.signIn, auth: { currentUser: null } }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('@/lib/tourSlotBooking', () => ({ SLOT_REJECT_LABELS: { en: { SLOT_FULL: 'full', DATE_UNAVAILABLE: 'unavailable' } } }));
vi.mock('@/components/GuestSignupNudge', async () => {
  const R = await import('react');
  return {
    GuestSignupNudge: ({ email, onGoogleLogin }: { email?: string | null; onGoogleLogin: () => void }) =>
      R.createElement('button', { 'data-testid': 'guest-nudge', onClick: onGoogleLogin }, `nudge:${email || ''}`),
  };
});

import { CartCheckout } from '../../src/components/CartCheckout';

type ButtonsConfig = { onApprove: (data: { orderID: string }) => Promise<void> };
const buttons: ButtonsConfig[] = [];
const cartCreate = { ok: true, data: { orderID: 'CART-1', usdAmount: '100.00', totalKRW: 135000 } };
const cartFinal = { ok: true, finalized: true, data: { orderID: 'CART-1', lineCount: 1, amount: '100.00', currency: 'USD', payerEmail: 'payer@example.invalid' } };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  buttons.length = 0;
  mocks.user = null;
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'offline-client');
  (window as unknown as { paypal: unknown }).paypal = { Buttons: (cfg: ButtonsConfig) => { buttons.push(cfg); return { render: () => {}, isEligible: () => true }; }, FUNDING: {} };
  mocks.authFetch.mockImplementation(async (url: string) => {
    const body = url === '/api/createCartOrder' ? cartCreate : url === '/api/captureCartOrder' ? cartFinal : null;
    if (!body) throw new Error(`OFFLINE: unexpected ${url}`);
    return { ok: true, status: 200, json: async () => body };
  });
});

async function payCart() {
  render(<CartCheckout onClose={() => {}} />);
  fireEvent.click(screen.getByText('Confirm & pay'));
  await waitFor(() => expect(buttons).toHaveLength(1));
  await act(async () => { await buttons[0].onApprove({ orderID: 'CART-1' }); });
  expect(await screen.findByText('Booking confirmed!')).toBeInTheDocument();
}

describe('CartCheckout success — guest signup nudge', () => {
  it('guest: the nudge is shown with the payer email, and its button runs the shared Google sign-in', async () => {
    await payCart();
    const nudge = screen.getByTestId('guest-nudge');
    expect(nudge).toHaveTextContent('nudge:payer@example.invalid');
    fireEvent.click(nudge);
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
  });

  it('signed-in user: no nudge', async () => {
    mocks.user = { uid: 'u1', email: 'member@example.invalid' };
    await payCart();
    expect(screen.queryByTestId('guest-nudge')).toBeNull();
  });
});
