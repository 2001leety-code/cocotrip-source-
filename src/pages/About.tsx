import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';

export default function About() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
      />
      <main className="container mx-auto px-4 py-16">
        <h1 className="text-4xl font-bold text-center text-[#1a1a2e] mb-12">About COCOTRIP</h1>
        <div className="flex flex-col items-center gap-16 py-8">
          <img src="/브랜드 상세페이지/1.jpeg" alt="Brand Story 1" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/2.jpeg" alt="Brand Story 2" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/3.jpeg" alt="Brand Story 3" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
          <img src="/브랜드 상세페이지/4.jpeg" alt="Brand Story 4" className="w-full max-w-3xl mx-auto rounded-2xl shadow-xl object-cover" />
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
