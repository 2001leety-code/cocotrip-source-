import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { ManifestSwitcher } from '@/components/ManifestSwitcher';
import { RouteTransition } from '@/components/RouteTransition';
import { useLanguage, LanguageProvider } from '@/hooks/useLanguage';
import { AuthRequired } from '@/components/AuthRequired';
import { Header } from '@/sections/Header';
import { PromoBanner } from '@/components/PromoBanner';
import { PromoPopup } from '@/components/PromoPopup';
// Home — one responsive Editorial Concierge tree (2026-08-10). Lazy: it pulls
// tours.ts (~92 KB raw) + the example-plan data, which must not enter the eager
// first-paint bundle guarded by .size-limit.json.
// The previous home sections (HeroSlider / HeroCards / Services / Regions /
// Membership / CTA / CustomerGallery / GoogleReviews / BlogTeaser /
// FeatureOverview / TrustBadges / SeasonalBanner / MobileHome) still exist on
// disk — other pages and unit tests reference them — and retire with the pages
// converted in the next PR. Nothing routes to them from here any more.
const HomeEditorial = lazy(() => import('@/sections/home').then(m => ({ default: m.HomeEditorial })));
import { Footer } from '@/sections/Footer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
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
const AdminAllBookings = lazy(() => import('@/pages/AdminAllBookings'));
const AdminReconciliation = lazy(() => import('@/pages/AdminReconciliation'));
const AdminPaymentReviews = lazy(() => import('@/pages/AdminPaymentReviews'));
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
const AdminPromoStats = lazy(() => import('@/pages/AdminPromoStats'));
const PlannerPage = lazy(() => import('@/pages/PlannerPage'));
const MobileHomeV2 = lazy(() => import('@/pages/MobileHomeV2'));
// V2 목업 프리뷰 3종 + 아이콘 시트 — 로컬 검수 전용 (2026-07-19: DEV 게이트로 prod 제외.
// 다크 목업이 운영 경로와 혼동되는 것 방지 + prod 번들에서 chunk 자체 제거).
// MobileHomeV2 는 라이브 홈(V2 플래그)에서 쓰므로 게이트 대상 아님.
const MobileTourDetailV2 = import.meta.env.DEV ? lazy(() => import('@/pages/MobileTourDetailV2')) : null;
const MobilePlannerResultV2 = import.meta.env.DEV ? lazy(() => import('@/pages/MobilePlannerResultV2')) : null;
const MobileCharterV2 = import.meta.env.DEV ? lazy(() => import('@/pages/MobileCharterV2')) : null;
const MobileIconsPreview = import.meta.env.DEV ? lazy(() => import('@/pages/MobileIconsPreview')) : null;
// 여행 가이드 — blogspot 이식 (2026-08-01 유입 확보). 본문 JSON 은 글별 lazy 청크.
const GuideIndexPage = lazy(() => import('@/pages/GuidePage'));
const GuideDetailPage = lazy(() => import('@/pages/GuidePage').then(m => ({ default: m.GuideDetailPage })));
const CommunityPage = lazy(() => import('@/pages/CommunityPage'));
const CommunityPostPage = lazy(() => import('@/pages/CommunityPage').then(m => ({ default: m.CommunityPostPage })));
const CommunityComposePage = lazy(() => import('@/pages/CommunityPage').then(m => ({ default: m.CommunityComposePage })));
const CommunityModerationPage = lazy(() => import('@/pages/CommunityPage').then(m => ({ default: m.CommunityModerationPage })));
import { AdminRoute } from '@/components/AdminRoute';
const CharterPage = lazy(() => import('@/pages/CharterPage'));
const CharterNewPage = lazy(() => import('@/pages/CharterNewPage'));
const MyPage = lazy(() => import('@/pages/MyPage'));
import { PlannerSkeleton, CharterSkeleton } from '@/components/PageSkeleton';
const MyPlansPage = lazy(() => import('@/pages/MyPlansPage'));
// /map 독립 경로 지도 (2026-07-19 UI 리디자인) — DayRouteMap 재사용, Leaflet 은 그 컴포넌트의 lazy chunk.
const MapPage = lazy(() => import('@/pages/MapPage'));
// /assistant AI 어시스턴트 전면 화면 — ChatWidget 과 useChatSession 코어 공유.
const AssistantPage = lazy(() => import('@/pages/AssistantPage'));
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
const SharedCoursePage = lazy(() => import('@/pages/SharedCoursePage')); // 코스 빌더 공유 수신 /s/:id (2026-07-04)
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
// KpopConcertPopup 플로팅 배너 제거 (운영자 지시 2026-07-03) — 재활성화 시 lazy import + <KpopConcertPopup /> 복원
const ChatWidget = lazy(() => import('@/components/ChatWidget').then(m => ({ default: m.ChatWidget })));
const PWAUpdatePrompt = lazy(() => import('@/components/PWAUpdatePrompt').then(m => ({ default: m.PWAUpdatePrompt })));
const CookieBanner = lazy(() => import('@/components/CookieBanner'));
const OnboardingCouponModal = lazy(() => import('@/components/OnboardingCouponModal').then(m => ({ default: m.OnboardingCouponModal })));
import { handleRedirectResult } from '@/lib/firebase';
import { usePageMeta } from '@/hooks/usePageMeta';
// ChatFAB 제거됨 — 텔레그램 봇으로 대체
import { trackPageView, initWhatsAppTracking, initBlogTracking, initUtmCapture } from '@/lib/analytics';
import { capturePageView as posthogPageView } from '@/lib/posthog';
import { signalAppReady } from '@/lib/appReady';

