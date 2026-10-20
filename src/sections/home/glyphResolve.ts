/**
 * Glyph resolve for the service-row titles (home A, 2026-10-07).
 *
 * Unlike the hero's split-flap (`useScramble`, block glyphs), this one uses
 * letters, digits and punctuation only, and resolves into the real title via
 * GSAP's ScrambleTextPlugin. It is a short, bounded effect — never a loop.
 * GSAP is imported on the first play (row entry / hover / focus), so it is
 * not part of the home chunk and never loads for reduced motion.
 */

const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&*+/<>=:';
export const GLYPH_RESOLVE_MS = 600;

function loadScramble() {
  return Promise.all([import('gsap'), import('gsap/ScrambleTextPlugin')]).then(([g, s]) => {
    g.gsap.registerPlugin(s.ScrambleTextPlugin);
    return g.gsap;
  });
}

/**
 * Plays the resolve on `node` and returns a cancel function. Cancel, the
 * natural end, or a failed GSAP import always leave `node.textContent === text`.
 * A cancel before GSAP arrives (e.g. unmount) means no tween is ever started.
 */
export function playGlyphResolve(node: HTMLElement, text: string): () => void {
  let cancelled = false;
  let tween: { kill: () => void } | null = null;
  const restore = () => {
    node.textContent = text;
  };
  loadScramble().then(
    (gsap) => {
      if (cancelled || !node.isConnected) return;
      tween = gsap.to(node, {
        duration: GLYPH_RESOLVE_MS / 1000,
        ease: 'none',
        scrambleText: { text, chars: GLYPHS, speed: 0.6 },
        onComplete: () => {
          tween = null;
          restore();
        },
      });
    },
    () => {
      if (!cancelled) restore();
    },
  );
  return () => {
    cancelled = true;
    if (tween) tween.kill();
    tween = null;
    restore();
  };
}
