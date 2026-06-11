import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage, LanguageProvider } from '@/hooks/useLanguage';
import { AuthRequired } from '@/components/AuthRequired';
import { Header } from '@/sections/Header';
import { PromoBanner } from '@/components/PromoBanner';
import { PromoPopup } from '@/components/PromoPopup';
import { HeroSlider } from '@/sections/HeroSlider';
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
// MobileHome (mobile only)  → tours.ts (~92 KB raw) leak 방지
// SeasonalBanner (desktop only)  → seasonalSpots.ts (~20 KB raw) leak 방지
// 둘 다 device branch 별 1개만 마운트되므로 lazy 로 분리해 메인 번들에서 제외.
const MobileHome = lazy(() => import('@/sections/MobileHome').then(m => ({ default: m.MobileHome })));
const SeasonalBanner = lazy(() => import('@/components/SeasonalBanner').then(m => ({ default: m.SeasonalBanner })));
const RegionDetail = lazy(() => import('@/pages/RegionDetail').then(m => ({ default: m.RegionDetail })));
// Booking 레거시 페이지 — /booking 라우트는 /tours로 redirect (북마크 호환).
// BookingPageWrapper + Booking lazy import는 PR #197에서 제거됨.
const About = lazy(() => import('@/pages/About'));
const Terms = lazy(() => import('@/pages/Terms'));
const Privacy = lazy(() => import('@/pages/Privacy'));
const TravelTerms = lazy(() => import('@/pages/TravelTerms'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const Admin = lazy(() => import('@/pages/Admin'));
const AdminReviews = lazy(() => import('@/pages/AdminReviews'));
const AdminClaims = lazy(() => import('@/pages/AdminClaims'));
const AdminPayments = lazy(() => import('@/pages/AdminPayments'));
const AdminReconciliation = lazy(() => import('@/pages/AdminReconciliation'));
const AdminPlans = lazy(() => import('@/pages/AdminPlans'));
const AdminTourAvailability = lazy(() => import('@/pages/AdminTourAvailability'));
const AdminSales = lazy(() => import('@/pages/AdminSales'));
const AdminBriefing = lazy(() => import('@/pages/AdminBriefing'));
const AdminDecisions = lazy(() => import('@/pages/AdminDecisions'));
const AdminCalendar = lazy(() => import('@/pages/AdminCalendar'));
const AdminAnalytics = lazy(() => import('@/pages/AdminAnalytics'));
const AdminOpsHub = lazy(() => import('@/pages/AdminOpsHub'));
const AdminQualityDashboard = lazy(() => import('@/pages/AdminQualityDashboard'));
const AdminTranslations = lazy(() => import('@/pages/AdminTranslations'));
const AdminCoupons = lazy(() => import('@/pages/AdminCoupons'));
const AdminProducts = lazy(() => import('@/pages/AdminProducts'));
const AdminProductEditor = lazy(() => import('@/pages/AdminProductEditor'));
const AdminZoneCourses = lazy(() => import('@/pages/AdminZoneCourses'));
const AdminZoneCourseEditor = lazy(() => import('@/pages/AdminZoneCourseEditor'));
const AdminIntentClassifier = lazy(() => import('@/pages/AdminIntentClassifier'));
const PlannerPage = lazy(() => import('@/pages/PlannerPage'));
const MobileHomeV2 = lazy(() => import('@/pages/MobileHomeV2'));
const MobileTourDetailV2 = lazy(() => import('@/pages/MobileTourDetailV2'));
const MobilePlannerResultV2 = lazy(() => import('@/pages/MobilePlannerResultV2'));
const MobileCharterV2 = lazy(() => import('@/pages/MobileCharterV2'));
const MobileIconsPreview = lazy(() => import('@/pages/MobileIconsPreview'));
import { AdminRoute } from '@/components/AdminRoute';
import { HeroCards } from '@/sections/HeroCards';
import { TrustBadges } from '@/components/TrustBadges';
const CharterPage = lazy(() => import('@/pages/CharterPage'));
const CharterNewPage = lazy(() => import('@/pages/CharterNewPage'));
const MyPage = lazy(() => import('@/pages/MyPage'));
import { PlannerSkeleton, CharterSkeleton } from '@/components/PageSkeleton';
const MyPlansPage = lazy(() => import('@/pages/MyPlansPage'));
const SignupOnboarding = lazy(() => import('@/pages/SignupOnboarding'));
// MOOD B2B 선불 예약 포털 — 숨은 내부 모듈. 공개 네비/프리렌더에 절대 추가 금지.
// 접근은 로그인 + mood_config/allowlist 게이트로만 (페이지 자체가 권한 검증).
const MoodPortal = lazy(() => import('@/pages/MoodPortal'));

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
const OnboardingCouponModal = lazy(() => import('@/components/OnboardingCouponModal').then(m => ({ default: m.OnboardingCouponModal })));
import { handleRedirectResult } from '@/lib/firebase';
import { usePageMeta } from '@/hooks/usePageMeta';
// ChatFAB 제거됨 — 텔레그램 봇으로 대체
import { trackPageView } from '@/lib/analytics';

function HomePage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  // 정제 퍼플·핑크 (운영자 2026-06-01 채택). OFF=현재 그대로. env VITE_FEATURE_REFINED_UI / ?refined.
  const REFINED = import.meta.env.VITE_FEATURE_REFINED_UI === 'true'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refined'));

  usePageMeta({
    title: t.pageMeta?.home?.title ||'CocoTrip — Premium Korea Travel',
    description: t.pageMeta?.home?.description ||'Private tours, charter vehicles, AI travel planner for Korea. Airport pickup, K-pop shuttle, day tours across Seoul, Busan, Gyeongju & more.',
    ogImage: '/hero-seoul-real.webp',
  });

  // 모바일 v2 홈 (2026-06-10): 플래그 OFF 기본 = 기존 MobileHome 그대로 (prod 무변).
  // 활성: Vercel env VITE_FEATURE_MOBILE_V2=true, 또는 ?v2 쿼리(검증용).
  // v2 는 자체 헤더(로고+언어 전환)를 가지므로 전역 Header 없이 렌더.
  const MOBILE_V2 = import.meta.env.VITE_FEATURE_MOBILE_V2 === 'true'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('v2'));

  // 모바일: 앱 스타일 홈
  if (isMobile) {
    if (MOBILE_V2) {
      return (
        <Suspense fallback={<div className="min-h-screen" style={{ background: '#0a0b14' }} aria-hidden />}>
          <MobileHomeV2 />
        </Suspense>
      );
    }
    return (
      <div className="min-h-screen bg-[#0a0b14]">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <main className="pt-14">
          {/* MobileHome lazy chunk — tours.ts (~92 KB raw) 가 메인 번들에 진입하지 않도록 분리.
              fallback 은 hero 영역 dark 배경 placeholder 로 layout shift 최소화. */}
          <Suspense fallback={<div className="min-h-screen" style={{ background: '#0a0412' }} aria-hidden />}>
            <MobileHome t={t} />
          </Suspense>
        </main>
      </div>
    );
  }

  // 데스크톱: 모바일과 통일된 다크 gradient (D1: 통일성)
  return (
    <div className={`min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210] ${REFINED ? 'refined-home' : ''}`}>
      <Header
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
      />
      <main>
        <HeroSlider t={t} />
        <TrustBadges />
        <HeroCards t={t} />
        <Suspense fallback={null}>
          <CustomerGallery />
          <GoogleReviews />
        </Suspense>
        <Services t={t} />
        <Suspense fallback={null}>
          <SeasonalBanner />
        </Suspense>
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
        {/* 회원가입 직후 1회 노출 — sessionStorage flag 기반, 어느 페이지서도 노출 */}
        <OnboardingCouponModal />
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
          {/* 모바일 v2 홈 미리보기 (증분1, 라이브 무영향) — 운영자 검토용 */}
          <Route path="/preview/mobile-home" element={<Suspense fallback={<PlannerSkeleton />}><MobileHomeV2 /></Suspense>} />
          <Route path="/preview/mobile-tour" element={<Suspense fallback={<PlannerSkeleton />}><MobileTourDetailV2 /></Suspense>} />
          <Route path="/preview/mobile-planner" element={<Suspense fallback={<PlannerSkeleton />}><MobilePlannerResultV2 /></Suspense>} />
          <Route path="/preview/mobile-charter" element={<Suspense fallback={<PlannerSkeleton />}><MobileCharterV2 /></Suspense>} />
          <Route path="/preview/icons" element={<Suspense fallback={<PlannerSkeleton />}><MobileIconsPreview /></Suspense>} />
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
            path="/admin/briefing"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminBriefing />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/decisions"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminDecisions />
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
            path="/admin/translations"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminTranslations />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/coupons"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminCoupons />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminProducts />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products/new"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminProductEditor />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/products/edit/:tourId"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminProductEditor />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/zone-courses"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminZoneCourses />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/zone-courses/new"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminZoneCourseEditor />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/zone-courses/edit/:blockId"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminZoneCourseEditor />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/intent-classifier"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminIntentClassifier />
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
          {/* MOOD 포털 — 숨은 내부 모듈. 사이트맵/프리렌더/네비 미노출. 권한은 페이지 내부 게이트. */}
          <Route
            path="/mood"
            element={
              <Suspense fallback={<PlannerSkeleton />}>
                <MoodPortal />
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
          {/* PR #446 (Audit W-H18): catch-all 404. MUST be the LAST route. */}
          <Route
            path="*"
            element={
              <Suspense fallback={<PlannerSkeleton />}>
                <NotFoundPage />
              </Suspense>
            }
          />
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
        <PromoBanner />
        <PromoPopup />
        <AnimatedRoutes />
        <MobileBottomSpacer />
        </CommandPaletteProvider>
      </BrowserRouter>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

export default App;

// 배포 트리거: 할인 v2 env(FEATURE_DISCOUNT_V2) 활성화 fresh 배포 — 운영자 env 적용 2026-06-07
