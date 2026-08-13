// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const languageState = vi.hoisted(() => ({
  language: 'en' as 'ko' | 'en' | 'ja' | 'zh',
  changeLanguage: vi.fn(),
}));
const chatSessionMock = vi.hoisted(() => vi.fn());
const trackChatOpenMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: languageState.language,
    changeLanguage: languageState.changeLanguage,
  }),
}));
vi.mock('../../src/hooks/useChatSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/hooks/useChatSession')>(),
  useChatSession: chatSessionMock,
}));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('../../src/lib/analytics', () => ({ trackChatOpen: trackChatOpenMock }));

const { default: AssistantPage } = await import('../../src/pages/AssistantPage');

void React;

function renderAssistant(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AssistantPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  languageState.language = 'en';
  languageState.changeLanguage.mockReset();
  chatSessionMock.mockReset();
  trackChatOpenMock.mockReset();
  chatSessionMock.mockReturnValue({
    user: null,
    messages: [],
    loading: false,
    sendMessage: vi.fn(),
    quickShown: false,
    sessionId: 'fixture-session',
  });
});

describe('assistant editorial shell', () => {
  it('renders a semantic signed-out desk without activating chat or analytics', () => {
    renderAssistant('/assistant?__fixture=signed-out');

    const shell = screen.getByTestId('assistant-editorial-shell');
    expect(shell).toHaveAttribute('data-state', 'signed-out');
    expect(screen.getByRole('heading', { level: 1, name: 'CocoTrip assistant' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign in to chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(chatSessionMock).toHaveBeenCalledWith('en', false);
    expect(trackChatOpenMock).not.toHaveBeenCalled();
  });

  it('exposes four real language controls with the current language selected', () => {
    renderAssistant('/assistant?__fixture=signed-out');

    const group = screen.getByRole('group', { name: 'Choose language' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the deterministic conversation and sending states without a request', () => {
    const { unmount } = renderAssistant('/assistant?__fixture=ready');

    expect(screen.getByTestId('assistant-editorial-shell')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    unmount();

    renderAssistant('/assistant?__fixture=loading');
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Preparing a reply');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('announces a deterministic sign-in failure without invoking authentication', () => {
    renderAssistant('/assistant?__fixture=auth-error');

    expect(screen.getByTestId('assistant-editorial-shell')).toHaveAttribute('data-state', 'auth-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in is unavailable in this preview.');
  });

  it('keeps route styling flat, scoped and large enough for touch and mobile input', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editorial-assistant.css'), 'utf8');
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AssistantPage.tsx'), 'utf8');

    expect(css).toContain('.assistant-editorial-page');
    expect(css).toContain('min-height: 44px');
    expect(css).toMatch(/\.assistant-editorial-input[\s\S]*font-size:\s*1rem/);
    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(source).not.toContain('COCO.ctaGradient');
    expect(source).not.toContain('backdropFilter');
    expect(source).toContain("import.meta.env.DEV ? getAssistantFixture(searchParams.get('__fixture')) : null");
    expect(source).toContain('signInWithGoogle()');
    expect(source).toContain('sendMessage(text)');
  });
});
