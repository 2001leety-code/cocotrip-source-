import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plane } from 'lucide-react';
import {
  motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform,
} from 'framer-motion';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { formatPrice } from '@/lib/exchange-rate';
import { HOME_FEATURE_IMAGE_SIZES, HOME_TOUR_IMAGE_SIZES } from '@/lib/responsiveTourImage';
import { ResponsiveTourImage } from '@/components/ResponsiveTourImage';
import type { HomeCopy, HomeLang } from './homeCopy';
import { ScrambleText } from './ScrambleText';

/**
 * The three ways to travel with us.
 *
 * Deliberately NOT three matching cards. The itinerary module is the wide
 * lead, charter is a narrower panel with a photograph, and tours is a list —
 * the shape of each module says what kind of thing it is before the copy does.
 *
 * Desktop (≥1024, motion allowed): the three modules sit on one horizontal rail
 * inside a sticky frame, and vertical scroll through a tall track moves the rail
 * (framer-motion useScroll). Focusing a link scrolls the page so that its panel
 * is fully on screen. Phones, tablets and reduced motion get the same DOM in
 * normal flow (`.home-dope-story--flow`): no sticky, no transform.
 *
 * Prices go through the same `getTourPriceKRW` + `formatPrice` pair the rest of
 * the app uses (pricing_spec.json is the SSOT). No arithmetic is introduced
 * here — a home page must never become a second source of truth for money.
 */

interface Props {
  copy: HomeCopy;
  lang: HomeLang;
}

/** Three real, currently-listed tours. Slugs resolve to /tours/:slug. */
const FEATURED_TOUR_IDS = ['tour-seoul-city', 'tour-busan-day', 'tour-dmz'];
const PANEL_COUNT = 3;
const STORY_QUERY = '(min-width: 1024px)';

function useStoryWidth() {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(STORY_QUERY);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(STORY_QUERY).matches,
    () => false,
  );
}