function HomePage() {
  const { language, t, changeLanguage } = useLanguage();

  usePageMeta({
    title: t.pageMeta?.home?.title ||'CocoTrip — Premium Korea Travel',
    description: t.pageMeta?.home?.description ||'Private tours, charter vehicles, AI travel planner for Korea. Airport pickup, K-pop shuttle, day tours across Seoul, Busan, Gyeongju & more.',
    ogImage: '/hero-seoul-real.webp',
  });

  // Korea Editorial Concierge (2026-08-10): one responsive home for every
  // breakpoint. The mobile/desktop/`?v2` fork and the `.refined-home` corrective
  // cascade are both gone — `HomeEditorial` is the single tree, and its surface
  // comes from the semantic tokens in src/styles/editorial.css.
  // Design SSOT: docs/DESIGN-EDITORIAL-CONCIERGE.md
  return (
    <div className="ec-root min-h-screen">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      {/* Lazy chunk — tours.ts (~92 KB raw) and the example-plan data must stay
          out of the eager first-paint bundle (.size-limit.json entry gate).
          Fallback is paper so there is no flash before the chunk lands. */}
      <Suspense fallback={<div className="min-h-screen bg-ec-page" aria-hidden />}>
        <HomeEditorial />
      </Suspense>
      <Footer t={t} />
    </div>
  );
}

function GlobalWidgets() {
  const { language } = useLanguage();
  const location = useLocation();

  // Google Redirect 로그인 결과 처리 (signInWithRedirect 폴백 후 페이지 복귀 시)
  useEffect(() => {
    handleRedirectResult().catch(console.error);
  }, []);

  // MOOD 포털(/mood)은 고객 비노출 내부 사이트 — 마케팅/공용 chrome(프로모배너·챗위젯·
  // K-pop 팝업·쿠폰모달·하단 네비) 전부 숨김(별도 사이트 느낌).
  // ※ PWA 업데이트 토스트는 예외 — 무드도 새 버전 알림 받게 App 레벨에서 전역 렌더(운영자 요청).
  // 위 리다이렉트 로그인 useEffect 는 hooks 라 early-return 이어도 계속 실행됨.
  if (location.pathname.startsWith('/mood')) return null;

  // 2026-06-16: 공유 플랜(고객 제안서, /my-plans/{id}?shared=1)에서는 앱/마케팅 chrome
  //   (하단탭·채팅버튼·K-pop 팝업·가입쿠폰)을 숨겨 "프리미엄 여행 제안서"처럼 보이게.
  //   문의는 OutroSlide 의 WhatsApp CTA 로 유도. (쿠키배너는 GDPR 이라 유지.)
  const isSharedPlan = location.pathname.startsWith('/my-plans/') &&
    new URLSearchParams(location.search).get('shared') === '1';

  // ChatWidget — 홈(/)에서만 렌더. 위저드/결제/플랜 흐름에서 CTA를 덮어 방해하므로 홈 전용.
  // (운영자 #7, 2026-06-30. 기존 hideTrigger 분기 통합 — 홈 외엔 컴포넌트 자체 마운트 안 함).
  const isHome = location.pathname === '/';
  const isCommunity = location.pathname === '/community' || location.pathname.startsWith('/community/');

  return (
    <>
      {/* PageViewTracker 는 App 레벨로 옮겼다 — 여기 두면 위 `/mood` early-return 에 막혀
          계측이 통째로 죽는다(2026-08-05). 상세는 App.tsx 의 마운트 지점 주석. */}

      {/* KpopConcertPopup 플로팅 배너 — 운영자 지시로 제거 (2026-07-03). 컴포넌트·차터 kpop 탭 섹션은 유지 */}
      {!isSharedPlan && !isCommunity && <MobileBottomNav />}
      <Suspense fallback={null}>
        <CookieBanner />
        {isHome && <ChatWidget language={language} hideTrigger={false} />}
        {/* 회원가입 직후 1회 노출 — sessionStorage flag 기반, 어느 페이지서도 노출 */}
        {!isSharedPlan && !isCommunity && <OnboardingCouponModal />}
      </Suspense>
    </>
  );
}

