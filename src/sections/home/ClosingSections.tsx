import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import { HOME_GUIDES, type HomeCopy } from './homeCopy';

/**
 * Reviews · guide · final CTA.
 *
 * The reviews block prints no score and no count. There is no verified review
 * feed wired up (see the note at the top of src/sections/GoogleReviews.tsx and
 * tests/unit/no-fake-social-proof.test.ts), so inventing one would be false
 * social proof. Saying that out loud reads as more trustworthy than a 4.9 with
 * nothing behind it, and it is the only version that stays true.
 */

const GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=cocotrip+korea+reviews';

interface Props {
  copy: HomeCopy;
}

export function ClosingSections({ copy }: Props) {
  const c = copy.closing;

  return (
    <>
      {/* ── Reviews + verifiable trust ── */}
      <section className="border-b border-ec-line">
        <div className="ec-container-wide py-12 md:py-16">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">
              <p className="ec-eyebrow">{c.reviewsEyebrow}</p>
              <h2 className="ec-h2 mt-4 max-w-[20ch]">{c.reviewsHeading}</h2>
              <p className="ec-body ec-measure mt-5">{c.reviewsBody}</p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ec-btn ec-btn-secondary mt-6"
              >
                {c.reviewsCta}
                <ArrowUpRight className="w-4 h-4" aria-hidden />
              </a>
            </div>

            <ul className="lg:col-span-5 lg:pt-9">
              {c.trust.map((item) => (
                <li key={item} className="flex items-center gap-3 border-b border-ec-line py-4 first:border-t first:border-ec-line">
                  <Check className="h-4 w-4 shrink-0 text-ec-success" aria-hidden />
                  <span className="text-[15px] font-medium text-ec-ink">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Guide ── */}
      <section className="border-b border-ec-line bg-ec-sunken">
        <div className="ec-container-wide py-12 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="ec-eyebrow">{c.guideEyebrow}</p>
              <h2 className="ec-h2 mt-4">{c.guideHeading}</h2>
            </div>
            <Link
              to="/guide"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold text-ec-brand transition-colors duration-ec-base ease-ec-standard hover:text-ec-brand-hover"
            >
              {c.guideCta}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <ol className="mt-8 grid md:grid-cols-3">
            {HOME_GUIDES.map((post, i) => (
              <li
                key={post.to}
                className={`border-t border-ec-line-2 md:border-t-2 ${i > 0 ? 'md:border-l md:border-l-ec-line md:pl-6' : ''} ${i < HOME_GUIDES.length - 1 ? 'md:pr-6' : ''}`}
              >
                <Link to={post.to} className="group flex min-h-[112px] flex-col py-5">
                  <span className="ec-eyebrow">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ec-h3 mt-3 text-[16px] leading-snug text-ec-ink">{post.title}</span>
                  <ArrowRight
                    className="mt-auto h-4 w-4 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="bg-ec-inverse text-ec-page">
        <div className="ec-container-wide py-14 md:py-20">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="lg:col-span-7">
              <h2 className="ec-h2 text-[color:var(--ec-text-on-inverse)]">{c.ctaHeading}</h2>
              <p className="ec-measure mt-4 text-[16px] leading-relaxed text-[color:var(--ec-text-on-inverse)] opacity-75">
                {c.ctaBody}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:col-span-5 lg:justify-end">
              <Link to="/planner" className="ec-btn ec-btn-primary">
                {c.ctaPrimary}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="ec-btn border-[color:var(--ec-text-on-inverse)] text-[color:var(--ec-text-on-inverse)] hover:bg-white/10"
              >
                {c.ctaSecondary}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
