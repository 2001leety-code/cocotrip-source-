import { useEffect, useRef } from 'react';
import { notify } from '@/lib/notify';
import { haptic } from '@/lib/haptic';

/**
 * Notify-on-ready: fire an OS notification + haptic when the quick preview finishes.
 * Tracks the previous status so it fires once per loadingQuick -> quickSuccess transition
 * (not on every re-render where status === 'quickSuccess').
 *
 * 2026-08-10: the fallbacks used to be Korean string literals, so an English, Japanese or
 * Chinese reader whose locale file was missing the key got a Korean notification. They now
 * come from the four-language planner copy (`ready`).
 * 2026-10-26: moved out of PlannerPage/index.tsx unchanged (file-size lock).
 */
export function useNotifyPlanReady(status: string, p: unknown, ready: { notifyTitle: string; notifyBody: string }) {
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'loadingQuick' && status === 'quickSuccess') {
      haptic('success');
      const notifP = (p as { notifyPlanReadyTitle?: string; notifyPlanReadyBody?: string });
      notify({
        title: notifP.notifyPlanReadyTitle || ready.notifyTitle,
        body: notifP.notifyPlanReadyBody || ready.notifyBody,
        onlyIfHidden: true, // skip OS notif when user is already looking
        onClick: () => {
          const el = document.getElementById('planner-quick-result');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      });
    }
    prevStatus.current = status;
  }, [status, p, ready]);
}
