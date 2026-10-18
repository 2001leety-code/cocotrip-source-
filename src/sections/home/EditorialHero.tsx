import { useId, useState, type FocusEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Pause, Plane, Play } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { HOME_CITIES, type HomeCopy, type HomeLang } from './homeCopy';
import { HOME_CITY_IMAGE_SIZES } from '@/lib/responsiveTourImage';
import { ResponsiveTourImage } from '@/components/ResponsiveTourImage';
import { EXAMPLE_PLANS } from '@/data/example-plans';
import { SkyLayer } from './SkyLayer';
import { ScrambleText } from './ScrambleText';
import { useCyclingPlan } from './useCyclingPlan';

/**
 * Hero — the thesis of the page, recomposed as a full-bleed moving sky.
 *
 * Left: one h1 drawn as four compressed lines that mix serif italic and sans
 * inside a line; the accessible name is `headline`, which is the exact join of
 * the visual segments. A plane trail draws under line 4 once.
 * Right: a translucent boarding pass that is a *sample* — it cycles through
 * EXAMPLE_PLANS (region, stop count, first → last stop, themes), never a
 * booking, date, seat or price. Its two actions never change with the cycle.
 * Phones get one primary CTA under the lede and the pass as a collapsed stub.
 * Below the grid the destination rail is still the only way into
 * `/planner?prefillRegions=<key>`.
 */

interface Props {
  copy: HomeCopy;
  lang: HomeLang;
  specimenId: string;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_m, key: string) => String(values[key]));

