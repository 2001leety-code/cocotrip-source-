// @vitest-environment jsdom
import React, { Component, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ load: vi.fn(), language: 'ko' }));
vi.mock('../../src/components/loadCommandPaletteDialog', () => ({ loadCommandPaletteDialog: state.load }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: state.language }) }));

import { CommandPaletteProvider } from '../../src/components/CommandPalette';
import { CommandPaletteStatus } from '../../src/components/CommandPaletteStatus';
import { useCommandPalette } from '../../src/hooks/useCommandPalette';

// Vitest uses classic JSX; Vite uses react-jsx. Only synthetic data/imports here.
vi.stubGlobal('React', React);

function FakeDialog({ open, setOpen }: { open: boolean; setOpen: (value: boolean) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  return <div role="dialog" data-testid="loaded-dialog" hidden={!open}>
    <input ref={inputRef} data-cocotrip-search-input aria-label="Search query" />
    <button onClick={() => setOpen(false)}>Close loaded search</button>
  </div>;
}

function Trigger() {
  const { open, setOpen, toggle } = useCommandPalette();
  return <>
    <span data-testid="open-state">{String(open)}</span>
    <button onClick={() => setOpen(true)}>Open search</button>
    <button onClick={toggle}>Toggle search</button>
    <input aria-label="Draft" defaultValue="Unsaved test draft" />
  </>;
}

class OuterBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div>Entire page replaced</div> : this.props.children; }
}

function deferredImport() {
  let resolve!: (value: { default: typeof FakeDialog }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ default: typeof FakeDialog }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(<OuterBoundary><CommandPaletteProvider><Trigger /></CommandPaletteProvider></OuterBoundary>);
}

