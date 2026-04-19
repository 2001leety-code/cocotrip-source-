// Slide navigation state + URL hash sync.
// Hash format: #slide-N (0-indexed). Uses replaceState to avoid back-button spam.
import { useState, useCallback, useEffect } from 'react';

export function useSwipeNavigation(totalSlides: number) {
  const [current, setCurrent] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const hash = window.location.hash;
    const match = hash.match(/^#slide-(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx >= 0 && idx < totalSlides) return idx;
    }
    // Legacy: convert #day-N to approximate slide index (skip for now, start at 0)
    return 0;
  });

  // Sync hash on slide change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(null, '', `#slide-${current}`);
  }, [current]);

  const goToSlide = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalSlides) return;
    setCurrent(idx);
  }, [totalSlides]);

  const goNext = useCallback(() => {
    setCurrent(c => Math.min(c + 1, totalSlides - 1));
  }, [totalSlides]);

  const goPrev = useCallback(() => {
    setCurrent(c => Math.max(c - 1, 0));
  }, []);

  return { current, goToSlide, goNext, goPrev };
}
