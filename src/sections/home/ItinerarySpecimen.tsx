import { useRef, useState, type KeyboardEvent } from 'react';
import { MapPin, Train, Bus, Footprints, Car, ArrowUpRight } from 'lucide-react';
import { EXAMPLE_PLANS, type ExamplePlan, type ExampleTransitMode } from '@/data/example-plans';
import { naverMapDirectionsUrl } from '@/lib/naverMap';
import type { HomeCopy, HomeLang } from './homeCopy';
import { SplitHeading } from './SplitHeading';

const fillPair = (template: string, from: string, to: string) =>
  template.replace('{from}', from).replace('{to}', to);

/**
 * The signature element: a real day, set as a timetable.
 *
 * This is the one place on the page allowed to be dense. Everything else is a
 * claim about the product; this is the product. It reuses the same static
 * EXAMPLE_PLANS data as the previous section (real venues, real coordinates,
 * conservative transit labels — see the header comment in
 * src/data/example-plans.ts), rendered as a printed schedule instead of a card:
 * times in a tabular column, stops in the second, transit legs as indented
 * rules between them.
 *
 * The "Sample" badge is mandatory (operator instruction) — nobody should read
 * this as a live booking.
 */

const TRANSIT_ICON: Record<ExampleTransitMode, typeof Train> = {
  subway: Train,
  bus: Bus,
  walk: Footprints,
  car: Car,
  'subway+bus': Train,
};

interface Props {
  copy: HomeCopy;
  lang: HomeLang;
  id: string;
}

function SpecimenSheet({ plan, lang, copy }: { plan: ExamplePlan; lang: HomeLang; copy: HomeCopy }) {
  const c = copy.specimen;
  return (
    // `min-w-0`: a grid item's automatic minimum size is its min-content, so
    // without this the sheet refuses to shrink below the widest unbreakable row
    // and pushes the document past the viewport at 390px.
    <article className="ec-card flex h-full min-w-0 flex-col p-0">
      <header className="flex items-start justify-between gap-3 border-b border-ec-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="ec-h3 text-[17px]">{plan.regionLabel[lang]}</h3>
          <p className="ec-body-sm mt-1 truncate text-ec-ink-3">{plan.themes[lang].join(' · ')}</p>
        </div>
        <span className="ec-chip shrink-0 text-[11px]">{c.sampleBadge}</span>
      </header>

      <p className="home-dope-leg-note">{c.transitNote}</p>
      <ol className="flex-1 px-5 py-4">
        {plan.stops.map((stop, i) => (
          <li key={`${plan.region}-${i}`}>
            {/* transit leg from the previous stop */}
            {stop.transit && i > 0 && (() => {
              const prev = plan.stops[i - 1];
              const Icon = TRANSIT_ICON[stop.transit.mode] || Car;
              const from = prev.name[lang];
              const to = stop.name[lang];
              // Exactly two endpoints, so Naver keeps the transit mode. Current
              // lines/times live on the map; the sample label is the only fact
              // shown here (it already carries mode and estimate).
              const href = naverMapDirectionsUrl(
                [{ lat: prev.lat, lng: prev.lng, name: from }, { lat: stop.lat, lng: stop.lng, name: to }],
                'transit',
              );
              return (
                // Everything wraps rather than truncating: measured at 390px,
                // `truncate` cut "Subway L2→L1 (transfer at Seomyeon) · ~50 min"
                // at 222px and the transfer station — the useful half — was the
                // part that disappeared. `min-w-0` keeps a flex item's automatic
                // min-width from pushing the document past the viewport.
                <div className="home-dope-leg" data-mode={stop.transit.mode}>
                  <Icon className="home-dope-leg__icon" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="home-dope-leg__route">
                      <span>{from}</span>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> – </span>
                      <span>{to}</span>
                    </p>
                    <p className="home-dope-leg__label">
                      {stop.transit.label[lang]}
                      {stop.transit.mode === 'car' && <> · {c.carNote}</>}
                    </p>
                  </div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="home-dope-leg__link"
                      aria-label={fillPair(c.transitLinkAria, from, to)}
                    >
                      {c.transitLink}
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                  )}
                </div>
              );
            })()}

            <div className={`flex items-baseline gap-4 py-2 ${i > 0 ? 'border-t border-ec-line' : ''}`}>
              <span className="ec-figure w-[48px] shrink-0 text-[13px] font-semibold text-ec-ink-2">
                {stop.time}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  <span className="text-[14px] font-semibold leading-snug text-ec-ink">
                    {stop.name[lang]}
                  </span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-px shrink-0 text-ec-brand transition-colors duration-ec-base ease-ec-standard hover:text-ec-brand-hover"
                    aria-label={`${stop.name[lang]} — ${c.mapLink}`}
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </span>
                {stop.tip[lang] && (
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ec-ink-2">
                    {stop.tip[lang]}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <footer className="border-t border-ec-line px-5 py-3">
        <p className="ec-eyebrow">
          {c.dayLabel} · {plan.stops.length} {c.stopsLabel}
        </p>
      </footer>
    </article>
  );
}

/**
 * Home A (2026-10-07): one sheet at a time instead of three side by side.
 * The first plan is visible on first paint; the region tabs (ARIA tabs,
 * arrow keys / Home / End) switch between all EXAMPLE_PLANS.
 */
export function ItinerarySpecimen({ copy, lang, id }: Props) {
  const c = copy.specimen;
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const plan = EXAMPLE_PLANS[active] || EXAMPLE_PLANS[0];

  const select = (i: number) => {
    const n = EXAMPLE_PLANS.length;
    const next = (i + n) % n;
    setActive(next);
    const tab = tabs.current[next];
    if (tab) tab.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1, ArrowUp: active - 1,
      Home: 0, End: EXAMPLE_PLANS.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key]);
  };

  return (
    <section id={id} className="scroll-mt-20 border-b border-ec-line bg-ec-sunken">
      <div className="ec-container-wide py-12 md:py-16">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <p className="ec-eyebrow">{c.eyebrow}</p>
            <SplitHeading text={c.heading} className="ec-h2 mt-4" />
          </div>
          <p className="ec-body ec-measure lg:col-span-7 lg:pt-9">{c.lede}</p>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-12 lg:gap-12">
          <div role="tablist" aria-label={c.tabsLabel} className="home-dope-tabs lg:col-span-4" onKeyDown={onKeyDown}>
            {EXAMPLE_PLANS.map((p, i) => (
              <button
                key={p.region}
                ref={(el) => { tabs.current[i] = el; }}
                type="button"
                role="tab"
                id={`${id}-tab-${p.region}`}
                aria-selected={i === active}
                aria-controls={`${id}-panel`}
                tabIndex={i === active ? 0 : -1}
                className="home-dope-tab"
                onClick={() => setActive(i)}
              >
                {p.regionLabel[lang]}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${id}-panel`}
            aria-labelledby={`${id}-tab-${plan.region}`}
            className="min-w-0 lg:col-span-8"
          >
            <SpecimenSheet key={plan.region} plan={plan} lang={lang} copy={copy} />
          </div>
        </div>
      </div>
    </section>
  );
}
