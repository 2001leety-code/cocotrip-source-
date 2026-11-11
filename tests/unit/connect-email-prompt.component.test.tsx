// @vitest-environment jsdom
// Onboarding r1 E2–E4 — connect-Google prompt visibility, outcomes, and the coupon / bookings guards.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';

void React;
type U = { uid: string; isAnonymous?: boolean; email?: string | null } | null;

const h = vi.hoisted(() => ({
  user: null as U,
  link: vi.fn(),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  authFetch: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock('@/hooks/useLanguage', async () => {
  const t = (await import('../../src/i18n/locales/en.json')).default;
  return { useLanguage: () => ({ t, language: 'en' }) };
});
vi.mock('@/lib/firebase-auth', () => ({
  linkGoogleAccount: h.link, signInWithGoogle: h.signIn, signOutUser: h.signOut,
  auth: { get currentUser() { return h.user; } },
}));
vi.mock('@/lib/authFetch', () => ({ authFetch: h.authFetch, authDownload: vi.fn() }));

const { ConnectEmailPrompt } = await import('../../src/components/ConnectEmailPrompt');
const { blockCouponForMissingEmail, needsEmailConnection } = await import('../../src/lib/connectEmail');
const ce = en.connectEmail;
const PHONE: U = { uid: 'phone-uid', isAnonymous: false, email: null };

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  h.user = PHONE;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: h.reload } });
});
afterEach(() => cleanup());

describe('needsEmailConnection', () => {
  it.each([
    [PHONE, true], [{ uid: 'line', email: '' }, true], [{ uid: 'line', email: '  ' }, true],
    [{ uid: 'anon', isAnonymous: true, email: null }, false], [null, false],
    [{ uid: 'g', email: 'person@example.invalid' }, false],
  ])('%j → %s', (user, expected) => { expect(needsEmailConnection(user)).toBe(expected); });
});

describe('ConnectEmailPrompt visibility', () => {
  it('phone member → visible region with a keyboard-reachable connect button', () => {
    render(<ConnectEmailPrompt />);
    expect(screen.getByRole('region', { name: ce.region })).toBeInTheDocument();
    expect(screen.getByText(ce.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ce.connect })).toHaveAttribute('type', 'button');
  });

  it.each([
    ['anonymous', { uid: 'anon', isAnonymous: true, email: null }],
    ['email member', { uid: 'g', email: 'person@example.invalid' }],
    ['signed out', null],
  ])('%s → nothing rendered', (_n, user) => {
    h.user = user as U;
    const { container } = render(<ConnectEmailPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dismissed → hidden for the session (also after a remount); a coupon attempt reopens it', () => {
    const first = render(<ConnectEmailPrompt />);
    fireEvent.click(screen.getByRole('button', { name: ce.dismiss }));
    expect(screen.queryByTestId('connect-email-prompt')).toBeNull();
    first.unmount();
    render(<ConnectEmailPrompt />);
    expect(screen.queryByTestId('connect-email-prompt')).toBeNull();
    act(() => { expect(blockCouponForMissingEmail(h.user)).toBe(true); });
    expect(screen.getByTestId('connect-email-prompt')).toBeInTheDocument();
  });
});

describe('ConnectEmailPrompt outcomes', () => {
  const clickConnect = async () => {
    render(<ConnectEmailPrompt />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ce.connect })); });
  };

  it('r2: success → no reload; short "connected" message, then the banner goes away (screen kept)', async () => {
    vi.useFakeTimers();
    try {
      h.link.mockImplementationOnce(async () => {
        h.user = { uid: 'phone-uid', isAnonymous: false, email: 'person@example.invalid' };
        return { ok: true, email: 'person@example.invalid' };
      });
      await clickConnect();
      expect(h.reload).not.toHaveBeenCalled();
      expect(screen.getByText(ce.connected)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: ce.connect })).toBeNull();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.queryByTestId('connect-email-prompt')).toBeNull();
      expect(h.reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('r2: already-in-use keeps account A — primary retry links again, no sign-out', async () => {
    h.link.mockResolvedValueOnce({ ok: false, code: 'already-in-use' }).mockResolvedValueOnce({ ok: false, code: 'cancelled' });
    await clickConnect();
    expect(screen.getByText(ce.alreadyInUse)).toBeInTheDocument();
    expect(screen.getByText(ce.signInWarning)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ce.connectOther })); });
    expect(h.link).toHaveBeenCalledTimes(2);
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('r2: only the secondary "sign in with that account" button signs out then signs in with Google', async () => {
    h.link.mockResolvedValueOnce({ ok: false, code: 'already-in-use' });
    await clickConnect();
    expect(h.signOut).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ce.signInGoogle })); });
    expect(h.signOut).toHaveBeenCalledOnce();
    expect(h.signIn).toHaveBeenCalledOnce();
    expect(h.signOut.mock.invocationCallOrder[0]).toBeLessThan(h.signIn.mock.invocationCallOrder[0]);
  });

  it('r2: closing and reopening (coupon guard) clears the conflict notice', async () => {
    h.link.mockResolvedValueOnce({ ok: false, code: 'already-in-use' });
    await clickConnect();
    fireEvent.click(screen.getByRole('button', { name: ce.dismiss }));
    act(() => { blockCouponForMissingEmail(h.user); });
    expect(screen.getByText(ce.body)).toBeInTheDocument();
    expect(screen.queryByText(ce.alreadyInUse)).toBeNull();
    expect(screen.getByRole('button', { name: ce.connect })).toBeInTheDocument();
  });

  it('r2: a guard event while the notice is open also resets it', async () => {
    h.link.mockResolvedValueOnce({ ok: false, code: 'already-in-use' });
    await clickConnect();
    act(() => { blockCouponForMissingEmail(h.user); });
    expect(screen.queryByText(ce.alreadyInUse)).toBeNull();
  });

  it.each([['popup-blocked', ce.popupBlocked], ['no-email', ce.noEmail], ['failed', ce.failed]])('%s → localized message', async (code, text) => {
    h.link.mockResolvedValueOnce({ ok: false, code });
    await clickConnect();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('cancelled → quiet (back to the normal prompt)', async () => {
    h.link.mockResolvedValueOnce({ ok: false, code: 'cancelled' });
    await clickConnect();
    expect(screen.getByText(ce.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ce.connect })).toBeEnabled();
  });
});

describe('E4 bookings tab', () => {
  it('phone member: no bookings request, the connect message and a button that opens the prompt', async () => {
    const { MyBookingsTab } = await import('../../src/components/MyBookingsTab');
    render(<><MyBookingsTab userEmail="" language="en" /><ConnectEmailPrompt /></>);
    const regions = screen.getAllByRole('region', { name: ce.region });
    expect(regions.length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: ce.dismiss }));
    expect(screen.getAllByRole('region', { name: ce.region })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: ce.connect }));
    await waitFor(() => expect(screen.getByTestId('connect-email-prompt')).toBeInTheDocument());
    expect(h.authFetch).not.toHaveBeenCalled();
  });
});