// ── robots 메타 (라우트별 색인 여부) ──
// index.html 은 `index, follow` 로 고정돼 있고 SPA 는 전 경로에 그 HTML 을 준다. 즉 마이페이지·
// 공유링크·404 까지 "색인해도 된다" 고 말하고 있었다. 색인 목록(src/lib/seoRoutes.ts)에 없는
// 경로는 여기서 noindex 로 바꾼다. 목록에 있는 경로로 이동하면 다시 index 로 되돌린다
// (SPA 는 head 가 살아 있으므로 되돌리지 않으면 한 번 noindex 가 붙고 끝난다).
// 경로 목록은 **동적 import** — 색인 목록(26개 라우트 문자열)이 eager 메인 번들에 들어가면
// first-paint 예산(size-limit)을 먹는다. head 메타는 몇 ms 늦어도 무해하다
// (프리렌더는 2.5s 뒤 캡처, 구글은 렌더 후 읽는다).
function RobotsMeta() {
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/seoRoutes').then(({ isNoindexPath }) => {
      if (cancelled) return;   // 이동이 겹치면 늦게 온 판정이 현재 경로를 덮지 않게
      let tag = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement('meta');
        tag.name = 'robots';
        document.head.appendChild(tag);
      }
      // 🔴 2026-07-30 (P1-4): 서버 원문이 같은 경로에 `X-Robots-Tag: noindex, nofollow` 를 붙인다
      //   (vercel.json). 런타임 메타가 `follow` 를 말하면 두 신호가 어긋나므로 문구를 맞춘다.
      tag.content = isNoindexPath(location.pathname) ? 'noindex, nofollow' : 'index, follow';
    });
    return () => { cancelled = true; };
  }, [location.pathname]);
  return null;
}

// ── GA4 SPA page view tracking ──
function PageViewTracker() {
  const location = useLocation();
  // 전역 WhatsApp 클릭 추적 — mount 1회만 (idempotent). 16곳 wa.me 링크를 위임 리스너로 잡음.
  useEffect(() => {
    initWhatsAppTracking();
    initBlogTracking();
    initUtmCapture();
  }, []);
  // 🔴 2026-07-30 (P1-2): `location.search` 를 붙이지 않는다. 우리 쿼리에는 공유 토큰·플래너
  //   사전입력(호텔·식이·알레르기)·자유 입력이 들어간다. 경로만 보낸다.
  //   PostHog 도 자동 pageview 를 껐으므로(lib/posthog.ts) 같은 경로를 여기서 수동 전송한다.
  useEffect(() => {
    trackPageView(location.pathname);
    void posthogPageView(location.pathname);
  }, [location.pathname]);
  return null;
}

