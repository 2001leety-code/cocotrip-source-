import { useEffect, useState } from 'react';

/**
 * Split-flap scramble for short labels. Purely visual: callers keep the real
 * text in an sr-only sibling, and prices / CTA labels are never passed here.
 */

const GLYPHS = '█▓▒░+-*/<>';
export const SCRAMBLE_FRAMES = 14;
const FRAME_MS = 45;

/**
 * One frame of the scramble. Characters left of the resolve front are final,
 * the rest are glyphs; whitespace is kept so line breaks do not move.
 * At `frame >= frames` the result is exactly `text`.
 */
export function scrambleFrame(
  text: string,
  frame: number,
  frames: number = SCRAMBLE_FRAMES,
  rand: () => number = Math.random,
): string {
  if (frame >= frames) return text;
  const chars = Array.from(text);
  const resolved = Math.floor((Math.max(0, frame) / frames) * chars.length);
  return chars
    .map((ch, i) => (i < resolved || /\s/.test(ch) ? ch : GLYPHS[Math.floor(rand() * GLYPHS.length)]))
    .join('');
}

/** Runs the scramble once each time `run` turns true; returns the text to paint. */
export function useScramble(text: string, run: boolean): string {
  const [frame, setFrame] = useState(SCRAMBLE_FRAMES);

  useEffect(() => {
    if (!run) return;
    let next = 0;
    const id = window.setInterval(() => {
      setFrame(next);
      next += 1;
      if (next > SCRAMBLE_FRAMES) window.clearInterval(id);
    }, FRAME_MS);
    return () => {
      window.clearInterval(id);
      setFrame(SCRAMBLE_FRAMES);
    };
  }, [run, text]);

  return run ? scrambleFrame(text, frame) : text;
}
