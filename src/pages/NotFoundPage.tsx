/**
 * 404 NotFoundPage — PR #446 (Audit W-H18).
 *
 * Pre-fix: src/App.tsx Routes had NO catch-all. Unknown URL → no route
 * matches → blank page (the parent layout renders without children).
 * SEO: search crawlers see 200 OK + empty body = "soft 404" penalty.
 * UX: dead inbound link → user sees nothing, bounces.
 *
 * Post-fix: this component is mounted at `<Route path="*" />` as the
 * final route. It:
 *   - sets `<meta name="robots" content="noindex">` so crawlers don't
 *     index these soft-404 URLs (SPA can't return real 404 status from
 *     a single index.html — noindex is the practical signal)
 *   - displays a clear "page not found" message in the active locale
 *   - links back to /, /tours, /charter so the visitor has a path
 *     forward instead of bouncing
 *
 * Note on real-404 status: Vercel rewrites all SPA paths to index.html
 * (200), so we can't return HTTP 404 from React. The combination of
 * noindex meta + visible "Page Not Found" content is the standard
 * SPA pattern Google's crawler reads as a soft-404 to deindex.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';

const COPY: Record<string, { title: string; subtitle: string; home: string; tours: string; charter: string; description: string }> = {
  en: {
    title: 'Page Not Found',
    subtitle: "The page you're looking for doesn't exist or has moved.",
    home: 'Back to Home',
    tours: 'Browse Tours',
    charter: 'Charter Vehicle',
    description: '404 — the requested URL is not on CocoTrip.',
  },
  ko: {
    title: '페이지를 찾을 수 없습니다',
    subtitle: '요청하신 페이지가 없거나 이동되었습니다.',
    home: '홈으로',
    tours: '투어 둘러보기',
    charter: '전세차량 견적',
    description: '404 — 요청하신 URL을 찾을 수 없습니다.',
  },
  ja: {
    title: 'ページが見つかりません',
    subtitle: 'お探しのページは存在しないか、移動されました。',
    home: 'ホームへ',
    tours: 'ツアーを見る',
    charter: 'チャーター車両',
    description: '404 — 該当URLが見つかりません。',
  },
  zh: {
    title: '页面未找到',
    subtitle: '您查找的页面不存在或已被移动。',
    home: '返回首页',
    tours: '浏览旅游',
    charter: '包车',
    description: '404 — 未找到所请求的URL。',
  },
};

export default function NotFoundPage() {
  const { language, t, changeLanguage } = useLanguage();
  const lang = (language && (COPY as Record<string, unknown>)[language]) ? language : 'en';
  const copy = COPY[lang] || COPY.en;

  usePageMeta({
    title: copy.title,
    description: copy.description,
    ogUrl: typeof window !== 'undefined' ? window.location.href : undefined,
  });

  // Set <meta name="robots" content="noindex"> so crawlers de-index soft-404 URLs.
  // Restored on unmount so other pages (which should be indexable) aren't poisoned.
  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const prev = existing?.content || null;
    let tag = existing;
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'robots';
      document.head.appendChild(tag);
    }
    tag.content = 'noindex, follow';
    return () => {
      if (tag) {
        if (prev === null) tag.remove();
        else tag.content = prev;
      }
    };
  }, []);

  return (
    <>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main
        role="main"
        aria-labelledby="not-found-title"
        style={{
          minHeight: 'calc(100vh - 120px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 1.5rem',
          textAlign: 'center',
          gap: '1.5rem',
        }}
      >
        <div
          aria-hidden="true"
          style={{ fontSize: '6rem', lineHeight: 1, fontWeight: 700, color: '#94a3b8' }}
        >
          404
        </div>
        <h1
          id="not-found-title"
          style={{ fontSize: '1.875rem', fontWeight: 600, margin: 0, color: '#0f172a' }}
        >
          {copy.title}
        </h1>
        <p style={{ fontSize: '1rem', color: '#475569', maxWidth: '32rem', margin: 0 }}>
          {copy.subtitle}
        </p>
        <nav
          aria-label="404-quick-links"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem', justifyContent: 'center' }}
        >
          <Link
            to="/"
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              background: '#0f172a',
              color: '#ffffff',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            {copy.home}
          </Link>
          <Link
            to="/tours"
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              background: '#e2e8f0',
              color: '#0f172a',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            {copy.tours}
          </Link>
          <Link
            to="/charter"
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              background: '#e2e8f0',
              color: '#0f172a',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            {copy.charter}
          </Link>
        </nav>
      </main>
      <Footer t={t} />
    </>
  );
}
