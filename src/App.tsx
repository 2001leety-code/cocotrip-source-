import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
const Booking = lazy(() => import('@/pages/Booking'));
const About = lazy(() => import('@/pages/About'));
const Terms = lazy(() => import('@/pages/Terms'));
const Privacy = lazy(() => import('@/pages/Privacy'));
const TravelTerms = lazy(() => import('@/pages/TravelTerms'));
const Admin = lazy(() => import('@/pages/Admin'));
const AdminReviews = lazy(() => import('@/pages/AdminReviews'));
const AdminClaims = lazy(() => import('@/pages/AdminClaims'));
const PlannerPage = lazy(() => import('@/pages/PlannerPage'));
import { AdminRoute } from '@/components/AdminRoute';
import { HeroCards } from '@/sections/HeroCards';
const CharterPage = lazy(() => import('@/pages/CharterPage'));
const MyPage = lazy(() => import('@/pages/MyPage'));
import { PlannerSkeleton, CharterSkeleton } from '@/components/PageSkeleton';
const MyPlansPage = lazy(() => import('@/pages/MyPlansPage'));

// Retry dynamic import — if chunk is stale after deploy, force one page reload
function lazyRetry(importFn: () => Promise<{ default: React.ComponentType }>) {
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


import { MobileBottomNav, MobileBottomSpacer } from '@/components/MobileBottomNav';
import { CommandPaletteProvider } from '@/components/CommandPalette';
import { KpopConcertPopup } from '@/components/KpopConcertPopup';
import { handleRedirectResult } from '@/lib/firebase';
import { usePageMeta } from '@/hooks/usePageMeta';
// ChatFAB 제거됨 — 텔레그램 봇으로 대체
import CookieBanner from '@/components/CookieBanner';
import { trackPageView } from '@/lib/analytics';

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
        <main className="pt-14">
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
  const { language: _language } = useLanguage();

  // Google Redirect 로그인 결과 처리 (signInWithRedirect 폴백 후 페이지 복귀 시)
  useEffect(() => {
    handleRedirectResult().catch(console.error);
  }, []);

  return (
    <>
      <PageViewTracker />

      <KpopConcertPopup />
      <MobileBottomNav />
      <CookieBanner />
    </>
  );
}

// ── GA4 SPA page view tracking ──
function PageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <CommandPaletteProvider>
        <GlobalWidgets />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/region/:regionId" element={<RegionDetail />} />
          <Route path="/booking" element={<BookingPageWrapper />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <Admin />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/reviews"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminReviews />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/claims"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminClaims />
                </Suspense>
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
          <Route path="/about" element={<Suspense fallback={<PlannerSkeleton />}><About /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<PlannerSkeleton />}><Terms /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={<PlannerSkeleton />}><Privacy /></Suspense>} />
          <Route path="/travel-terms" element={<Suspense fallback={<PlannerSkeleton />}><TravelTerms /></Suspense>} />
          <Route
            path="/mypage"
            element={
              <AuthRequired>
                <Suspense fallback={<PlannerSkeleton />}>
                  <MyPage />
                </Suspense>
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
        <MobileBottomSpacer />
        </CommandPaletteProvider>
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
      <Suspense fallback={<PlannerSkeleton />}>
        <Booking onClose={() => navigate(-1)} />
      </Suspense>
    </div>
  );
}

export default App;
