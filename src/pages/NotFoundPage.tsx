import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';
import {
  NOT_FOUND_COPY,
  NOT_FOUND_EDITORIAL_CSS,
  resolveNotFoundLanguage,
} from '@/lib/notFoundEditorial.js';

export default function NotFoundPage() {
  const { language, t, changeLanguage } = useLanguage();
  const lang = resolveNotFoundLanguage(language) as keyof typeof NOT_FOUND_COPY;
  const copy = NOT_FOUND_COPY[lang] || NOT_FOUND_COPY.en;

  usePageMeta({
    title: copy.title,
    description: copy.description,
    ogUrl: typeof window !== 'undefined' ? window.location.href : undefined,
  });

  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const prev = existing ? existing.content : null;
    let tag = existing;
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'robots';
      document.head.appendChild(tag);
    }
    tag.content = 'noindex, nofollow';
    return () => {
      if (!tag) return;
      if (prev === null) tag.remove();
      else tag.content = prev;
    };
  }, []);

  return (
    <>
      <style>{NOT_FOUND_EDITORIAL_CSS}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main
        className="not-found-editorial not-found-editorial--app ec-root"
        data-testid="not-found-editorial"
        role="main"
        aria-labelledby="not-found-title"
      >
        <section className="not-found-editorial__document">
          <div className="not-found-editorial__index">
            <p className="not-found-editorial__eyebrow">{copy.eyebrow}</p>
            <div className="not-found-editorial__figure" aria-hidden="true">404</div>
          </div>
          <div className="not-found-editorial__content">
            <h1 className="not-found-editorial__title" id="not-found-title">{copy.title}</h1>
            <p className="not-found-editorial__body">{copy.subtitle}</p>
            <nav className="not-found-editorial__actions" aria-label={copy.recoveryLabel}>
              <Link
                className="not-found-editorial__action not-found-editorial__action--primary"
                data-recovery-link
                to="/"
              >
                {copy.home}
              </Link>
              <Link className="not-found-editorial__action" data-recovery-link to="/tours">
                {copy.tours}
              </Link>
              <Link className="not-found-editorial__action" data-recovery-link to="/charter">
                {copy.charter}
              </Link>
            </nav>
          </div>
        </section>
      </main>
      <Footer t={t} />
    </>
  );
}
