/**
 * CommandPalette — 전역 검색 팔레트 (Cmd/Ctrl+K)
 *
 * 여행지(Regions), 주요 페이지, 내 계정, 약관으로 빠르게 이동하는 cmdk 기반 팔레트.
 * `useCommandPalette()` 훅으로 어디서든 열 수 있고, Cmd/Ctrl+K 전역 단축키는
 * CommandPaletteProvider 안에서 자동으로 등록된다.
 */
import { Component, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { CommandPaletteContext } from '@/hooks/useCommandPalette';
import { CommandPaletteStatus } from './CommandPaletteStatus';
import { loadCommandPaletteDialog } from './loadCommandPaletteDialog';

// The keyboard listener is always ready. Download the search dialog only when
// requested; keep it mounted afterwards so its normal close/focus cleanup runs.
function createDialog() {
  // A retry gets a new React.lazy instance; a rejected lazy promise is cached.
  return lazy(loadCommandPaletteDialog);
}

class SearchBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function isSearchFocus(element: Element | null): boolean {
  if (!element) return false;
  const status = document.querySelector('[data-cocotrip-search-status]');
  const dialog = document.querySelector('[data-cocotrip-search-input]')?.closest('[role="dialog"]');
  return !!(status?.contains(element) || dialog?.contains(element));
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [DialogComponent, setDialogComponent] = useState(createDialog);
  const [attempt, setAttempt] = useState(0);
  const openRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);

  const setOpen = useCallback((value: boolean) => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = null;
    if (value && !openRef.current) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setHasOpened(true);
    }
    openRef.current = value;
    setOpenState(value);
    if (!value) {
      const target = openerRef.current;
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        const active = document.activeElement;
        if (openRef.current || document.visibilityState !== 'visible' || !target?.isConnected) return;
        // Restore only a released search focus, not another field the traveller chose.
        if (active === document.body || active === document.documentElement || active === target || isSearchFocus(active)) {
          target.focus({ preventScroll: true });
        }
      });
    }
  }, []);

  const toggle = useCallback(() => setOpen(!openRef.current), [setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const retry = useCallback(() => {
    setDialogComponent(() => createDialog());
    setAttempt((value) => value + 1);
  }, []);

  // ── Global Cmd/Ctrl+K handler ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && openRef.current) {
        e.preventDefault();
        close();
      }
    };
    const onVisibility = () => {
      // A late import must not unexpectedly open a dialog in a hidden document.
      if (document.visibilityState !== 'visible' && openRef.current) close();
    };
    window.addEventListener('keydown', handler);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', handler);
      document.removeEventListener('visibilitychange', onVisibility);
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    };
  }, [toggle, close]);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
      {hasOpened && (
        <SearchBoundary key={attempt} fallback={<CommandPaletteStatus open={open} failed onClose={close} onRetry={retry} />}>
          <Suspense fallback={<CommandPaletteStatus open={open} onClose={close} />}>
            <DialogComponent open={open} setOpen={setOpen} />
          </Suspense>
        </SearchBoundary>
      )}
    </CommandPaletteContext.Provider>
  );
}
