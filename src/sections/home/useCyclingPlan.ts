import { useEffect, useState } from 'react';

export const PLAN_CYCLE_MS = 5000;

export function nextPlanIndex(index: number, count: number): number {
  return count > 0 ? (index + 1) % count : 0;
}

/**
 * Index into EXAMPLE_PLANS for the hero pass. Advances every `intervalMs`
 * unless `paused` (button, hover/focus, reduced motion) or the tab is hidden.
 * A manual pick restarts the full interval for that plan.
 */
export function useCyclingPlan(count: number, paused: boolean, intervalMs: number = PLAN_CYCLE_MS) {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (paused || hidden || count < 2) return;
    const id = window.setTimeout(() => setIndex((i) => nextPlanIndex(i, count)), intervalMs);
    return () => window.clearTimeout(id);
  }, [paused, hidden, count, intervalMs, index]);

  return [index, setIndex] as const;
}
