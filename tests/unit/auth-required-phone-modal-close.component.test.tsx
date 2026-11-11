// @vitest-environment jsdom
// Onboarding r1 B2: once a user is signed in, the phone modal state is cleared, so a later sign-out
// shows the plain sign-in screen instead of a stale, still-open phone modal.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ user: null as { uid: string } | null }));

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: authState.user, loading: false }) }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('../../src/lib/firebase-auth.js', () => ({
  handleRedirectResult: vi.fn(async () => null),
  signInWithGoogle: vi.fn(),
  signInWithLine: vi.fn(),
}));
vi.mock('../../src/components/PhoneSignInModal', () => ({
  PhoneSignInModal: () => <div data-testid="phone-modal-stub" />,
}));

const { AuthRequired } = await import('../../src/components/AuthRequired');
void React;

afterEach(() => { cleanup(); authState.user = null; });

describe('AuthRequired phone modal after sign-in', () => {
  it('closes the phone modal when a user appears, so sign-out does not reopen it', async () => {
    const tree = () => <AuthRequired><p>Protected</p></AuthRequired>;
    const view = render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with phone' }));
    expect(await screen.findByTestId('phone-modal-stub')).toBeInTheDocument();

    authState.user = { uid: 'phone-user' };
    view.rerender(tree());
    expect(await screen.findByText('Protected')).toBeInTheDocument();

    authState.user = null;
    view.rerender(tree());
    expect(await screen.findByRole('button', { name: 'Continue with phone' })).toBeInTheDocument();
    expect(screen.queryByTestId('phone-modal-stub')).toBeNull();
  });
});