// 페이지 전환 애니메이션 — 라우팅 시 부드러운 fade (모바일 앱 느낌의 마지막 퍼즐).
// 🔴 mode="wait" 로 되돌리지 말 것: 새 페이지 mount 가 exit 애니메이션(rAF) 완료에
//   묶여서, rAF 가 멈춘 백그라운드/비가시 탭에서는 URL 만 바뀌고 화면이 안 바뀐다.
//   지금은 CSS fade 라 애니메이션이 안 돌아도 화면은 즉시 교체된다.
//   상세 = src/components/RouteTransition.tsx 주석.
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <RouteTransition>
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/region/:regionId" element={<Suspense fallback={<PlannerSkeleton />}><RegionDetail /></Suspense>} />
          <Route path="/booking" element={<Navigate to="/tours" replace />} />
          {/* 경로 지도 — 내 플랜 day 별 동선 (비로그인/플랜없음 빈 상태 포함, 게스트 접근 허용) */}
          <Route path="/map" element={<Suspense fallback={<PlannerSkeleton />}><MapPage /></Suspense>} />
          {/* AI 어시스턴트 전면 화면 — 비로그인은 페이지 내 로그인 게이트 (위젯과 동일 정책) */}
          <Route path="/assistant" element={<Suspense fallback={<PlannerSkeleton />}><AssistantPage /></Suspense>} />
          {/* 모바일 v2 미리보기 — 로컬(DEV) 검수 전용. prod 는 라우트 자체 미등록(2026-07-19, 혼동 방지). */}
          {import.meta.env.DEV && (
            <>
              <Route path="/preview/mobile-home" element={<Suspense fallback={<PlannerSkeleton />}><MobileHomeV2 /></Suspense>} />
              {MobileTourDetailV2 && <Route path="/preview/mobile-tour" element={<Suspense fallback={<PlannerSkeleton />}><MobileTourDetailV2 /></Suspense>} />}
              {MobilePlannerResultV2 && <Route path="/preview/mobile-planner" element={<Suspense fallback={<PlannerSkeleton />}><MobilePlannerResultV2 /></Suspense>} />}
              {MobileCharterV2 && <Route path="/preview/mobile-charter" element={<Suspense fallback={<PlannerSkeleton />}><MobileCharterV2 /></Suspense>} />}
              {MobileIconsPreview && <Route path="/preview/icons" element={<Suspense fallback={<PlannerSkeleton />}><MobileIconsPreview /></Suspense>} />}
            </>
          )}
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
            path="/admin/community"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <CommunityModerationPage />
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
            path="/admin/all-bookings"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminAllBookings />
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
            path="/admin/payment-reviews"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminPaymentReviews />
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
            path="/admin/promo-stats"
            element={
              <AdminRoute>
                <Suspense fallback={<PlannerSkeleton />}>
                  <AdminPromoStats />
                </Suspense>
              </AdminRoute>
            }
          />
          <Route
            path="/charter"
            element={
              // 비로그인도 견적(1~5단계)까지 구경 가능 — 광고 트래픽 안 튕김. 로그인은 6단계(견적)
              // 진입 시 CharterWizard 가 요구(리드 캡처), 결제도 백엔드 미로그인 401 로 일관 차단.
              <Suspense fallback={<CharterSkeleton />}>
                <CharterNewPage />
              </Suspense>
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
          {/* 커뮤니티 UI 껍데기 — 실제 DB·번역·신고·moderation 연결은 Claude handoff 범위. */}
          <Route path="/community" element={<Suspense fallback={<PlannerSkeleton />}><CommunityPage /></Suspense>} />
          {/* /community/moderation-preview 공개 데모 라우트 제거(2026-07-12) — 어드민 화면은 /admin/community 게이트 하위만 */}
          <Route path="/community/post/:postId" element={<Suspense fallback={<PlannerSkeleton />}><CommunityPostPage /></Suspense>} />
          <Route path="/community/new" element={<Suspense fallback={<PlannerSkeleton />}><CommunityComposePage /></Suspense>} />
          {/* 여행 가이드 — 색인 대상 (seoRoutes·sitemap·vercel.json 동기, 잠금 테스트가 강제) */}
          <Route path="/guide" element={<Suspense fallback={<PlannerSkeleton />}><GuideIndexPage /></Suspense>} />
          <Route path="/guide/:slug" element={<Suspense fallback={<PlannerSkeleton />}><GuideDetailPage /></Suspense>} />
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
          {/* 코스 빌더 공유 수신 — 공개, 로그인 불필요 (2026-07-04) */}
          <Route
            path="/s/:id"
            element={
              <Suspense fallback={<PlannerSkeleton />}>
                <SharedCoursePage />
              </Suspense>
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
              // MOOD 청크 로딩 중 코코트립(planner) 스켈레톤이 깜빡이던 문제 → MOOD 다크 배경
              // placeholder(MoodPortal 자체 로딩 bg=#0a0412 와 동일)로 교체해 매끄럽게.
              <Suspense fallback={<div className="min-h-screen" style={{ background: '#0a0412' }} aria-hidden />}>
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
    </RouteTransition>
  );
}

