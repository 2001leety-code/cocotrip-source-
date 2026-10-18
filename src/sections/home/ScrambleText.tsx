import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useScramble } from './useScramble';

interface Props {
  text: string;
  /** `view`: once, when 40% visible. `mount`: once, on first paint. */
  trigger?: 'view' | 'mount';
  /** false inside an element that already carries the accessible name (h1 aria-label). */
  announce?: boolean;
}

/**
 * The visible text scrambles; the accessible name never does. A hidden ghost
 * copy of the final text holds the box so the scramble cannot shift layout.
 */
export function ScrambleText({ text, trigger = 'view', announce = true }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (trigger !== 'view' || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [trigger]);

  const run = reduce === false && (trigger === 'mount' || inView);
  const display = useScramble(text, run);

  return (
    <span ref={ref} className="home-dope-scramble">
      <span className="home-dope-scramble__ghost" aria-hidden="true">{text}</span>
      <span className="home-dope-scramble__live" aria-hidden="true">{display}</span>
      {announce && <span className="sr-only">{text}</span>}
    </span>
  );
}
