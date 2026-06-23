// PlannerPage main entry -- assembled from legacy PlannerPage.tsx.
// All components extracted to ./components/, handlers to ./hooks/.
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';
import { notify } from '@/lib/notify';
import { haptic } from '@/lib/haptic';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { WizardForm } from '@/components/WizardForm';
import { AIIntroModal } from '@/components/AIIntroModal';
import { Sparkles, AlertTriangle, MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { PAGE_STYLE } from './constants';
import { usePlannerHandlers } from './hooks/usePlannerHandlers';
import { resolveErrorMessage } from './hooks/errorMessages';
import { TriviaLoadingAnimation } from './components/TriviaLoadingAnimation';
// ItineraryResult is used within PlanDetailPage, not here directly
import { QuickPreviewCard } from './components/QuickPreviewCard';
import { PurchaseSection } from './components/PurchaseSection';

export default function PlannerPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const [searchParams] = useSearchParams();
  // preset reserved for future WizardForm preset routing
  const revisionMode = searchParams.get('revision') === 'true';
  const revisionPlanId = searchParams.get('planId') ?? null;
  const revisionToken = searchParams.get('token') ?? null;
  // W4: 사유 + avoidList URL params (RevisionCard → RevisionReasonModal → here)
  const revisionReason = searchParams.get('revisionReason') ?? null;
  const revisionNote = searchParams.get('revisionNote') ?? null;
  const avoidList = searchParams.get('avoidList') ?? null;

  // 2026-05-09 (B9-37): RevisionCard 가 직렬화한 plan.input 핵심 필드 → WizardForm
  // initialValues 로 전달. 사용자 신고 "다시 만들기 시 form 데이터 prefill 안 됨
  // (비행기/시간/날짜 매번 재입력)" 대응.
  const prefillValues = revisionMode ? {
    startDate: searchParams.get('prefillStartDate') || '',
    endDate: searchParams.get('prefillEndDate') || '',
    regions: (searchParams.get('prefillRegions') || '').split(',').filter(Boolean),
    categories: (searchParams.get('prefillCategories') || '').split(',').filter(Boolean),
    pax: parseInt(searchParams.get('prefillPax') || '0', 10) || undefined,
    arrivalAirport: searchParams.get('prefillArrival') || '',
    hotelAddress: searchParams.get('prefillHotel') || '',
    dietary: (searchParams.get('prefillDiet') || '').split(',').filter(Boolean),
    allergies: (searchParams.get('prefillAllergies') || '').split(',').filter(Boolean),
    freeText: searchParams.get('prefillFreeText') || '',
  } : undefined;

  usePageMeta({
    title: t.pageMeta?.planner?.title ?? 'AI Travel Planner \u2014 Custom Korea Itinerary',
    description: t.pageMeta?.planner?.description ?? 'Create your personalized Korea travel itinerary with AI. Free, instant, multi-language support. Seoul, Busan, Jeju and more.',
    ogImage: '/hero-seoul-real.webp',
  });

  const [userEmail, setUserEmail] = useState<string>('');
  // 2026-05-05: free-claim funnel 제거 — selectedOption / optionBStep 상태 폐기.

  // B-9 (2026-05-12): admin sign-in 후 /planner 진입 시 userEmail 자동 prefill.
  // Test Mode 버튼 UX + ADMIN-BYPASS- flow 안정성 — userEmail input 수동 입력 누락
  // 으로 isSandboxAccount=false 가 되어 버튼이 안 보이는 회귀 방지.
  const { user: authUser } = useAuth();
  useEffect(() => {
    if (authUser?.email && !userEmail) setUserEmail(authUser.email);
  }, [authUser?.email, userEmail]);

  const {
    status, resultQuick, errorMsg, errorCode,
    isGeneratingPlan, planError, planErrorCode, lastValues,
    handleSubmit, handlePaymentSuccess, handleRevisionRegenerate, handleReset,
  } = usePlannerHandlers({ language, userEmail, setUserEmail });

  const localizedError = resolveErrorMessage(errorCode, errorMsg, (p as { errors?: Record<string, string> }).errors);
  const localizedPlanError = planError
    ? resolveErrorMessage(planErrorCode, planError, (p as { errors?: Record<string, string> }).errors)
    : null;

  // Notify-on-ready: fire OS notification + haptic when generation finishes.
  // Track previous status so we only fire once per transition (not on every
  // re-render where status === 'quickSuccess').
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'loadingQuick' && status === 'quickSuccess') {
      haptic('success');
      const notifP = (p as { notifyPlanReadyTitle?: string; notifyPlanReadyBody?: string });
      notify({
        title: notifP.notifyPlanReadyTitle || '여행 일정이 준비됐어요!',
        body: notifP.notifyPlanReadyBody || 'AI가 만든 코스를 확인하세요',
        onlyIfHidden: true,  // skip OS notif when user is already looking
        onClick: () => {
          const el = document.getElementById('planner-quick-result');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      });
    }
    prevStatus.current = status;
  }, [status, p]);

  // 정제 퍼플·핑크 (운영자 2026-06-01 채택). 시각만 — 위저드 로직/payload 무관. OFF=현재 그대로.
  const REFINED = import.meta.env.VITE_FEATURE_REFINED_UI === 'true'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refined'));

  return (
    <div className={`${isMobile ? 'm-page' : 'min-h-screen'} ${REFINED ? 'refined-planner' : ''}`} style={isMobile ? undefined : { background: '#080b14' }}>
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* Hero — mobile py 64px -> 40px, h1 30px -> 24px to surface wizard above the fold */}
      <section className="text-white py-10 sm:py-16 px-4"
        style={{ background: isMobile
          ? 'linear-gradient(160deg, #0a0412 0%, #1a0a2e 60%, #0d0618 100%)'
          : 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="max-w-2xl mx-auto text-center">
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full border text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase mb-3 sm:mb-5 ${
            isMobile
              ? 'border-[#B668FC]/35 bg-[#B668FC]/08 text-[#B668FC]'
              : 'border-[rgba(196,149,106,.35)] bg-[rgba(196,149,106,.08)] text-[#D4A574]'
          }`}
            style={{ animation: 'fade-slide-up 0.5s ease forwards' }}>
            <Sparkles className="w-3 h-3" />{p.badgeLabel}
          </div>
          <h1 className={`text-2xl sm:text-4xl font-bold leading-tight mb-3 sm:mb-4 whitespace-pre-line ${isMobile ? 'm-shimmer-text' : 'text-white'}`}
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.1s', opacity: 0 }}>{p.heroTitle}</h1>
          <p className="text-white/50 text-[13px] sm:text-base whitespace-pre-line"
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.2s', opacity: 0 }}>{p.heroSubtitle}</p>
        </div>
      </section>

      {/* VP strip — "검증된 코스·동선 최적화·AI 환각 방지" 3항목 (Part 1) */}
      <div className={`max-w-3xl mx-auto px-4 ${isMobile ? 'py-3' : 'py-5'}`}>
        <p className={`text-center text-white/60 leading-snug mb-3.5 ${isMobile ? 'text-[11px]' : 'text-[13px]'}`}>
          {(p as unknown as Record<string, string>).vpStripTagline || ''}
        </p>
        {/* B1 (2026-06-23): 3대 차별점 — 핵심 메시지라 글씨/가중치/대비 강화.
            아이콘 칩 + 더 큰 타이틀 + 또렷한 본문. 모바일 1줄 유지 (3열). */}
        <div className={`grid grid-cols-3 ${isMobile ? 'gap-2' : 'gap-3'}`}>
          {([
            { Icon: MapPin,      titleKey: 'vpCourseTitle',      descKey: 'vpCourseDesc' },
            { Icon: Navigation,  titleKey: 'vpRouteTitle',       descKey: 'vpRouteDesc'  },
            { Icon: ShieldCheck, titleKey: 'vpNoHallucinationTitle', descKey: 'vpNoHallucinationDesc' },
          ] as { Icon: React.ComponentType<{ className?: string }>; titleKey: string; descKey: string }[]).map(({ Icon, titleKey, descKey }) => (
            <div key={titleKey} className={`flex flex-col items-center text-center rounded-xl border border-white/[0.10] bg-white/[0.05] ${isMobile ? 'px-2 py-3' : 'px-3 py-4'}`}>
              <span className={`mb-1.5 inline-flex items-center justify-center rounded-full ${isMobile ? 'w-8 h-8' : 'w-9 h-9'} ${isMobile ? 'bg-[#B668FC]/15' : 'bg-[#7C5CFC]/15'}`}>
                <Icon className={`shrink-0 ${isMobile ? 'w-4 h-4' : 'w-5 h-5'} ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />
              </span>
              <p className={`font-bold text-white leading-tight ${isMobile ? 'text-[12px]' : 'text-[15px]'}`}>
                {(p as unknown as Record<string, string>)[titleKey] || ''}
              </p>
              <p className={`text-white/65 leading-snug mt-1 ${isMobile ? 'text-[10px]' : 'text-[12px]'}`}>
                {(p as unknown as Record<string, string>)[descKey] || ''}
              </p>
            </div>
          ))}
        </div>
      </div>

      <main className={`max-w-3xl mx-auto px-4 ${isMobile ? 'py-5 space-y-5' : 'py-12 space-y-8'}`}>
        {/* Wizard form */}
        {(status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <div className={isMobile ? 'm-card m-appear p-4 shadow-2xl' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 sm:p-9 shadow-2xl'}>
            <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} initialValues={prefillValues} />
          </div>
        )}

        {/* Phase 1 Loading — full tips array + 4-step phases (i18n loading_tips/loading_step1~4) */}
        {status === 'loadingQuick' && (
          <div className="mt-8">
            <TriviaLoadingAnimation p={p as unknown as Parameters<typeof TriviaLoadingAnimation>[0]['p']} streamStep={1} />
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center mt-8">
            <p className="text-3xl mb-3"><AlertTriangle className="w-10 h-10 text-red-400 mx-auto" /></p>
            <p className="font-semibold text-red-300 mb-1">{p.errorTitle}</p>
            <p className="text-sm text-red-400/70 mb-5">{localizedError}</p>
            <button onClick={handleReset}
              className="px-6 py-2.5 rounded-xl border border-red-400/40 text-red-300 text-sm font-bold hover:bg-red-500/20 transition-colors">
              {p.retry}
            </button>
          </div>
        )}

        {/* Quick Success */}
        {status === 'quickSuccess' && resultQuick && (
          <div id="planner-quick-result" className="space-y-6">
            <QuickPreviewCard resultQuick={resultQuick} p={p} isMobile={isMobile} />
            <PurchaseSection
              p={p}
              isMobile={isMobile}
              language={language}
              userEmail={userEmail}
              setUserEmail={setUserEmail}
              isGeneratingPlan={isGeneratingPlan}
              planError={localizedPlanError}
              resultQuick={resultQuick}
              lastValues={lastValues}
              revisionMode={revisionMode}
              revisionPlanId={revisionPlanId}
              revisionToken={revisionToken}
              revisionReason={revisionReason}
              revisionNote={revisionNote}
              avoidList={avoidList}
              onPaymentSuccess={handlePaymentSuccess}
              onRevisionRegenerate={handleRevisionRegenerate}
            />
          </div>
        )}
      </main>
      {!isMobile && <Footer t={t} />}
      {/* 첫 진입 시 1회 노출되는 사용 흐름 안내 모달 (localStorage flag) */}
      <AIIntroModal />
    </div>
  );
}
