import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage, LanguageProvider } from '@/hooks/useLanguage';
import { AuthRequired } from '@/components/AuthRequired';
import { Header } from '@/sections/Header';
import { HeroSlider } from '@/sections/HeroSlider';
import { MobileHome } from '@/sections/MobileHome';
import { useIsMobile } from '@/hooks/use-mobile';
import { Services } from '@/sections/Services';
import { Regions } from '@/sections/Regions';
// below-the-fold sections — first paint은 Header+Hero만 보이므로 lazy로 분리.
const CustomerGallery = lazy(() => import('@/sections/CustomerGallery').then(m => ({ default: m.CustomerGallery })));
const GoogleReviews = lazy(() => import('@/sections/GoogleReviews').then(m => ({ default: m.GoogleReviews })));
const CTA = lazy(() => import('@/sections/CTA').then(m => ({ default: m.CTA })));
const Membership = lazy(() => import('@/sections/Membership').then(m => ({ default: m.Membership })));
import { Footer } from '@/sections/Footer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SeasonalBanner } from '@/components/SeasonalBanner';
const RegionDetail = lazy(() => import('@/pages/RegionDetail').then(m => ({ default: m.RegionDetail })));
// Booking 레거시 페이지 — /booking 라우트는 /tours로 redirect (북마크 호환).
// BookingPageWrapper + Booking lazy import는 PR #197에서 제거됨.
const About = lazy(() => import('@/pages/About'));
const Terms = lazy(() => import('@/pages/Terms'));
const Privacy = lazy(() => import('@/pages/Privacy'));
const TravelTerms = lazy(() => import('@/pages/TravelTerms'));
const Admin = lazy(() => import('@/pages/Admin'));
const AdminReviews = lazy(() => import('@/pages/AdminReviews'));
const AdminClaims = lazy(() => import('@/pages/AdminClaims'));
const AdminPayments = lazy(() => import('@/pages/AdminPayments'));
const AdminReconciliation = lazy(() => import('@/pages/AdminReconciliation'));
const AdminPlans = lazy(() => import('@/pages/AdminPlans'));
const AdminTourAvailability = lazy(() => import('@/pages/AdminTourAvailability'));
const AdminSales = lazy(() => import('@/pages/AdminSales'));
const AdminCalendar = lazy(() => import('@/pages/AdminCalendar'));
const AdminAnalytics = lazy(() => import('@/pages/AdminAnalytics'));
const AdminOpsHub = lazy(() => import('@/pages/AdminOpsHub'));
const AdminQualityDashboard = lazy(() => import('@/pages/AdminQualityDashboard'));
const PlannerPage = lazy(() => import('@/pages/PlannerPage'));
import { AdminRoute } from '@/components/AdminRoute';
import { HeroCards } from '@/sections/HeroCards';
const CharterPage = lazy(() => import('@/pages/CharterPage'));
const CharterNewPage = lazy(() => import('@/pages/CharterNewPage'));
const MyPage = lazy(() => import('@/pages/MyPage'));
import { PlannerSkeleton, CharterSkeleton } from '@/components/PageSkeleton';
const MyPlansPage = lazy(() => import('@/pages/MyPlansPage'));
const SignupOnboarding = lazy(() => import('@/pages/SignupOnboarding'));

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
// DEV-only test harness — prod 빌드에서 chunk 자체가 emit되지 않도록 lazy 호출을 조건부로.
// import.meta.env.DEV 가 false일 때 import('@/pages/DevTransitTest') 호출 자체가 코드에서 사라짐 → tree-shake 성공.
const DevTransitTest = import.meta.env.DEV
  ? lazy(() => import('@/pages/DevTransitTest'))
  : null;


