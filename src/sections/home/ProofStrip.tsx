import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { formatPrice } from '@/lib/exchange-rate';
import { ResponsiveTourImage } from '@/components/ResponsiveTourImage';
import type { HomeCopy, HomeLang } from './homeCopy';

/**
 * Real tour strip + conditions (home A, 2026-10-07).
 *
 * Three currently-listed tours with the price the rest of the app shows:
 * `getTourPriceKRW` + `formatPrice`, Korean keeps the `₩…~` from-price form.
 * No arithmetic here — pricing_spec.json is the SSOT.
 *
 * The essential conditions stay visible under the strip (operator/payment,
 * charter per-vehicle pricing, what we do not claim about diet/hours). The
 * longer supporting facts move into one named <details>, wording unchanged.
 */

interface Props {
  copy: HomeCopy;
  lang: HomeLang;
}

/** Same three tours the old services story listed. Slugs resolve to /tours/:slug. */
const FEATURED_TOUR_IDS = ['tour-seoul-city', 'tour-busan-day', 'tour-dmz'];
/** Strip card width: three columns from 1024px, about 1.2 cards per phone screen. */
const STRIP_IMAGE_SIZES = '(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 80vw';

export function ProofStrip({ copy, lang }: Props) {
  const m = copy.modules;
  const l = copy.ledger;
  const featured = FEATURED_TOUR_IDS
    .map((id) => TOURS.find((tour) => tour.id === id))
    .filter((tour): tour is (typeof TOURS)[number] => Boolean(tour));

  const priceLabel = (tour: (typeof TOURS)[number]) => {
    const krw = getTourPriceKRW(tour.id, tour.priceFrom, tour.priceUnit);
    if (lang === 'ko') return `₩${krw.toLocaleString()}~`;
    return formatPrice(krw, lang, { approximate: true });
  };

  return (
    <section className="home-dope-proof border-b border-ec-line" aria-labelledby="home-tours">
      <div className="ec-container-wide pb-12 md:pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ec-eyebrow">{m.tours.kicker}</p>
            <h2 id="home-tours" className="ec-h3 mt-3">{m.tours.title}</h2>
          </div>
          <Link to="/tours" className="home-dope-textlink">
            {m.tours.cta}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <ul className="home-dope-proof__list mt-6">
          {featured.map((tour) => (
            <li key={tour.id}>
              <Link to={`/tours/${tour.slug}`} className="home-dope-proof__card">
                <ResponsiveTourImage
                  source={tour.thumbnail} sizes={STRIP_IMAGE_SIZES} fallbackWidth={384}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  width={384}
                  height={240}
                  className="home-dope-proof__img"
                />
                <span className="home-dope-proof__meta">
                  <span className="block text-[15px] font-semibold leading-snug text-ec-ink">
                    {tour.title[lang] || tour.title.en}
                  </span>
                  <span className="ec-eyebrow mt-1.5 block">{tour.region}</span>
                  <span className="ec-figure mt-2 block text-[15px] home-dope-price">{priceLabel(tour)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Visible on purpose: cost and condition lines are never folded away. */}
        <div className="home-dope-conditions mt-8">
          <p className="text-[14px] font-semibold text-ec-ink">{l.trustLine}</p>
          <p className="ec-body-sm ec-measure mt-2">{m.charter.body}</p>
          <p className="ec-body-sm ec-measure mt-2 text-ec-ink-3">{l.limits}</p>
        </div>

        <details className="home-dope-details mt-6">
          <summary className="home-dope-details__summary">{l.eyebrow}</summary>
          <div className="home-dope-details__body">
            <p className="text-[15px] font-semibold text-ec-ink">{l.heading}</p>
            <p className="ec-body-sm ec-measure mt-2">{l.lede}</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              {l.items.map((item) => (
                <div key={item.label} className="flex flex-col">
                  <dt className="order-2 mt-1 text-[14px] font-semibold text-ec-ink">{item.label}</dt>
                  <dd className="order-1 ec-figure text-[24px] leading-none">{item.figure}</dd>
                  <dd className="order-3 ec-body-sm mt-1">{item.note}</dd>
                </div>
              ))}
            </dl>
            <p className="ec-body-sm ec-measure mt-4">{m.plan.body}</p>
            <p className="ec-body-sm ec-measure mt-2">{m.tours.body}</p>
          </div>
        </details>
      </div>
    </section>
  );
}