export function EditorialHero({ copy, lang, specimenId }: Props) {
  const c = copy.hero;
  const bodyId = useId();
  const reduce = useReducedMotion();
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useCyclingPlan(
    EXAMPLE_PLANS.length,
    userPaused || hovered || focused || reduce !== false,
  );

  const plan = EXAMPLE_PLANS[index];
  const firstStop = plan.stops[0];
  const lastStop = plan.stops[plan.stops.length - 1];
  const routeLabel = fill(c.pass.routeAria, { from: firstStop.name[lang], to: lastStop.name[lang] });

  // Hover/focus on the content (not on the controls) holds the current plan.
  const holdProps = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
  };
  const lastLine = c.headlineLines.length - 1;

  return (
    <section className="home-dope-hero" lang={lang}>
      <SkyLayer playLabel={c.sky.play} pauseLabel={c.sky.pause} />

      <div className="home-dope-hero__inner">
        {/* Claim */}
        <div className="home-dope-hero__copy">
          <p className="ec-eyebrow home-dope-eyebrow">{c.eyebrow}</p>
          <h1 className="home-dope-h1" aria-label={c.headline}>
            {c.headlineLines.map((line, li) => (
              <span
                key={li}
                aria-hidden="true"
                className={`home-dope-h1__line${li === lastLine ? ' home-dope-h1__line--trail' : ''}`}
              >
                {line.map((seg, si) => (
                  <span key={si} className={seg.serif ? (seg.roman ? 'is-serif is-roman' : 'is-serif') : 'is-sans'}>
                    {li === lastLine && seg.text.trim() ? (
                      // Edge spaces stay outside the scramble's inline-grid: its
                      // blockified cells strip them, gluing "planned" to "for".
                      <>
                        {seg.text.match(/^\s*/)?.[0]}
                        <ScrambleText text={seg.text.trim()} trigger="mount" announce={false} />
                        {seg.text.match(/\s*$/)?.[0]}
                      </>
                    ) : (
                      seg.text
                    )}
                  </span>
                ))}
                {li === lastLine && (
                  <span className="home-dope-trail">
                    <span className="home-dope-trail__track">
                      <Plane className="home-dope-trail__plane" aria-hidden />
                    </span>
                  </span>
                )}
              </span>
            ))}
          </h1>
          <p className="home-dope-lede">{c.lede}</p>
          {/* v3 play link: the sample day is one tap away at every width. */}
          <a href={`#${specimenId}`} className="home-dope-play">
            {c.ctaSecondary}
            <i aria-hidden="true"><Play className="h-4 w-4" /></i>
          </a>
          {/* Phones only: the primary planner entry. The pass keeps its own pair. */}
          <div className="home-dope-hero__cta">
            <Link to="/planner" className="home-dope-btn home-dope-btn--primary">
              {c.ctaPrimary}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Sample boarding pass. Route = real first/last stop of the current sample plan. */}
        <div className="home-dope-pass-wrap">
          <div className="home-dope-pass" data-collapsed={expanded ? 'false' : 'true'}>
            {/* Phone stub: badge, cycling route, expand toggle. Hidden from 768px. */}
            <div className="home-dope-pass__summary">
              <span className="home-dope-sample">{copy.specimen.sampleBadge}</span>
              <p key={index} className="home-dope-pass__summary-text home-dope-flip">
                {plan.regionLabel[lang]} · {firstStop.name[lang]} → {lastStop.name[lang]}
              </p>
              <button
                type="button"
                className="home-dope-pass__toggle"
                aria-expanded={expanded}
                aria-controls={bodyId}
                aria-label={expanded ? c.pass.close : c.pass.open}
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDown className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="home-dope-pass__body" id={bodyId}>
              <div className="home-dope-pass__head">
                <p className="home-dope-pass__title">
                  <Plane className="h-4 w-4 shrink-0" aria-hidden />
                  {c.pass.title}
                </p>
                <div className="home-dope-pass__controls">
                  <button
                    type="button"
                    className="home-dope-pass__pause"
                    aria-pressed={userPaused}
                    aria-label={userPaused ? c.pass.resume : c.pass.pause}
                    onClick={() => setUserPaused((v) => !v)}
                  >
                    {userPaused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                  </button>
                  <span className="home-dope-sample">{copy.specimen.sampleBadge}</span>
                </div>
              </div>

              <div className="home-dope-pass__cycle" aria-live="off" {...holdProps}>
                <div key={index} className="home-dope-flip">
                  <p className="home-dope-pass__meta">
                    {plan.regionLabel[lang]} · {plan.stops.length} {copy.specimen.stopsLabel}
                  </p>

                  <div className="home-dope-pass__route" role="group" aria-label={routeLabel}>
                    <div>
                      <p className="home-dope-pass__label">{c.pass.from}</p>
                      <p className="home-dope-pass__value">{firstStop.name[lang]}</p>
                    </div>
                    <ArrowRight className="home-dope-pass__arrow h-5 w-5" aria-hidden />
                    <div>
                      <p className="home-dope-pass__label">{c.pass.to}</p>
                      <p className="home-dope-pass__value">{lastStop.name[lang]}</p>
                    </div>
                  </div>

                  <ul className="home-dope-pass__chips">
                    {plan.themes[lang].map((theme) => (
                      <li key={theme}>{theme}</li>
                    ))}
                  </ul>

                  {/* First three timed stops of the same sample plan (v3 dotted rail). */}
                  <ol className="home-dope-pass__stops">
                    {plan.stops.slice(0, 3).map((stop) => (
                      <li key={`${stop.time}-${stop.name.en}`}>
                        <span className="ec-figure">{stop.time}</span> {stop.name[lang]}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <p className="home-dope-pass__start">{c.pass.startHeading}</p>

              <div className="home-dope-pass__dots">
                {EXAMPLE_PLANS.map((p, i) => (
                  <button
                    key={p.regionLabel.en}
                    type="button"
                    className="home-dope-pass__dot"
                    aria-label={fill(c.pass.planOf, { n: i + 1, m: EXAMPLE_PLANS.length })}
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => setIndex(i)}
                  />
                ))}
              </div>

              <div className="home-dope-pass__cta" {...holdProps}>
                <Link to="/planner" className="home-dope-btn home-dope-btn--primary">
                  {c.ctaPrimary}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href={`#${specimenId}`} className="home-dope-btn home-dope-btn--ghost">
                  {c.ctaSecondary}
                </a>
              </div>
            </div>

            <div className="home-dope-pass__stub" aria-hidden="true">
              <span key={index} className="home-dope-pass__barcode">
                {[30, 18, 34, 12, 26, 34, 16, 22, 34, 10, 28, 20, 34, 14].map((w, i) => (
                  <i key={i} style={{ width: w }} />
                ))}
              </span>
            </div>
          </div>

          {/* Phones: the sample-day anchor stays one tap away without expanding the pass. */}
          <a href={`#${specimenId}`} className="home-dope-pass__more">
            {c.ctaSecondary}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>

        {/* Destination rail. Full row under the grid; one scroll row on phones. */}
        <div className="home-dope-rail home-dope-hero__rail">
          <p className="ec-eyebrow home-dope-eyebrow">{c.pickCity}</p>
          <ul className="home-dope-rail__list">
            {HOME_CITIES.map((city) => (
              <li key={city.key}>
                <Link to={`/planner?prefillRegions=${city.key}`} className="home-dope-city">
                  <ResponsiveTourImage
                    source={city.photo} sizes={HOME_CITY_IMAGE_SIZES} fallbackWidth={256}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    width={32}
                    height={32}
                    className="home-dope-city__thumb"
                  />
                  {city.label[lang]}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/planner" className="home-dope-city home-dope-city--other">
                {c.otherCities}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