beforeEach(() => {
  state.load.mockReset().mockResolvedValue({ default: FakeDialog });
  state.language = 'ko';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('on-demand search dialog', () => {
  it('does not import initially; loads once on demand and stays mounted for close cleanup', async () => {
    renderPage();
    expect(state.load).not.toHaveBeenCalled();
    expect(screen.queryByTestId('loaded-dialog')).toBeNull();
    fireEvent.click(screen.getByText('Open search'));
    await screen.findByTestId('loaded-dialog');
    expect(state.load).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(false);
    fireEvent.click(screen.getByText('Close loaded search'));
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(true);
    fireEvent.click(screen.getByText('Toggle search'));
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(false);
    expect(state.load).toHaveBeenCalledTimes(1);
  });

  it.each(['ctrlKey', 'metaKey'] as const)('keeps %s+K available with StrictMode listener cleanup', async (modifier) => {
    const view = render(<StrictMode><CommandPaletteProvider><Trigger /></CommandPaletteProvider></StrictMode>);
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    expect(fireEvent.keyDown(window, { key: 'K', [modifier]: true })).toBe(false);
    await waitFor(() => expect(screen.getByTestId('loaded-dialog').hidden).toBe(false));
    fireEvent.keyDown(window, { key: 'k', [modifier]: true });
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    view.unmount();
    expect(fireEvent.keyDown(window, { key: 'k', [modifier]: true })).toBe(true);
  });

  it('ordinary typing does not request the dialog', () => {
    renderPage();
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(state.load).not.toHaveBeenCalled();
    expect(screen.getByTestId('open-state').textContent).toBe('false');
  });

  it('isolates a rejected chunk from the page and preserves the same edited field', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    const draft = screen.getByLabelText('Draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'My unsubmitted changes' } });
    fireEvent.click(screen.getByText('Open search'));
    expect(screen.getByRole('status').textContent).toBe('검색창을 준비하고 있어요.');
    await act(async () => pending.reject(new Error('FAKE_CHUNK_FAILURE')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Entire page replaced')).toBeNull();
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft.value).toBe('My unsubmitted changes');
    fireEvent.click(screen.getByRole('button', { name: '검색 닫기' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    expect(screen.getByLabelText('Draft')).toBe(draft);
  });

  it('retries with a fresh lazy instance instead of retaining the rejected promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.load.mockRejectedValueOnce(new Error('FAKE_FIRST_FAILURE'));
    renderPage();
    fireEvent.click(screen.getByText('Open search'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByTestId('loaded-dialog');
    expect(state.load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Draft')).toBeTruthy();
  });

  it('a repeatedly failed retry remains safely dismissible with Escape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.load.mockRejectedValue(new Error('FAKE_CACHED_NETWORK_FAILURE'));
    renderPage();
    fireEvent.click(screen.getByText('Open search'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByRole('alert');
    expect(state.load).toHaveBeenCalledTimes(2);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    expect(screen.getByLabelText('Draft')).toBeTruthy();
  });

  it.each(['button', 'Escape'])('allows closing pending import by %s without late reopening', async (method) => {
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    fireEvent.click(screen.getByText('Open search'));
    expect(screen.getByRole('status')).toBeTruthy();
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: '검색 닫기' }));
    else fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => pending.resolve({ default: FakeDialog }));
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(true);
    expect(screen.getByTestId('open-state').textContent).toBe('false');
  });

  it('does not show a late rejection after the pending search was closed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    fireEvent.click(screen.getByText('Open search'));
    fireEvent.click(screen.getByRole('button', { name: '검색 닫기' }));
    await act(async () => pending.reject(new Error('FAKE_LATE_FAILURE')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Entire page replaced')).toBeNull();
    fireEvent.click(screen.getByText('Open search'));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: '검색 닫기' })).toBeTruthy();
  });

  it('cancels a pending opening when the traveller focuses a draft before the dialog arrives', async () => {
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    screen.getByText('Open search').focus();
    fireEvent.click(screen.getByText('Open search'));
    const draft = screen.getByLabelText('Draft') as HTMLInputElement;
    act(() => draft.focus());
    fireEvent.input(draft, { target: { value: 'Keep writing while offline' } });
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    await act(async () => pending.resolve({ default: FakeDialog }));
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(true);
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe('Keep writing while offline');
  });

  it('cancels pending search on new typing in the same Ctrl+K opener field', async () => {
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    const draft = screen.getByLabelText('Draft') as HTMLInputElement;
    draft.focus();
    fireEvent.keyDown(draft, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('open-state').textContent).toBe('true');
    fireEvent.input(draft, { target: { value: 'Continued in the same field' } });
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    await act(async () => pending.resolve({ default: FakeDialog }));
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(true);
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe('Continued in the same field');
  });

  it('closes pending search when hidden and does not reopen or focus after late resolution', async () => {
    const pending = deferredImport();
    state.load.mockReturnValueOnce(pending.promise);
    renderPage();
    const opener = screen.getByText('Open search');
    opener.focus();
    fireEvent.click(opener);
    const focus = vi.spyOn(opener, 'focus');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    await act(async () => {
      pending.resolve({ default: FakeDialog });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.getByTestId('loaded-dialog').hidden).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('open-state').textContent).toBe('false');
  });

  it('returns released search focus to its opener after close', async () => {
    renderPage();
    const opener = screen.getByText('Open search');
    opener.focus();
    fireEvent.click(opener);
    const input = await screen.findByLabelText('Search query');
    input.focus();
    fireEvent.click(screen.getByText('Close loaded search'));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('does not steal focus from a field chosen immediately after closing', async () => {
    renderPage();
    const opener = screen.getByText('Open search');
    opener.focus();
    fireEvent.click(opener);
    (await screen.findByLabelText('Search query')).focus();
    fireEvent.click(screen.getByText('Close loaded search'));
    const draft = screen.getByLabelText('Draft');
    draft.focus();
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(draft);
  });

  it('keeps heavy UI deferred and every previous destination, without a page reload recovery', () => {
    const provider = readFileSync('src/components/CommandPalette.tsx', 'utf8');
    const loader = readFileSync('src/components/loadCommandPaletteDialog.ts', 'utf8');
    const status = readFileSync('src/components/CommandPaletteStatus.tsx', 'utf8');
    expect(provider).toContain('lazy(loadCommandPaletteDialog)');
    expect(loader).toContain("import('./CommandPaletteDialog')");
    expect(provider).not.toContain("from '@/components/ui/command'");
    expect(provider + loader + status).not.toMatch(/location\s*\.|window\.open\s*\(/);
    const dialog = readFileSync('src/components/CommandPaletteDialog.tsx', 'utf8');
    for (const destination of ['/', '/tours', '/charter', '/planner', '/about', '/mypage', '/my-plans', '/terms', '/privacy', '/travel-terms']) {
      expect(dialog).toContain(`go('${destination}')`);
    }
    expect(dialog).toContain('go(`/region/${id}`)');
    expect(dialog).toContain('onOpenChange={setOpen}');
  });
});

describe('search loading/failure controls', () => {
  it.each([
    ['ko', '검색창을 준비하고 있어요.', '검색 닫기', '다시 시도', '작성 내용을 따로 보관한 뒤 페이지를 다시 열어주세요.'],
    ['en', 'Loading search…', 'Close search', 'Try again', 'keep a copy of your draft before reopening this page.'],
    ['ja', '検索を準備しています。', '検索を閉じる', '再試行', '入力内容を控えてからこのページを開き直してください。'],
    ['zh', '正在准备搜索。', '关闭搜索', '重试', '请先另存输入内容，再重新打开本页。'],
  ])('uses current %s language and 44px accessible buttons', (language, loading, close, retry, recovery) => {
    state.language = language;
    const onClose = vi.fn();
    const onRetry = vi.fn();
    const view = render(<CommandPaletteStatus open onClose={onClose} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toBe(loading);
    expect(screen.queryByRole('button', { name: retry })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: close }));
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<CommandPaletteStatus open failed onClose={onClose} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain(recovery);
    fireEvent.click(screen.getByRole('button', { name: retry }));
    expect(onRetry).toHaveBeenCalledOnce();
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
      expect(button.className).toContain('focus-visible:ring-2');
    }
  });

  it('updates copy while open when language changes', () => {
    const view = render(<CommandPaletteStatus open failed onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: '검색 닫기' })).toBeTruthy();
    state.language = 'en';
    view.rerender(<CommandPaletteStatus open failed onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '검색 닫기' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close search' })).toBeTruthy();
  });
});
