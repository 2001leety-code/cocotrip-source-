import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { useLanguage, LanguageProvider } from '@/hooks/useLanguage';
import { AuthRequired } from '@/components/AuthRequired';
import { Header } from '@/sections/Header';
import { HeroSlider } from '@/sections/HeroSlider';
import { MobileHome } from '@/sections/MobileHome';
import { useIsMobile } from '@/hooks/use-mobile';
import { Services } from '@/sections/Services';
import { Regions } from '@/sections/Regions';
import { CustomerGallery } from '@/sections/CustomerGallery';
import { GoogleReviews } from '@/sections/GoogleReviews';
import { CTA } from '@/sections/CTA';
import { Membership } from '@/sections/Membership';
import { Footer } from '@/sections/Footer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SeasonalBanner } from '@/components/SeasonalBanner';
import { RegionDetail } from '@/pages/RegionDetail';
import Booking from '@/pages/Booking';
import About from '@/pages/About';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import TravelTerms from '@/pages/TravelTerms';
import Admin from '@/pages/Admin';
const PlannerPage = lazy(() => import('@/pages/PlannerPage'));
import { AdminRoute } from '@/components/AdminRoute';
import { HeroCards } from '@/sections/HeroCards';
const CharterPage = lazy(() => import('@/pages/CharterPage'));
import MyPage from '@/pages/MyPage';
import { PlannerSkeleton, CharterSkeleton } from '@/components/PageSkeleton';
const MyPlansPage = lazy(() => import('@/pages/MyPlansPage'));

// Retry dynamic import — if chunk is stale after deploy, force one page reload
function lazyRetry(importFn: () => Promise<any>) {
  return lazy(() =>
    importFn().catch(() => {
      const key = 'chunk_reload';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
      return importFn();
    })
  );
}
const PlanDetailPage = lazyRetry(() => import('@/pages/PlanDetailPage'));
const ToursPage = lazy(() => import('@/pages/ToursPage'));
const TourDetailPage = lazy(() => import('@/pages/TourDetailPage'));

import { EarlyBirdBanner } from '@/components/EarlyBirdBanner';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { KpopConcertPopup } from '@/components/KpopConcertPopup';
import { handleRedirectResult } from '@/lib/firebase';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ChatFAB } from '@/components/ChatFAB';
import CookieBanner from '@/components/CookieBanner';

function HomePage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  usePageMeta({
    title: 'CocoTrip — Premium Korea Travel',
    description: 'Private tours, charter vehicles, AI travel planner for Korea. Airport pickup, K-pop shuttle, day tours across Seoul, Busan, Gyeongju & more.',
    ogImage: '/hero-seoul-real.webp',
  });

  // 모바일: 앱 스타일 홈
  if (isMobile) {
    return (
      <div className="min-h-screen bg-[#0a0b14]">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <main className="pt-16">
          <MobileHome t={t} />
        </main>
      </div>
    );
  }

  // 데스크톱: 기존 디자인 유지
  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Header
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
      />
      <main>
        <HeroSlider t={t} />
        <HeroCards t={t} />
        <CustomerGallery />
        <GoogleReviews />
        <Services t={t} />
        <SeasonalBanner />
        <Regions t={t} />
        <Membership t={t} />
        <CTA t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}

function GlobalWidgets() {
  const { language } = useLanguage();

  // Google Redirect 로그인 결과 처리 (signInWithRedirect 폴백 후 페이지 복귀 시)
  useEffect(() => {
    handleRedirectResult().catch(console.error);
  }, []);

  return (
    <>
      <EarlyBirdBanner language={language} />
      <KpopConcertPopup />
      <MobileBottomNav />
      <ChatFAB />
      <CookieBanner />
    </>
  );
}

function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <GlobalWidgets />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/region/:regionId" element={<RegionDetail />} />
          <Route path="/booking" element={<BookingPageWrapper />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route
            path="/charter"
            element={
              <AuthRequired>
                <Suspense fallback={<CharterSkeleton />}>
                  <CharterPage />
                </Suspense>
              </AuthRequired>
            }
          />
          <Route
            path="/planner"
            element={
              <Suspense fallback={<PlannerSkeleton />}>
                <PlannerPage />
              </Suspense>
            }
          />
          <Route path="/tours" element={<Suspense fallback={<PlannerSkeleton />}><ToursPage /></Suspense>} />
          <Route path="/tours/:slug" element={<Suspense fallback={<PlannerSkeleton />}><TourDetailPage /></Suspense>} />
          <Route path="/about" element={<About />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/travel-terms" element={<TravelTerms />} />
          <Route
            path="/mypage"
            element={
              <AuthRequired>
                <MyPage />
              </AuthRequired>
            }
          />
          <Route
            path="/my-plans"
            element={
              <AuthRequired>
                <Suspense fallback={<PlannerSkeleton />}>
                  <MyPlansPage />
                </Suspense>
              </AuthRequired>
            }
          />
          <Route
            path="/my-plans/:planId"
            element={
              <Suspense fallback={<PlannerSkeleton />}>
                <PlanDetailPage />
              </Suspense>
            }
          />
        </Routes>
      </BrowserRouter>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

// Wrapper to handle the close action of the booking modal when accessed via route
function BookingPageWrapper() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-black/90 relative" style={{ backgroundImage: "url('/1uA0qa_반포대교(1).jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <Booking onClose={() => navigate(-1)} />
    </div>
  );
}

export default App;
