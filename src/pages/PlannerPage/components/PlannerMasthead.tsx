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
 *
 * 2026-10-07 (compact workspace): the masthead is now the top of the page's
 * left rail — eyebrow, a two-beat headline and one short line. The five input
 * notes and the long-form lede used to sit above the brief as a wall of
 * equal-weight paragraphs; they moved, word for word, into `PlannerBriefNotes`,
 * a native disclosure below the wizard. Nothing was dropped, only the order.
 */
import type { PlannerCopy } from '../plannerCopy';

/* ── Masthead ───────────────────────────────────────────────────────────── */

/**
 * Splits the headline at its first sentence or clause break so the two beats
 * can carry different faces ("Korea." serif / "At your pace." sans). A headline
 * with no break renders as one serif line — the split is presentation only.
 */
function splitHeadline(headline: string): [string, string] {
  const match = headline.match(/^(.+?[.,。、，])\s*(.+)$/);
  return match ? [match[1], match[2]] : [headline, ''];
}

export function PlannerMasthead({ copy }: { copy: PlannerCopy }) {
  const m = copy.masthead;
  const [lead, rest] = splitHeadline(m.headline);

  return (
    <header className="planner-masthead">
      <p className="ec-eyebrow">{m.eyebrow}</p>
      <h1 className="planner-title">
        <span className="planner-title-serif">{lead}</span>
        {rest && <> <span className="planner-title-sans">{rest}</span></>}
      </h1>
      <p className="planner-lede">{m.lede}</p>
    </header>
  );
}

/* ── Brief notes ────────────────────────────────────────────────────────── */

/**
 * The five inputs and what each one changes, plus the long-form description of
 * what comes back. Collapsed by default and placed after the brief: on a phone
 * the first question has to be the first thing (2026-08-06: it was 1.6 screens
 * down and the June ad cohort left at a median of ten seconds). A `ul`, not a
 * `dl`, so the evidence ledger stays the page's only description list.
 */
export function PlannerBriefNotes({ copy }: { copy: PlannerCopy }) {
  const m = copy.masthead;

  return (
    <details className="planner-disclosure planner-brief-notes">
      <summary className="planner-disclosure-summary">
        <span className="planner-disclosure-heading">
          <span>{m.inputsHeading}</span>
          <span aria-hidden="true" className="planner-disclosure-mark">＋</span>
        </span>
      </summary>
      <div className="planner-disclosure-body">
        <p className="ec-body-sm ec-measure text-ec-ink-3">{m.detail}</p>
        <ul className="planner-brief-list">
          {m.inputs.map((item) => (
            <li key={item.label}>
              <span className="planner-brief-label">{item.label}</span>
              <span className="ec-body-sm text-ec-ink-3">{item.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
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
    <section className={`border-t border-ec-line bg-ec-sunken ${isMobile ? 'mt-5' : 'mt-9'}`}>
      <div className="ec-container-wide py-5 md:py-7">
        <p className="ec-eyebrow">{e.eyebrow}</p>
        <details className="planner-evidence-disclosure planner-disclosure mt-2 border-b border-ec-line">
          <summary className="planner-disclosure-summary">
            <h2 className="planner-disclosure-heading ec-h3">
              <span className="ec-measure">{e.heading}</span>
              <span aria-hidden="true" className="planner-disclosure-mark">＋</span>
            </h2>
          </summary>

          <div className="planner-disclosure-body">
            {/* A `dl` grouping `div` may hold one or more `dt` followed by one or
                more `dd`, and nothing else — the figure-first version put a `dd`
                before its `dt` and closed with a bare `p`, so the list carried no
                term/description pairing at all. Reading order is now term → figure
                → note; `order-first` on the figure keeps the measurement on top
                visually, which is the whole point of a ledger. */}
            <dl className="mt-3 grid sm:grid-cols-3">
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
              className="mt-7 h-[150px] w-full rounded-ec-md border border-ec-line object-cover md:h-[220px]"
            />
          </div>
        </details>
      </div>
    </section>
  );
}
