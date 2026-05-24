import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function About() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  usePageMeta({
    title: t.pageMeta?.about?.title ||'About CocoTrip',
    description: t.pageMeta?.about?.description ||'CocoTrip is a premium Korea inbound travel agency offering private tours, charter vehicles, and AI-powered trip planning.',
    ogImage: '/hero-hanok-real.webp',
  });

  if (isMobile) {
    return (
      <div className="m-page">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <main className="px-4 pt-6 pb-4">
          <h1 className="text-2xl font-black text-center m-shimmer-text mb-6">
            {t.about?.heading || 'About COCOTRIP'}
          </h1>
          <div className="flex flex-col items-center gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="m-card m-appear overflow-hidden" style={{ animationDelay: `${n * 0.1}s` }}>
                <img
                  src={`/브랜드 상세페이지/${n}.jpeg`}
                  alt={`Brand Story ${n}`}
                  loading="lazy"
                  className="w-full rounded-2xl"
                />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210]">
      <Header
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
      />
      <main className="container mx-auto px-4 py-16">
        <h1 className="text-5xl font-display font-normal text-center text-white mb-12 tracking-tight">{t.about?.heading || 'About COCOTRIP'}</h1>
        <div className="flex flex-col items-center gap-16 py-8">
          <img src="/브랜드 상세페이지/1.jpeg" alt="Brand Story 1" loading="lazy" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/2.jpeg" alt="Brand Story 2" loading="lazy" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/3.jpeg" alt="Brand Story 3" loading="lazy" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/4.jpeg" alt="Brand Story 4" loading="lazy" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
