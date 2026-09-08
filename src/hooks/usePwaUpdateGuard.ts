import { useEffect, useState } from 'react';
import { createPwaUpdateGuard, hasFocusedEditable, INITIAL_UPDATE_STATE, isPaymentLikelyInProgress } from '@/lib/pwaUpdateGuard';
const reloadPage = () => window.location.reload();

// Registration captures callbacks on first render; this stable guard reads live state.
export function usePwaUpdateGuard(reload = reloadPage) {
  const [state, setState] = useState(INITIAL_UPDATE_STATE);
  const [guard] = useState(() => createPwaUpdateGuard({
    now: () => Date.now(), editable: () => hasFocusedEditable(document),
    payment: () => isPaymentLikelyInProgress(document), visible: () => document.visibilityState !== 'hidden',
    reload, publish: setState,
    schedule(callback, delay) { const timer = window.setTimeout(callback, delay); return () => window.clearTimeout(timer); },
  }));
  useEffect(() => {
    guard.mount();
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'input', 'change', 'focusin'] as const;
    const options = { passive: true, capture: true };
    for (const event of events) window.addEventListener(event, guard.markInteraction, options);
    const visibilityChanged = () => { if (document.visibilityState === 'hidden') guard.markInteraction(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      for (const event of events) window.removeEventListener(event, guard.markInteraction, options);
      document.removeEventListener('visibilitychange', visibilityChanged);
      guard.unmount();
    };
  }, [guard]);
  return { guard, state };
}
