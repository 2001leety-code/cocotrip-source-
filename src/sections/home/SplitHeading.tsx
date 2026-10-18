import { useEffect, useRef } from 'react';
import { animate, stagger, useReducedMotion } from 'framer-motion';

/**
 * Word-split heading reveal for the sample section (home A, 2026-10-07).
 *
 * Behaviour adapted from ReactBits SplitText (MIT + Commons Clause, David Haz;
 * notice in public/home-dope/ASSET-SOURCES.md): split, stagger in from
 * opacity 0 / y, play once on view. Words only — never characters, so Korean,
 * Japanese and Chinese line breaking is untouched (CJK without spaces is one
 * unit). Runs on framer-motion's `animate` (already installed) instead of
 * GSAP SplitText.
 *
 * The heading is readable before and after: words render final, the reveal
 * starts only when the heading scrolls in, cleanup restores the final style,
 * and reduced motion never animates. The accessible name is the plain text.
 */

interface Props {
  text: string;
  id?: string;
  className?: string;
}

export function SplitHeading({ text, id, className }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (reduce !== false || !el || typeof IntersectionObserver === 'undefined') return;
    const words = Array.from(el.querySelectorAll<HTMLElement>('.home-dope-split__word'));
    let controls: { stop: () => void } | null = null;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      io.disconnect();
      controls = animate(
        words,
        { opacity: [0, 1], y: [24, 0] },
        { duration: 0.6, delay: stagger(0.06), ease: [0.22, 1, 0.36, 1] },
      );
    }, { threshold: 0.2 });
    io.observe(el);
    return () => {
      io.disconnect();
      if (controls) controls.stop();
      for (const word of words) {
        word.style.opacity = '';
        word.style.transform = '';
      }
    };
  }, [reduce, text]);

  const parts = text.split(/(\s+)/);
  return (
    <h2 ref={ref} id={id} className={className} aria-label={text}>
      {parts.map((part, i) => (/^\s+$/.test(part) || part === ''
        ? part
        : <span key={`${i}-${part}`} className="home-dope-split__word" aria-hidden="true">{part}</span>))}
    </h2>
  );
}
