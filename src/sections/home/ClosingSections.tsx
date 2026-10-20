import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import { HOME_GUIDES, type HomeCopy } from './homeCopy';

/**
 * Reviews · guide. The final CTA band was removed at the user's request
 * (2026-10-07); hero and service rows already carry planner/contact entrances.
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

  // Home A (2026-10-07): trust, reviews and guide share one compact section.
  return (
      <section className="border-b border-ec-line home-dope-closing">
        <div className="ec-container-wide py-12 md:py-16">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <p className="ec-eyebrow">{c.reviewsEyebrow}</p>
              <h2 className="ec-h3 mt-3">{c.reviewsHeading}</h2>
              <p className="ec-body-sm ec-measure mt-3">{c.reviewsBody}</p>
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                {c.trust.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[14px] font-medium text-ec-ink">
                    <Check className="h-4 w-4 shrink-0 text-ec-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="home-dope-textlink mt-3"
              >
                {c.reviewsCta}
                <ArrowUpRight className="w-4 h-4" aria-hidden />
              </a>
            </div>

            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="ec-eyebrow">{c.guideEyebrow}</p>
                  <h2 className="ec-h3 mt-3">{c.guideHeading}</h2>
                </div>
                <Link to="/guide" className="home-dope-textlink">
                  {c.guideCta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              <ol className="mt-4">
                {HOME_GUIDES.map((post, i) => (
                  <li key={post.to}>
                    <Link to={post.to} className="group flex min-h-[44px] items-center gap-4 border-t border-ec-line py-3">
                      <span className="ec-eyebrow shrink-0">{String(i + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ec-ink">{post.title}</span>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>
  );
}
