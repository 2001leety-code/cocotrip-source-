import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import type { HomeCopy } from './homeCopy';
import { playGlyphResolve } from './glyphResolve';

/**
 * Three full-width service rows (home A, 2026-10-07) — replaces the 300vh
 * pinned horizontal story. Each row is one link: mono tracked title, the
 * service's existing one-line title as description, arrow right.
 *
 * Motion: the title resolves from letter/digit/punctuation glyphs into the
 * real word (GSAP ScrambleText, loaded on first play) once when the row enters
 * the viewport, and again on mouse hover or keyboard focus. The accessible name never animates (sr-only copy), the
 * resolve always ends on the real text, and reduced motion never runs it.
 */

interface Props {
  copy: HomeCopy;
}

function RowTitle({ text, play }: { text: string; play: number }) {
  const live = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = live.current;
    if (!node || play === 0) return;
    return playGlyphResolve(node, text);
  }, [play, text]);

  return (
    <span className="home-dope-row__title">
      <span className="home-dope-row__ghost" aria-hidden="true">{text}</span>
      {/* Keyed by text: a language switch remounts the node the effect writes to. */}
      <span key={text} ref={live} className="home-dope-row__live" aria-hidden="true">{text}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

function ServiceRow({ to, title, description }: { to: string; title: string; description: string }) {
  const motionOk = useReducedMotion() === false;
  const ref = useRef<HTMLAnchorElement>(null);
  const [play, setPlay] = useState(0);
  const replay = () => {
    if (motionOk) setPlay((n) => n + 1);
  };

  // Entrance: once per mount, when the row is on screen (phones included).
  useEffect(() => {
    const el = ref.current;
    if (!motionOk || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        io.disconnect();
        setPlay((n) => n + 1);
      }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [motionOk]);

  return (
    <li>
      <Link
        ref={ref}
        to={to}
        className="home-dope-row"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') replay(); }}
        onFocus={replay}
      >
        <RowTitle text={title} play={motionOk ? play : 0} />
        <span className="home-dope-row__desc">{description}</span>
        <ArrowRight className="home-dope-row__arrow" aria-hidden />
      </Link>
    </li>
  );
}

export function ServiceRows({ copy }: Props) {
  const r = copy.rows;
  const m = copy.modules;
  const rows = [
    { to: '/planner', title: r.planner, description: m.plan.title },
    { to: '/tours', title: r.tours, description: m.tours.title },
    { to: '/charter', title: r.charter, description: m.charter.title },
  ];
  return (
    <section className="home-dope-services home-dope-rows" aria-labelledby="home-services">
      <div className="ec-container-wide py-12 md:py-16">
        <p className="ec-eyebrow">{m.eyebrow}</p>
        <h2 id="home-services" className="ec-h2 mt-4 max-w-[24ch]">{m.heading}</h2>
        <ul className="home-dope-rows__list mt-8">
          {rows.map((row) => <ServiceRow key={row.to} {...row} />)}
        </ul>
      </div>
    </section>
  );
}
