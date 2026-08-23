import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EcEmpty, EcError, EcLoading } from '@/components/ui/states';
import { sanitizeGuideHtml } from '@/lib/sanitizeGuideHtml';
import { fill, readingMinutes, type GuideCopy, type GuideDoc } from './guideCopy';

/**
 * /guide/:slug — one article, on paper.
 *
 * Four states, all of which the previous version got wrong: while the article
 * chunk was in flight it rendered *nothing at all* (no skeleton, no live
 * region), and a failed chunk fetch fell through to the same "guide not found"
 * screen as a genuine 404 — so a dropped connection told the reader the article
 * did not exist and offered no way to retry. They are different problems with
 * different actions, so they are different states here.
 *
 * The byline carries the two things we can actually back: where the text came
 * from (our own English guide archive — the only origin in the code) and what
 * language it is written in. Fares and opening hours move and we have no live
 * source to cite, so the notice states the day the article was last updated —
 * the one date the archive gives us — and sends the reader to the official
 * operator. It never says we checked anything, because nothing here proves it.
 */

export type GuideArticleStatus = 'loading' | 'ready' | 'error' | 'missing';

interface Props {
  copy: GuideCopy;
  status: GuideArticleStatus;
  doc: GuideDoc | null;
  /** Word count from `_index.json`. Absent for a guide the index does not list,
   *  in which case the reading time is simply not shown. */
  words?: number;
  onRetry?: () => void;
}

export function GuideArticleBody({ copy, status, doc, words, onRetry }: Props) {
  const c = copy.article;
  const minutes = readingMinutes(words);
  const safeHtml = doc ? sanitizeGuideHtml(doc.html) : '';

  return (
    <main className="ec-root">
      <div className="ec-container py-8 md:py-12">
        {/* One measured column, centred once the container is wider than it.
            Left-aligned it leaves ~470px of blank paper down one side at 1440,
            which reads as an unfinished page rather than an editorial one. */}
        <div className="mx-auto max-w-[46rem]">
          <Link
            to="/guide"
            className="ec-btn ec-btn-quiet -ml-3 inline-flex text-[14px] font-semibold text-ec-brand"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {c.back}
          </Link>

          {/* Before the article arrives — and on the two screens that never get
              one — the page still needs a top-level name, or the document has
              an h2 with nothing above it. The article's own h1 replaces this
              once the text is here. */}
          {status !== 'ready' && <h1 className="sr-only">{copy.index.title}</h1>}

          {status === 'loading' && <EcLoading label={c.loading} lines={8} className="mt-8" />}

          {status === 'error' && (
            <EcError
              title={c.error.title}
              body={c.error.body}
              retryLabel={c.error.retry}
              onRetry={onRetry}
            />
          )}

          {status === 'missing' && (
            <EcEmpty
              title={c.notFound.title}
              body={c.notFound.body}
              action={
                <Link to="/guide" className="ec-btn ec-btn-primary">
                  {c.notFound.cta}
                </Link>
              }
            />
          )}

          {/* `guide-article` = 이 글이 실제로 도착해 렌더됐다는 유일한 구조 신호.
              nav 스모크가 로딩·404·에러 화면과 구분하는 근거다(스타일 클래스로
              짚다가 `.guide-article` → `.ec-prose` 개편에서 조용히 끊겼다). */}
          {status === 'ready' && doc && (
            <article className="mt-6" data-testid="guide-article">
              {doc.labels.length > 0 && <p className="ec-eyebrow text-ec-brand">{doc.labels[0]}</p>}
              <h1 className="ec-h2 mt-3 text-[clamp(26px,3.4vw,40px)]">{doc.title}</h1>

              {/* Byline: what we measured, where the text came from, and in what
                  language it is written. Anything we do not have is left out. */}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-ec-line py-3">
                {doc.updated && (
                  <span className="ec-figure text-[12px] font-semibold text-ec-ink-3">
                    {fill(c.updated, { date: doc.updated })}
                  </span>
                )}
                {minutes !== null && (
                  <span className="ec-figure text-[12px] font-semibold text-ec-ink-3">
                    {fill(copy.readTime, { n: String(minutes) })}
                  </span>
                )}
                <span className="ec-chip">{c.source}</span>
                <span className="ec-chip">{c.bodyLanguage}</span>
              </div>

              {/* `--ec-notice` is the semantic token for "this can change on
                  you"; a neutral hairline on sunken paper is invisible. */}
              {doc.updated && (
                <p className="ec-body-sm mt-5 border-l-2 border-ec-notice bg-ec-sunken px-4 py-3 text-ec-ink-2">
                  {fill(c.freshness, { date: doc.updated })}
                </p>
              )}

              {/* Defense in depth: import-time audit and this browser-time sanitizer
                  share one allowlist. A stale legacy JSON or compromised source still
                  cannot render scripts, handlers, unsafe URLs, forms, SVG or styles.
                  `.ec-prose` is defined in
                  src/styles/guide-editorial.css — deliberately a new class, so
                  the dark `.guide-article` rules in index.css simply stop
                  applying instead of being fought with specificity. */}
              <div className="ec-prose mt-8" dangerouslySetInnerHTML={{ __html: safeHtml }} />

              {doc.labels.length > 0 && (
                <section className="mt-12 border-t border-ec-line pt-6">
                  <h2 className="ec-eyebrow">{c.topics}</h2>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {doc.labels.map((label) => (
                      <span key={label} className="ec-chip">
                        {label}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <div className="mt-10">
                <Link to="/guide" className="ec-btn ec-btn-secondary">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  {c.back}
                </Link>
              </div>
            </article>
          )}
        </div>
      </div>
    </main>
  );
}
