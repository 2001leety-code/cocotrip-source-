// Slide navigation state + URL hash sync.
// Hash format: #slide-N (0-indexed). Uses replaceState to avoid back-button spam.
import { useState, useCallback, useEffect } from 'react';

interface NavigationOptions {
  navigationKey?: string;
  /** False while loading/streaming may still add slides. */
  ready?: boolean;
}

function readSlideIntent(): number {
  if (typeof window === 'undefined') return 0;
  const match = window.location.hash.match(/^#slide-(\d+)$/);
  const index = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(index) && index >= 0 ? index : 0;
}

export function useSwipeNavigation(totalSlides: number, options: NavigationOptions = {}) {
  const count = Number.isInteger(totalSlides) && totalSlides > 0 ? totalSlides : 0;
  const navigationKey = options.navigationKey || '';
  const ready = options.ready === undefined ? count > 0 : options.ready;
  // Keep the requested index separate from the currently available slide range.
  // A partial streamed itinerary must not consume a saved #slide-3 intent.
  const [selection, setSelection] = useState(() => ({ navigationKey, intent: readSlideIntent() }));
  if (selection.navigationKey !== navigationKey) {
    setSelection({ navigationKey, intent: readSlideIntent() });
  }
  const intent = selection.navigationKey === navigationKey ? selection.intent : readSlideIntent();
  const current = count > 0 ? Math.min(intent, count - 1) : 0;
  // Once loading is complete, a shorter itinerary consumes the out-of-range intent.
  if (ready && count > 0 && selection.navigationKey === navigationKey && intent !== current) {
    setSelection({ navigationKey, intent: current });
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readLocation = () => setSelection({ navigationKey, intent: readSlideIntent() });
    window.addEventListener('hashchange', readLocation);
    window.addEventListener('popstate', readLocation);
    return () => {
      window.removeEventListener('hashchange', readLocation);
      window.removeEventListener('popstate', readLocation);
    };
  }, [navigationKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || count === 0 || selection.navigationKey !== navigationKey) return;
    if (!ready && intent >= count) return;
    const hash = `#slide-${current}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [count, current, intent, navigationKey, ready, selection.navigationKey]);

  const goToSlide = useCallback((index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= count) return;
    setSelection({ navigationKey, intent: index });
  }, [count, navigationKey]);

  const goNext = useCallback(() => {
    if (count === 0) return;
    setSelection(previous => ({
      navigationKey,
      intent: Math.min((previous.navigationKey === navigationKey ? Math.min(previous.intent, count - 1) : 0) + 1, count - 1),
    }));
  }, [count, navigationKey]);

  const goPrev = useCallback(() => {
    if (count === 0) return;
    setSelection(previous => ({
      navigationKey,
      intent: Math.max((previous.navigationKey === navigationKey ? Math.min(previous.intent, count - 1) : 0) - 1, 0),
    }));
  }, [count, navigationKey]);

  return { current, goToSlide, goNext, goPrev };
}
