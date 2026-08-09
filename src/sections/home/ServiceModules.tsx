import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { formatPrice } from '@/lib/exchange-rate';
import type { HomeCopy, HomeLang } from './homeCopy';

/**
 * The three ways to travel with us.
 *
 * Deliberately NOT three matching cards. The itinerary module is the wide
 * lead, charter is a narrower panel with a photograph, and tours is a list —
 * the shape of each module says what kind of thing it is before the copy does.
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

  return (
    <section className="border-b border-ec-line">
      <div className="ec-container-wide py-12 md:py-16">
        <p className="ec-eyebrow">{c.eyebrow}</p>
        <h2 className="ec-h2 mt-4 max-w-[22ch]">{c.heading}</h2>
        <hr className="ec-rule-strong mt-8" />

        <div className="grid lg:grid-cols-12">

          {/* 1 — the lead. Widest column, largest type, primary action. */}
          <article className="lg:col-span-7 lg:border-r lg:border-ec-line lg:pr-10 py-8 border-b border-ec-line lg:border-b-0">
            <p className="ec-eyebrow text-ec-brand">{c.plan.kicker}</p>
            <h3 className="ec-h2 mt-3 text-[clamp(22px,2.4vw,30px)]">{c.plan.title}</h3>
            <p className="ec-body ec-measure mt-4">{c.plan.body}</p>
            <Link to="/planner" className="ec-btn ec-btn-primary mt-6">
              {c.plan.cta}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </article>

          {/* 2 — charter. Narrower panel led by a photograph of the real vehicle. */}
          <article className="lg:col-span-5 lg:pl-10 py-8 border-b border-ec-line lg:border-b-0">
            <img
              src="/hero-banpo.webp"
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              width={640}
              height={360}
              className="mb-5 h-40 w-full rounded-ec-md border border-ec-line object-cover md:h-44"
            />
            <p className="ec-eyebrow text-ec-brand">{c.charter.kicker}</p>
            <h3 className="ec-h3 mt-3">{c.charter.title}</h3>
            <p className="ec-body-sm ec-measure mt-3">{c.charter.body}</p>
            <Link to="/charter" className="ec-btn ec-btn-secondary mt-5">
              {c.charter.cta}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </article>
        </div>

        <hr className="ec-rule-strong" />

        {/* 3 — tours. A list, because that is what it is: named routes with prices. */}
        <div className="grid gap-8 lg:grid-cols-12 pt-8">
          <div className="lg:col-span-4">
            <p className="ec-eyebrow text-ec-brand">{c.tours.kicker}</p>
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
                  <img
                    src={tour.thumbnail}
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
                      {tour.title[lang] || tour.title.en}
                    </span>
                    <span className="ec-eyebrow mt-1.5 block">{tour.region}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="ec-figure block text-[15px]">{priceLabel(tour)}</span>
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
    </section>
  );
}
