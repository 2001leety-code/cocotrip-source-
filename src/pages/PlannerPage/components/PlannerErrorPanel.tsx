/**
 * The free preview failed — this is where the traveller finds that out.
 *
 * 2026-08-10 follow-up. The retry panel used to be the last block on the page,
 * after the SEO/FAQ body. Measured on this branch, with the reader still parked
 * at the wizard where they pressed the button:
 *
 *   desktop 1280×720   panel top y=2752, scrollY 1180   — off screen
 *   mobile   390×844   panel top y=2682, scrollY 1884   — off screen
 *
 * So after three failed attempts the page simply went quiet. Moving the panel
 * up to the wizard is half the fix and not enough on its own: even directly
 * under the brief it sits below a five-step form. It therefore takes focus and
 * scrolls itself in — instantly for a reader who asked for reduced motion.
 *
 * It stays presentational: `EcError` supplies the announced live region and the
 * shared error frame, and retry is the caller's, which is what keeps the
 * wizard mounted and every answer intact.
 *
 * Locked by `tests/unit/planner-error-panel.component.test.tsx`.
 */
import { useEffect, useRef } from 'react';
import { EcError } from '@/components/ui/states';
import { focusAndReveal } from '../lib/motion';

interface PlannerErrorPanelProps {
  title: string;
  body?: string;
  retryLabel: string;
  onRetry: () => void;
}

export function PlannerErrorPanel({ title, body, retryLabel, onRetry }: PlannerErrorPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Mount is the event — the panel exists only while the request has failed.
  useEffect(() => { focusAndReveal(ref.current); }, []);

  return (
    <div ref={ref} tabIndex={-1} className="scroll-mt-4">
      <EcError title={title} body={body} retryLabel={retryLabel} onRetry={onRetry} />
    </div>
  );
}
