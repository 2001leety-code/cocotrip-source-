// PlannerPage main entry -- assembled from legacy PlannerPage.tsx.
// All components extracted to ./components/, handlers to ./hooks/.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { WizardForm } from '@/components/WizardForm';
import { Sparkles, AlertTriangle } from 'lucide-react';
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

  usePageMeta({
    title: 'AI Travel Planner \u2014 Custom Korea Itinerary',
    description: 'Create your personalized Korea travel itinerary with AI. Free, instant, multi-language support. Seoul, Busan, Jeju and more.',
    ogImage: '/hero-seoul-real.webp',
  });

  const [userEmail, setUserEmail] = useState<string>('');
  const [selectedOption, setSelectedOption] = useState<'A' | 'B'>('A');
  const [optionBStep, setOptionBStep] = useState<1 | 2 | 3>(1);

  const {
    status, resultQuick, errorMsg, errorCode,
    isGeneratingPlan, planError, planErrorCode, lastValues,
    handleSubmit, handlePaymentSuccess, handleRevisionRegenerate, handleReset,
  } = usePlannerHandlers({ language, userEmail, setUserEmail });

  const localizedError = resolveErrorMessage(errorCode, errorMsg, (p as { errors?: Record<string, string> }).errors);
  const localizedPlanError = planError
    ? resolveErrorMessage(planErrorCode, planError, (p as { errors?: Record<string, string> }).errors)
    : null;

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen'} style={isMobile ? undefined : { background: '#080b14' }}>
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

      <main className={`max-w-3xl mx-auto px-4 ${isMobile ? 'py-5 space-y-5' : 'py-12 space-y-8'}`}>
        {/* Wizard form */}
        {(status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <div className={isMobile ? 'm-card m-appear p-4 shadow-2xl' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 sm:p-9 shadow-2xl'}>
            <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} />
          </div>
        )}

        {/* Phase 1 Loading */}
        {status === 'loadingQuick' && (
          <div className="mt-8">
            <TriviaLoadingAnimation p={{ loading_tips: [p.loadingAnalyzing], loading_step1: p.loadingDay1Extract } as any} streamStep={1} />
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
              selectedOption={selectedOption}
              setSelectedOption={setSelectedOption}
              optionBStep={optionBStep}
              setOptionBStep={setOptionBStep}
              isGeneratingPlan={isGeneratingPlan}
              planError={localizedPlanError}
              resultQuick={resultQuick}
              lastValues={lastValues}
              revisionMode={revisionMode}
              revisionPlanId={revisionPlanId}
              revisionToken={revisionToken}
              onPaymentSuccess={handlePaymentSuccess}
              onRevisionRegenerate={handleRevisionRegenerate}
            />
          </div>
        )}
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
