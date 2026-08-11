import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { EcEmpty } from '@/components/ui/states';
import { fill, readingMinutes, type GuideCopy, type GuideMeta } from './guideCopy';

/**
 * /guide — the index, as a magazine front rather than a card wall.
 *
 * The previous version drew 21 identical cards on a dark gradient, which reads
 * as a link dump: nothing on screen said which guide mattered, how current it
 * was, or how long it would take. The design system bans a row of identical
 * cards for exactly that reason, so the newest guide is a wide lead module with
 * its own photograph and the rest are hairline-separated rows.
 *
 * Every value on screen is read from `src/content/guides/_index.json`. A guide
 * with no picture, no topics or no word count renders without that element —
 * there is no placeholder frame and no invented "0 min read".
 */

interface Props {
  copy: GuideCopy;
  guides: GuideMeta[];
}

/** Photographs are hosted through `/blog-images/*`. If one 404s the frame is
 *  removed rather than left as a broken-image box — a magazine front with a
 *  torn picture reads worse than one without the picture. Until it arrives the
 *  frame is sunken paper, not white: an empty white rectangle inside a hairline
 *  reads as a hole in the page. */
function GuidePhoto({ src, className }: { src?: string; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={`bg-ec-sunken ${className}`}
    />
  );
}

/** Up to three real subjects, never a filler tag. The third is held back below
 *  640px: at 390 the text column is ~230px wide, so a third chip wraps to its
 *  own line and doubles the row height for no extra information. */
function Topics({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="mt-3 flex flex-wrap gap-1.5">
      {labels.slice(0, 3).map((label, i) => (
        <span
          key={label}
          data-guide-topic
          className={i === 2 ? 'ec-chip hidden sm:inline-flex' : 'ec-chip'}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/** `2026-07-26 · 6 min read` — both real, either one omitted when absent. */
function Meta({ copy, guide }: { copy: GuideCopy; guide: GuideMeta }) {
  const minutes = readingMinutes(guide.words);
  const parts = [
    guide.updated || null,
    minutes === null ? null : fill(copy.readTime, { n: String(minutes) }),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="ec-figure block text-[12px] font-semibold text-ec-ink-3">{parts.join(' · ')}</span>;
}

export function GuideIndexBody({ copy, guides }: Props) {
  const c = copy.index;
  const [lead, ...rest] = guides;
  // The masthead counts what is actually published and dates itself from the
  // most recently updated guide. Neither number is written down anywhere.
  const latestUpdated = guides
    .map((g) => g.updated)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <main className="ec-root">
      <section className="border-b border-ec-line">
        <div className="ec-container-wide py-10 md:py-14">
          <p className="ec-eyebrow">{c.title}</p>
          <h1 className="ec-h2 mt-4 max-w-[20ch]">{c.heading}</h1>
          <p className="ec-body ec-measure mt-5">{c.lede}</p>
          {latestUpdated && (
            <p className="ec-figure mt-6 text-[12px] font-semibold text-ec-ink-3">
              {fill(c.count, { n: String(guides.length), date: latestUpdated })}
            </p>
          )}
        </div>
      </section>

      {guides.length === 0 ? (
        <div className="ec-container-wide">
          <EcEmpty
            title={c.empty.title}
            body={c.empty.body}
            action={
              <Link to="/planner" className="ec-btn ec-btn-primary">
                {c.empty.cta}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
        </div>
      ) : (
        <div className="ec-container-wide pb-16">
          {/* The lead — widest column, largest type, its own photograph. */}
          <article data-guide-lead className="border-b border-ec-line py-8 md:py-12">
            <Link to={`/guide/${lead.slug}`} className="group grid gap-6 lg:grid-cols-12 lg:gap-10">
              <GuidePhoto
                src={lead.image}
                className="aspect-[16/10] w-full rounded-ec-md border border-ec-line object-cover lg:col-span-7"
              />
              <span className={lead.image ? 'lg:col-span-5' : 'lg:col-span-8'}>
                <span className="ec-eyebrow text-ec-brand">{c.leadKicker}</span>
                <h2 className="ec-h2 mt-3 text-[clamp(22px,2.6vw,32px)] text-ec-ink">{lead.title}</h2>
                {/* `line-clamp-*` already sets `display:-webkit-box`; adding
                    `block` next to it makes the two fight over `display`. */}
                <span className="ec-body ec-measure mt-4 line-clamp-3">{lead.description}</span>
                <Topics labels={lead.labels} />
                <span className="mt-4 block">
                  <Meta copy={copy} guide={lead} />
                </span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-semibold text-ec-brand">
                  {c.read}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </span>
            </Link>
          </article>

          {rest.length > 0 && (
            <>
              <p className="ec-eyebrow pt-8">{c.moreKicker}</p>
              <ul className="mt-2">
                {rest.map((guide) => (
                  <li key={guide.slug} data-guide-row>
                    <Link
                      to={`/guide/${guide.slug}`}
                      className="group flex items-start gap-4 border-t border-ec-line py-5 md:gap-6 md:py-6"
                    >
                      {/* Small at 390 on purpose — the thumbnail identifies the
                          guide, the title sells it, and the title needs the width. */}
                      <GuidePhoto
                        src={guide.image}
                        className="h-16 w-20 shrink-0 rounded-ec-sm border border-ec-line object-cover sm:h-24 sm:w-40"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold leading-snug text-ec-ink md:text-[18px]">
                          {guide.title}
                        </span>
                        <span className="ec-body-sm ec-measure mt-2 line-clamp-2">
                          {guide.description}
                        </span>
                        <Topics labels={guide.labels} />
                        <span className="mt-3 block">
                          <Meta copy={copy} guide={guide} />
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-1 hidden h-4 w-4 shrink-0 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5 sm:block"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </main>
  );
}
