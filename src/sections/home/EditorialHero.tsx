import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { HOME_CITIES, type HomeCopy, type HomeLang } from './homeCopy';

/**
 * Hero — the thesis of the page.
 *
 * The claim is the headline; the proof of the claim is the destination rail
 * right under it, because picking a city is the first real step of the brief.
 * Each chip deep-links to `/planner?prefillRegions=<cityKey>`, which
 * PlannerPage reads (src/pages/PlannerPage/index.tsx) — the keys match
 * CITY_CHIPS in WizardForm/data.tsx, so the wizard opens with that city
 * already selected rather than dropping the user on a blank step.
 *
 * Photography is the committed KTO city stills in public/city-thumbs/. No
 * generated imagery, no gradient scrim over a full-bleed background.
 */

interface Props {
  copy: HomeCopy;
  lang: HomeLang;
  specimenId: string;
}

export function EditorialHero({ copy, lang, specimenId }: Props) {
  const c = copy.hero;

  return (
    <section className="border-b border-ec-line">
      <div className="ec-container-wide pt-10 pb-12 md:pt-20 md:pb-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">

          {/* Claim */}
          <div className="lg:col-span-7">
            <p className="ec-eyebrow">{c.eyebrow}</p>
            <hr className="ec-rule mt-4 mb-6" />
            <h1 className="ec-display max-w-[15ch] lg:max-w-[16ch]">{c.headline}</h1>
            <p className="ec-body ec-measure mt-6">{c.lede}</p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/planner" className="ec-btn ec-btn-primary">
                {c.ctaPrimary}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <a href={`#${specimenId}`} className="ec-btn ec-btn-secondary">
                {c.ctaSecondary}
              </a>
            </div>
          </div>

          {/* Destination rail. On desktop it is the right column; on mobile it
              follows the claim, still above the fold on a 390×844 screen. */}
          <div className="lg:col-span-5">
            <p className="ec-eyebrow">{c.pickCity}</p>
            <hr className="ec-rule mt-4 mb-4" />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              {HOME_CITIES.map((city) => (
                <li key={city.key}>
                  <Link
                    to={`/planner?prefillRegions=${city.key}`}
                    className="ec-card-link group relative block overflow-hidden rounded-ec-md border border-ec-line bg-ec-raised"
                  >
                    <img
                      src={city.photo}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      decoding="async"
                      width={320}
                      height={200}
                      className="h-24 w-full object-cover sm:h-28"
                    />
                    <span className="flex min-h-[44px] items-center justify-between gap-2 px-3 text-[14px] font-semibold text-ec-ink">
                      {city.label[lang]}
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="/planner"
                  className="ec-card-link flex h-full min-h-[44px] items-center justify-between gap-2 rounded-ec-md border border-dashed border-ec-line-2 bg-transparent px-3 py-4 text-[14px] font-semibold text-ec-ink-2"
                >
                  {c.otherCities}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-ec-ink-3">{c.photoCredit}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