import { MobileBottomNav, MobileBottomSpacer } from '@/components/MobileBottomNav';
import { CommandPaletteProvider } from '@/components/CommandPalette';
// 비-critical UI는 lazy로 분리해서 first paint 줄임 (Suspense fallback=null 허용 — popup/toast는 보이지 않다가 로드 완료되면 등장).
const KpopConcertPopup = lazy(() => import('@/components/KpopConcertPopup').then(m => ({ default: m.KpopConcertPopup })));
const ChatWidget = lazy(() => import('@/components/ChatWidget').then(m => ({ default: m.ChatWidget })));
const PWAUpdatePrompt = lazy(() => import('@/components/PWAUpdatePrompt').then(m => ({ default: m.PWAUpdatePrompt })));
const CookieBanner = lazy(() => import('@/components/CookieBanner'));
import { handleRedirectResult } from '@/lib/firebase';
import { usePageMeta } from '@/hooks/usePageMeta';
// ChatFAB 제거됨 — 텔레그램 봇으로 대체
import { trackPageView } from '@/lib/analytics';

function HomePage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();

  usePageMeta({
    title: t.pageMeta?.home?.title ||'CocoTrip — Premium Korea Travel',
    description: t.pageMeta?.home?.description ||'Private tours, charter vehicles, AI travel planner for Korea. Airport pickup, K-pop shuttle, day tours across Seoul, Busan, Gyeongju & more.',
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
        <Suspense fallback={null}>
          <CustomerGallery />
          <GoogleReviews />
        </Suspense>
        <Services t={t} />
        <SeasonalBanner />
        <Regions t={t} />
        <Suspense fallback={null}>
          <Membership t={t} />
          <CTA t={t} />
        </Suspense>
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
      <PageViewTracker />

      <Suspense fallback={null}>
        <KpopConcertPopup />
      </Suspense>
      <MobileBottomNav />
      <Suspense fallback={null}>
        <CookieBanner />
        <PWAUpdatePrompt />
        <ChatWidget language={language} />
      </Suspense>
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

// 페이지 전환 애니메이션 — 라우팅 시 부드러운 fade (모바일 앱 느낌의 마지막 퍼즐).
// opacity만 사용 (transform/x 추가 시 모바일 가로 스크롤 위험). 0.18s 짧게.
// initial={false}: 첫 페이지 로드 시 애니메이션 생략 (이미 있는 콘텐츠 깜빡임 방지).
// mode="wait": 이전 페이지 exit 완료 후 새 페이지 mount → Suspense fallback과 잘 어울림.
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/region/:regionId" element={<Suspense fallback={<PlannerSkeleton />}><RegionDetail /></Suspense>} />
          <Route path="/booking" element={<Navigate to="/tours" replace />} />
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
            path="/admin/payments"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminPayments />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/reconciliation"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminReconciliation />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/plans"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminPlans />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/availability"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminTourAvailability />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/sales"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminSales />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/calendar"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminCalendar />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/analytics"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminAnalytics />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/ops"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminOpsHub />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/quality"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminQualityDashboard />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/charter"
            element={
              <AuthRequired>
                <Suspense fallback={<CharterSkeleton />}>
                  <CharterNewPage />
                </Suspense>
              </AuthRequired>
            }
          />
          <Route
            path="/charter-new"
            element={<Navigate to="/charter" replace />}
          />
          <Route
            path="/charter-legacy"
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
            path="/onboarding"
            element={
              <AuthRequired>
                <Suspense fallback={<PlannerSkeleton />}>
                  <SignupOnboarding />
                </Suspense>
              </AuthRequired>
            }
          />
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
          {import.meta.env.DEV && DevTransitTest && (
            <Route
              path="/dev/transit-test"
              element={
                <Suspense fallback={<PlannerSkeleton />}>
                  <DevTransitTest />
                </Suspense>
              }
            />
          )}
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <CommandPaletteProvider>
        <GlobalWidgets />
        <AnimatedRoutes />
        <MobileBottomSpacer />
        </CommandPaletteProvider>
      </BrowserRouter>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

export default App;
