// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  loading: false,
  language: 'en' as 'ko' | 'en' | 'ja' | 'zh',
}));

const firebaseMocks = vi.hoisted(() => ({
  handleRedirectResult: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithLine: vi.fn(),
}));

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user, loading: authState.loading }),
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: authState.language }),
}));

vi.mock('../../src/lib/firebase', () => firebaseMocks);

const { AuthRequired } = await import('../../src/components/AuthRequired');

void React;

const HEADINGS = {
  ko: '로그인이 필요합니다',
  en: 'Sign in to continue',
  ja: 'ログインしてください',
  zh: '请登录以继续',
} as const;

beforeEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  authState.user = null;
  authState.loading = false;
  authState.language = 'en';
  firebaseMocks.handleRedirectResult.mockReset().mockResolvedValue(null);
  firebaseMocks.signInWithGoogle.mockReset().mockResolvedValue(undefined);
  firebaseMocks.signInWithLine.mockReset().mockResolvedValue(undefined);
});

describe('shared AuthRequired editorial shell', () => {
  it.each(Object.entries(HEADINGS))('renders the %s signed-out document without protected children', async (language, heading) => {
    authState.language = language as keyof typeof HEADINGS;
    render(<AuthRequired><p>Protected account content</p></AuthRequired>);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('auth-required-shell')).toHaveAttribute('data-state', 'signed-out');
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Protected account content')).toBeNull();
    expect(firebaseMocks.signInWithGoogle).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithLine).not.toHaveBeenCalled();
  });

  it('announces account checking as a named busy state', () => {
    authState.loading = true;
    firebaseMocks.handleRedirectResult.mockReturnValue(new Promise(() => {}));
    render(<AuthRequired><p>Protected account content</p></AuthRequired>);

    const shell = screen.getByTestId('auth-required-shell');
    expect(shell).toHaveAttribute('data-state', 'loading');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
  });

  it('keeps development presentation fixtures outside the auth redirect flow', async () => {
    window.history.replaceState({}, '', '/mypage?__authFixture=signed-out');
    render(<AuthRequired><p>Protected account content</p></AuthRequired>);

    expect(await screen.findByRole('heading', { level: 1, name: HEADINGS.en })).toBeInTheDocument();
    expect(firebaseMocks.handleRedirectResult).not.toHaveBeenCalled();
  });

  it('passes protected content through for an authenticated user', async () => {
    authState.user = { uid: 'traveler-1' };
    render(<AuthRequired><p>Protected account content</p></AuthRequired>);

    expect(await screen.findByText('Protected account content')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-required-shell')).toBeNull();
  });

  it('renders the LINE provider only when its production feature flag is enabled', async () => {
    vi.stubEnv('VITE_LINE_OIDC_ENABLED', 'true');
    vi.resetModules();

    try {
      const { AuthRequired: AuthRequiredWithLine } = await import('../../src/components/AuthRequired');
      render(<AuthRequiredWithLine><p>Protected account content</p></AuthRequiredWithLine>);

      expect(await screen.findByRole('button', { name: 'Continue with LINE' })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps provider failures inside an assertive readable state', async () => {
    firebaseMocks.signInWithGoogle.mockRejectedValueOnce(new Error('provider unavailable'));
    render(<AuthRequired><p>Protected account content</p></AuthRequired>);

    const google = await screen.findByRole('button', { name: 'Continue with Google' });
    fireEvent.click(google);

    expect(await screen.findByRole('alert')).toHaveTextContent('provider unavailable');
  });

  it('locks the presentation to flat editorial tokens while preserving auth calls', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editorial-auth-required.css'), 'utf8');
    const source = readFileSync(resolve(process.cwd(), 'src/components/AuthRequired.tsx'), 'utf8');

    expect(css).toContain('.auth-required-shell');
    expect(css).toContain('min-height: 48px');
    expect(css).toContain('background-color: #046b2c');
    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(source).not.toMatch(/linear-gradient/i);
    expect(source).not.toContain('hover:scale');
    expect(source).toContain('signInWithGoogle()');
    expect(source).toContain('signInWithLine()');
    expect(source).toContain('handleRedirectResult()');
  });
});
