/**
 * Planner masthead + evidence — Korea Editorial Concierge phase 2 (2026-08-10).
 *
 * Replaces `MobilePlannerHero.tsx`, which was a mock travel dashboard: an
 * English-only greeting on a four-language product, a "Smart Picks" panel, and
 * a weather card that printed **22°C · Partly Cloudy** to every visitor in every
 * city on every day of the year. None of that was read from anything. Inventing
 * a reading and rendering it as a reading is the one thing this design system
 * says we do not do, so it is gone rather than restyled.
 *
 * What replaces it says only things the repo can back:
 *   - the four questions the traveller actually answers, which is the product;
 *   - the database the itinerary is written from, with the two counts recomputed
 *     from `api/_food_index.json` by `tests/unit/editorial-home-foundation.test.ts`;
 *   - the limits, in the same breath as the claims.
 */
import type { PlannerCopy } from '../plannerCopy';

/* ── Masthead ───────────────────────────────────────────────────────────── */

/**
 * Desktop: the claim on the left, the four inputs as a spec column on the right.
 * Mobile: the claim and the four input names only — the notes move down to
 * `PlannerEvidence`, below the wizard. That ordering is deliberate and measured:
 * in June the first question sat 1.6 screens down and the ad cohort left after a
 * median of ten seconds, so on a phone nothing outranks the first question.
 */
export function PlannerMasthead({ copy, isMobile }: { copy: PlannerCopy; isMobile: boolean }) {
  const m = copy.masthead;

  if (isMobile) {
    return (
      <header className="px-4 pb-2.5 pt-3">
        <p className="ec-eyebrow">{m.eyebrow}</p>
        <h1 className="ec-h2 mt-1.5">{m.headline}</h1>
        <p className="ec-body-sm mt-2 text-ec-ink-3">
          {m.inputs.map((i) => i.label).join(' · ')}
        </p>
      </header>
    );
  }

  // The spec column is a 2×2 grid rather than four stacked rows on purpose:
  // stacked, it was the tallest thing on the page and pushed the mode choice to
  // y=586 on a 1280×720 laptop — the first screen showed the claim and nothing
  // to do about it. Two columns halve that without dropping a single note.
  return (
    <header className="ec-container-wide pt-8 pb-6">
      <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-6">
          <p className="ec-eyebrow">{m.eyebrow}</p>
          <h1 className="ec-h2 mt-2.5">{m.headline}</h1>
          <p className="ec-body ec-measure mt-3">{m.lede}</p>
        </div>

        <div className="lg:col-span-6">
          <p className="ec-eyebrow">{m.inputsHeading}</p>
          <dl className="mt-2 grid gap-x-8 sm:grid-cols-2">
            {m.inputs.map((item) => (
              <div key={item.label} className="border-t border-ec-line py-2.5">
                <dt className="text-[14px] font-semibold text-ec-ink">{item.label}</dt>
                <dd className="ec-body-sm mt-0.5 text-ec-ink-3">{item.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </header>
  );
}

/* ── Evidence ───────────────────────────────────────────────────────────── */

/**
 * The ledger: what the itinerary is built from, and what we refuse to claim.
 * A ledger rather than three equal cards — the figures share one baseline and
 * are separated by rules, so the eye reads them as a column of measurements.
 */
export function PlannerEvidence({ copy, isMobile }: { copy: PlannerCopy; isMobile: boolean }) {
  const e = copy.evidence;

  return (
    <section className={`border-t border-ec-line bg-ec-sunken ${isMobile ? 'mt-6' : 'mt-12'}`}>
      <div className="ec-container-wide py-10 md:py-14">
        <p className="ec-eyebrow">{e.eyebrow}</p>
        <h2 className="ec-h3 mt-3 ec-measure">{e.heading}</h2>

        {/* A `dl` grouping `div` may hold one or more `dt` followed by one or
            more `dd`, and nothing else — the figure-first version put a `dd`
            before its `dt` and closed with a bare `p`, so the list carried no
            term/description pairing at all. Reading order is now term → figure
            → note; `order-first` on the figure keeps the measurement on top
            visually, which is the whole point of a ledger. */}
        <dl className="mt-8 grid sm:grid-cols-3">
          {e.items.map((item, i) => (
            <div
              key={item.label}
              className={`flex flex-col border-t border-ec-line py-5 sm:py-6 ${
                i > 0 ? 'sm:border-l sm:pl-6' : ''
              } ${i < e.items.length - 1 ? 'sm:pr-6' : ''}`}
            >
              <dt className="order-2 mt-2.5 text-[14px] font-semibold text-ec-ink">{item.label}</dt>
              <dd className="order-first ec-figure text-[clamp(26px,3.4vw,40px)] leading-none">{item.figure}</dd>
              <dd className="order-3 ec-body-sm mt-1.5 text-ec-ink-3">{item.note}</dd>
            </div>
          ))}
        </dl>

        <hr className="ec-rule-strong mt-2 mb-5" />
        <p className="ec-body-sm ec-measure text-ec-ink-3">{e.limits}</p>

        {/* Real Korean photography is the only decoration the system allows, and
            it carries a hairline rather than a scrim — no text sits on it. */}
        <img
          src="/hero-seoul-real.webp"
          alt=""
          width={1200}
          height={320}
          loading="lazy"
          decoding="async"
          className="mt-8 h-[150px] w-full rounded-ec-md border border-ec-line object-cover md:h-[220px]"
        />
      </div>
    </section>
  );
}