export function ServiceModules({ copy, lang }: Props) {
  const c = copy.modules;
  const featured = FEATURED_TOUR_IDS
    .map((id) => TOURS.find((tour) => tour.id === id))
    .filter((tour): tour is (typeof TOURS)[number] => Boolean(tour));

  const priceLabel = (tour: (typeof TOURS)[number]) => {
    const krw = getTourPriceKRW(tour.id, tour.priceFrom, tour.priceUnit);
    if (lang === 'ko') return `₩${krw.toLocaleString()}~`;
    return formatPrice(krw, lang, { approximate: true });
  };

  const reduce = useReducedMotion();
  const wide = useStoryWidth();
  const story = wide && reduce === false;

  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const distance = useMotionValue(0);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const x = useTransform(() => -scrollYProgress.get() * distance.get());
  const planeLeft = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setActive(Math.min(PANEL_COUNT - 1, Math.floor(p * PANEL_COUNT)));
  });

  // Travel distance = rail width beyond the frame. ResizeObserver also fires once on observe.
  useEffect(() => {
    const rail = railRef.current;
    const frame = viewportRef.current;
    if (!story || !rail || !frame || typeof ResizeObserver === 'undefined') return;
    const measure = () => distance.set(Math.max(0, rail.offsetWidth - frame.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    ro.observe(frame);
    return () => {
      ro.disconnect();
      distance.set(0);
    };
  }, [story, distance]);

  /** Keyboard: scroll the track to the progress at which panel `i` is fully in the frame. */
  const showPanel = (i: number) => {
    const track = trackRef.current;
    const rail = railRef.current;
    const d = distance.get();
    if (!story || !track || !rail || d <= 0) return;
    const panel = rail.children[i] as HTMLElement | undefined;
    if (!panel) return;
    const gutter = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
    const progress = Math.min(1, Math.max(0, (panel.offsetLeft - gutter) / d));
    const top = track.getBoundingClientRect().top + window.scrollY;
    const range = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + progress * range, behavior: 'auto' });
  };

  return (
    <section className="border-b border-ec-line home-dope-services">
      <div ref={trackRef} className={`home-dope-story home-dope-story--${story ? 'pinned' : 'flow'}`}>
        <div className="home-dope-story__sticky">
          <div className="ec-container-wide pt-12 md:pt-16 home-dope-story__head">
            <p className="ec-eyebrow"><ScrambleText text={c.eyebrow} /></p>
            <h2 className="ec-h2 mt-4 max-w-[22ch]">{c.heading}</h2>
            {story && (
              <div className="home-dope-story__progress" aria-hidden="true">
                <span className="home-dope-story__index">{`0${active + 1} / 0${PANEL_COUNT}`}</span>
                <span className="home-dope-story__bar">
                  <motion.span className="home-dope-story__fill" style={{ scaleX: scrollYProgress }} />
                  <motion.span className="home-dope-story__plane" style={{ left: planeLeft }}>
                    <Plane className="h-4 w-4" aria-hidden />
                  </motion.span>
                </span>
              </div>
            )}
            <hr className="ec-rule-strong mt-8" />
          </div>

          <div ref={viewportRef} className="ec-container-wide pb-12 md:pb-16 home-dope-story__viewport">
            <motion.div ref={railRef} className="home-dope-story__rail" style={story ? { x } : undefined}>

              {/* 1 — the lead. Widest column, largest type, primary action. */}
              <article
                className="home-dope-story__panel home-dope-story__panel--plan lg:border-r lg:border-ec-line lg:pr-10 py-8 border-b border-ec-line lg:border-b-0"
                onFocus={() => showPanel(0)}
              >
                <p className="ec-eyebrow text-ec-brand"><ScrambleText text={c.plan.kicker} /></p>
                <h3 className="ec-h2 mt-3 text-[clamp(22px,2.4vw,30px)]">{c.plan.title}</h3>
                <p className="ec-body ec-measure mt-4">{c.plan.body}</p>
                <Link to="/planner" className="ec-btn ec-btn-primary mt-6">
                  {c.plan.cta}
                  <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
              </article>

              {/* 2 — charter. Narrower panel led by a photograph of the real vehicle. */}
              <article
                className="home-dope-story__panel home-dope-story__panel--charter lg:pl-10 py-8 border-b border-ec-line lg:border-b-0"
                onFocus={() => showPanel(1)}
              >
                <ResponsiveTourImage
                  source="/hero-banpo.webp" sizes={HOME_FEATURE_IMAGE_SIZES} wideFrom={1024}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  width={640}
                  height={360}
                  className="mb-5 h-40 w-full rounded-ec-md border border-ec-line object-cover md:h-44"
                />
                <p className="ec-eyebrow text-ec-brand"><ScrambleText text={c.charter.kicker} /></p>
                <h3 className="ec-h3 mt-3">{c.charter.title}</h3>
                <p className="ec-body-sm ec-measure mt-3">{c.charter.body}</p>
                <Link to="/charter" className="ec-btn ec-btn-secondary mt-5">
                  {c.charter.cta}
                  <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
              </article>

              {/* 3 — tours. A list, because that is what it is: named routes with prices. */}
              <div className="home-dope-story__panel home-dope-story__panel--tours" onFocus={() => showPanel(2)}>
                <hr className="ec-rule-strong home-dope-story__rule" />
                <div className="grid gap-8 lg:grid-cols-12 pt-8">
                  <div className="lg:col-span-4">
                    <p className="ec-eyebrow text-ec-brand"><ScrambleText text={c.tours.kicker} /></p>
                    <h3 className="ec-h3 mt-3">{c.tours.title}</h3>
                    <p className="ec-body-sm ec-measure mt-3">{c.tours.body}</p>
                    <Link to="/tours" className="ec-btn ec-btn-secondary mt-5">
                      {c.tours.cta}
                      <ArrowRight className="w-4 h-4" aria-hidden />
                    </Link>
                  </div>

                  <ul className="lg:col-span-8">
                    {featured.map((tour) => (
                      <li key={tour.id}>
                        <Link
                          to={`/tours/${tour.slug}`}
                          className="group flex items-center gap-4 border-t border-ec-line py-4 first:border-t-0 lg:first:border-t"
                        >
                          <ResponsiveTourImage
                            source={tour.thumbnail} sizes={HOME_TOUR_IMAGE_SIZES} fallbackWidth={128}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            decoding="async"
                            width={128}
                            height={96}
                            className="h-16 w-24 shrink-0 rounded-ec-sm border border-ec-line object-cover sm:h-20 sm:w-32"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold leading-snug text-ec-ink">
                              <ScrambleText text={tour.title[lang] || tour.title.en} />
                            </span>
                            <span className="ec-eyebrow mt-1.5 block">{tour.region}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="ec-figure block text-[15px] home-dope-price">{priceLabel(tour)}</span>
                            <ArrowRight
                              className="ml-auto mt-1.5 h-4 w-4 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                              aria-hidden
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