function App() {
  // Bug #10: 모든 진입 경로(MOBILE_V2 OFF, 데스크탑, 어드민, 홈 외 라우트 등)에서
  // signalAppReady 가 호출되지 않아 PWA 스플래시가 안전 캡까지 강제 노출되는 문제 수정.
  // App 마운트 = React 첫 페인트 직후이므로 여기서 1회 호출이 모든 경로를 커버.
  // 단 /mood 예외 — MoodPortal 이 인증 완료 후 직접 신호(여기서 먼저 쏘면 스플래시가 일찍 꺼져
  // MOOD 로딩 중 빈 화면 노출, index.html MAX 3.9s 캡이 안전망). 기존 호출은 멱등 가드로 흡수.
  // /mood 예외는 정확 매치(/mood, /mood/*)만 — startsWith('/mood')는 /moodxyz 404까지
  // 오매치되어 NotFound에서 스플래시가 3.9s 캡까지 강제 노출됨.
  useEffect(() => {
    const p = window.location.pathname;
    if (p === '/mood' || p.startsWith('/mood/')) return;
    signalAppReady();
  }, []);

  return (
    <LanguageProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <CommandPaletteProvider>
        <ManifestSwitcher />
        {/* PWA 업데이트 토스트 — 전역(코코트립 + 무드 모두). 새 빌드 배포 시 "새 버전" 알림 → 새로고침. */}
        <Suspense fallback={null}>
          <PWAUpdatePrompt />
        </Suspense>
        <RobotsMeta />
        {/* 🔴 2026-08-05: pageview 계측은 **전역**이다(코코트립 + 무드 모두).
            원래 GlobalWidgets 안에 있었는데, 그 컴포넌트는 `/mood` 에서 마케팅 chrome 을
            숨기려고 통째로 early-return 한다(2026-06-13). 당시엔 posthog-js 가 pageview 를
            자동 수집해서 문제가 없었다. 그런데 2026-07-31 (커밋 55d3f94a, 동의 철회 누수 차단)
            에 `capture_pageview: false` 로 바꿔 **수동 전송**으로 돌리면서, 그 early-return 이
            그대로 계측 차단선이 됐다 — `/mood` 는 PostHog **와 GA4 양쪽 모두** pageview 0건.
            (PageViewTracker 의 useEffect 하나가 둘을 같이 쏜다.)
            실측(`$pathname='/mood'`): 7/31 로드 4회→pageview 4건 / 8/4 로드 6회→**0건**.
            $web_vitals 는 SDK 내부 자동수집이라 계속 나가서 "vitals 만 남는" 모양이 됐다.
            → chrome 숨김과 계측을 분리한다. PageViewTracker 는 null 만 반환하므로
              "무드는 별도 사이트처럼" 이라는 원래 의도는 하나도 안 깨진다. */}
        <PageViewTracker />
        <GlobalWidgets />
        <NonMoodChrome />
        <AnimatedRoutes />
        <MobileBottomSpacer />
        </CommandPaletteProvider>
      </BrowserRouter>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

// 상단 프로모 배너/팝업 — MOOD 포털(/mood)에선 숨김(고객 비노출 내부 사이트).
function NonMoodChrome() {
  const location = useLocation();
  if (location.pathname.startsWith('/mood') || location.pathname.startsWith('/community')) return null;
  return (
    <>
      <PromoBanner />
      <PromoPopup />
    </>
  );
}

export default App;

// 배포 트리거: 할인 v2 env(FEATURE_DISCOUNT_V2) 활성화 fresh 배포 — 운영자 env 적용 2026-06-07

// 배포 트리거 2026-06-12: PRERENDER=1 활성화 (SEO/AEO 무JS 크롤러 빈 본문 fix) — 운영자 Vercel env 적용 fresh 배포
