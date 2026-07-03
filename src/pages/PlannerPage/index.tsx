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
import { Sparkles, AlertTriangle, MapPin, Navigation, ShieldCheck, ListPlus, Wand2 } from 'lucide-react';
import { PAGE_STYLE } from './constants';
import { usePlannerHandlers } from './hooks/usePlannerHandlers';
import { resolveErrorMessage } from './hooks/errorMessages';
import { TriviaLoadingAnimation } from './components/TriviaLoadingAnimation';
// ItineraryResult is used within PlanDetailPage, not here directly
import { QuickPreviewCard } from './components/QuickPreviewCard';
import { PurchaseSection } from './components/PurchaseSection';
import { CourseBuilderShell } from './components/CourseBuilderShell';

type PlannerMode = 'ai' | 'course';

export default function PlannerPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const [plannerMode, setPlannerMode] = useState<PlannerMode>('ai');
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

      <section className={`max-w-5xl mx-auto px-4 sm:px-6 ${isMobile ? 'pt-3 pb-3' : 'pt-10 pb-5'}`}>
        <div
          className="rounded-[22px] px-4 py-4 sm:px-6 sm:py-6"
          style={{
            background: 'linear-gradient(135deg, rgba(18,45,88,0.92), rgba(26,12,43,0.88))',
            border: '1px solid rgba(118,83,194,0.24)',
            boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-200/75 leading-none mb-1">
                {p.badgeLabel}
              </p>
              <h1 className={`text-[24px] sm:text-[34px] font-black leading-[1.05] whitespace-pre-line ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>
                {p.heroTitle}
              </h1>
              <p className="text-[12px] sm:text-[14px] text-white/58 leading-relaxed mt-2 whitespace-pre-line">
                {p.heroSubtitle}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* VP strip — compact trust chips */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mb-3 sm:mb-5">
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {([
            { Icon: MapPin,      titleKey: 'vpCourseTitle',      descKey: 'vpCourseDesc' },
            { Icon: Navigation,  titleKey: 'vpRouteTitle',       descKey: 'vpRouteDesc'  },
            { Icon: ShieldCheck, titleKey: 'vpNoHallucinationTitle', descKey: 'vpNoHallucinationDesc' },
          ] as { Icon: React.ComponentType<{ className?: string }>; titleKey: string; descKey: string }[]).map(({ Icon, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="shrink-0 flex items-center gap-2 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl"
              style={{
                background: 'rgba(182,104,252,0.07)',
                border: '1px solid rgba(182,104,252,0.18)',
              }}
            >
              <Icon className="w-4 h-4 shrink-0 text-[#B668FC]" />
              <div>
                <p className="text-[11px] font-black text-white leading-none">
                  {(p as unknown as Record<string, string>)[titleKey] || ''}
                </p>
                <p className="text-[10px] text-white/45 mt-0.5 leading-none">
                  {(p as unknown as Record<string, string>)[descKey] || ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <main className={`max-w-5xl mx-auto px-4 sm:px-6 ${isMobile ? 'py-2 space-y-5' : 'py-5 space-y-8'}`}>
        {status === 'idle' && (
          <section
            className="grid gap-2 rounded-[22px] p-2 sm:grid-cols-2"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {([
              {
                key: 'ai' as PlannerMode,
                icon: Wand2,
                title: 'Let AI plan everything',
                body: 'Answer the survey and get a complete Korea itinerary.',
              },
              {
                key: 'course' as PlannerMode,
                icon: ListPlus,
                title: 'Build from my places',
                body: 'Add restaurants, addresses, and fixed plans. AI helps beside you.',
              },
            ]).map(({ key, icon: Icon, title, body }) => {
              const active = plannerMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlannerMode(key)}
                  className="flex items-center gap-3 rounded-[18px] p-3 text-left transition-all"
                  style={active
                    ? {
                        background: 'linear-gradient(135deg, rgba(182,104,252,0.18), rgba(255,107,157,0.10))',
                        border: '1px solid rgba(182,104,252,0.42)',
                        boxShadow: '0 0 18px rgba(182,104,252,0.12)',
                      }
                    : {
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}
                >
                  <span
                    className="grid h-10 w-10 place-items-center rounded-2xl shrink-0"
                    style={{ background: active ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'rgba(255,255,255,0.06)' }}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-white/55'}`} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-black text-white">{title}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">{body}</span>
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {/* Wizard form */}
        {plannerMode === 'ai' && (status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <div className={isMobile ? 'm-card m-appear p-3.5 shadow-2xl' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-[22px] p-5 sm:p-6 shadow-2xl'}>
            <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} initialValues={prefillValues} />
          </div>
        )}

        {plannerMode === 'course' && status === 'idle' && (
          <CourseBuilderShell />
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
