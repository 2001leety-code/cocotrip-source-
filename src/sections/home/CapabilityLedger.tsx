import type { HomeCopy } from './homeCopy';

/**
 * Capability ledger — the positioning section.
 *
 * Three figures, each one traceable to something in this repo (see the claim
 * table in docs/DESIGN-EDITORIAL-CONCIERGE.md). The limits line is deliberate:
 * saying what we do not know is the cheapest, most durable trust signal we
 * have, and it keeps a future contributor from quietly upgrading a figure into
 * a promise the code cannot keep.
 *
 * Layout is a ledger, not three equal cards — figures share one baseline grid
 * and are separated by rules.
 */

interface Props {
  copy: HomeCopy;
}

export function CapabilityLedger({ copy }: Props) {
  const c = copy.ledger;

  return (
    <section className="border-b border-ec-line bg-ec-sunken">
      <div className="ec-container-wide py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <p className="ec-eyebrow">{c.eyebrow}</p>
            <h2 className="ec-h2 mt-4">{c.heading}</h2>
          </div>
          <p className="ec-body ec-measure lg:col-span-7 lg:pt-9">{c.lede}</p>
        </div>

        <hr className="ec-rule-strong mt-10 mb-0" />

        <dl className="grid sm:grid-cols-3">
          {c.items.map((item, i) => (
            <div
              key={item.label}
              className={`py-6 sm:py-8 border-b border-ec-line sm:border-b-0 ${
                i > 0 ? 'sm:border-l sm:border-ec-line sm:pl-6 lg:pl-8' : ''
              } ${i < c.items.length - 1 ? 'sm:pr-6 lg:pr-8' : ''}`}
            >
              <dd className="ec-figure text-[clamp(32px,4.4vw,52px)] leading-none">{item.figure}</dd>
              <dt className="mt-3 text-[15px] font-semibold text-ec-ink">{item.label}</dt>
              <p className="ec-body-sm mt-2">{item.note}</p>
            </div>
          ))}
        </dl>

        <hr className="ec-rule-strong mt-2 mb-6" />

        <p className="text-[14px] font-semibold text-ec-ink">{c.trustLine}</p>
        <p className="ec-body-sm ec-measure mt-3 text-ec-ink-3">{c.limits}</p>
      </div>
    </section>
  );
}
