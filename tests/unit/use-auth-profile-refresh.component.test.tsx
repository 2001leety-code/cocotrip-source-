// @vitest-environment jsdom
// Onboarding r2 — after a Google link the SAME User object gains an email without an
// onAuthStateChanged event; the profile-update event re-renders useAuth consumers (no page reload).
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

void React;

const h = vi.hoisted(() => ({
  user: { uid: 'phone-uid', isAnonymous: false, email: null as string | null, getIdToken: async () => 't' },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, next: (u: unknown) => void) => { next(h.user); return () => {}; },
}));
vi.mock('@/lib/firebase-auth', () => ({ auth: {} }));

const { useAuth } = await import('../../src/hooks/useAuth');
const { AUTH_PROFILE_EVENT } = await import('../../src/lib/connectEmail');

function EmailLabel() {
  const { user } = useAuth();
  return <span data-testid="email">{user && user.email ? user.email : 'none'}</span>;
}

afterEach(() => cleanup());

describe('useAuth profile refresh', () => {
  it('re-renders consumers with the new email on the profile-update event', () => {
    render(<EmailLabel />);
    expect(screen.getByTestId('email')).toHaveTextContent('none');
    h.user.email = 'person@example.invalid'; // what user.reload() does after linkWithPopup
    expect(screen.getByTestId('email')).toHaveTextContent('none'); // no auth-state event → stale
    act(() => { window.dispatchEvent(new CustomEvent(AUTH_PROFILE_EVENT)); });
    expect(screen.getByTestId('email')).toHaveTextContent('person@example.invalid');
  });
});
