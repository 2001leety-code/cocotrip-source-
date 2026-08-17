// PlannerPage main entry -- assembled from legacy PlannerPage.tsx.
// All components extracted to ./components/, handlers to ./hooks/.
//
// 2026-08-10 (phase 2, Korea Editorial Concierge): the body was a dark canvas
// (`#080b14`) that a `.planner-mobile-ai` cascade in index.css repainted back to
// light on phones with ~90 lines of `!important`. Both are gone: the page now
// renders on the shared editorial ground (`ec-root`), so mobile and desktop are
// one system instead of two that argue. Copy leads with what the traveller gets
// — dates, cities, pace and diet become an executable Korea itinerary — and the
// model that writes it stays in technical context. Routing, payload, analytics
// and the payment flow are untouched.
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
import { filterSupportedRegions } from '@/components/WizardForm/cityKeys';
import { AIIntroModal } from '@/components/AIIntroModal';
import '@/styles/editorial-planner.css';
import { PAGE_STYLE } from './constants';
import { pickPlannerCopy } from './plannerCopy';
import { focusAndReveal } from '@/lib/motion';
import { PlannerMasthead, PlannerEvidence } from './components/PlannerMasthead';
import { usePlannerHandlers } from './hooks/usePlannerHandlers';
import { resolveErrorMessage } from './hooks/errorMessages';
import { TriviaLoadingAnimation } from './components/TriviaLoadingAnimation';
import { QuickPreviewCard } from './components/QuickPreviewCard';
import { PlannerErrorPanel } from './components/PlannerErrorPanel';
import { PurchaseSection } from './components/PurchaseSection';
import { CourseBuilderShell } from './components/CourseBuilderShell';
import { AiPlannerPricingNote } from './components/AiPlannerPricingNote';
import { PlannerSeoInfo } from './components/PlannerSeoInfo';
import { WizardSeenProbe } from './components/WizardSeenProbe';

type PlannerMode = 'ai' | 'course';

export default function PlannerPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const c = pickPlannerCopy(language);
  // ?mode=course — 공유 코스 수신/'내 코스 열기' 딥링크 (2026-07-04). 초기값만 — 결제 흐름 무접촉.
  const [plannerMode, setPlannerMode] = useState<PlannerMode>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'course' ? 'course' : 'ai');
  const [searchParams] = useSearchParams();
  // preset reserved for future WizardForm preset routing
  const revisionMode = searchParams.get('revision') === 'true';
  const revisionPlanId = searchParams.get('planId') || null;
  const revisionToken = searchParams.get('token') || null;
  // W4: 사유 + avoidList URL params (RevisionCard → RevisionReasonModal → here)
  const revisionReason = searchParams.get('revisionReason') || null;
  const revisionNote = searchParams.get('revisionNote') || null;
  const avoidList = searchParams.get('avoidList') || null;

  // 2026-05-09 (B9-37): RevisionCard 가 직렬화한 plan.input 핵심 필드 → WizardForm
  // initialValues 로 전달. 사용자 신고 "다시 만들기 시 form 데이터 prefill 안 됨
  // (비행기/시간/날짜 매번 재입력)" 대응.
  // 2026-08-10: the home destination rail links to `/planner?prefillRegions=<key>`
  // with no `revision=true`. Before this, that whole object was gated behind
  // revisionMode, so the deep link parsed to nothing and the chip dropped the
  // traveller on an empty city step — the one thing they had already answered.
  // Outside revision we honour only `prefillRegions`; every other prefill param
  // still belongs exclusively to the revision flow.
  //
  // Two readings of the same parameter, because the two callers are not the same
  // kind of link. RevisionCard serialises the traveller's own saved
  // `plan.input.regions`, which legitimately holds a localized city name or a
  // free-text city the chip set never had — WizardForm matches key, then
  // localized name, then falls back to showing the string as typed. Filtering
  // there would delete the city from "다시 만들기". The home rail's link, by
  // contrast, is a public URL anyone can author, and an unknown value used to
  // reach `initialValues` untouched and be rendered as the destination.
  const revisionRegions = (searchParams.get('prefillRegions') || '').split(',').filter(Boolean);
  const deepLinkRegions = filterSupportedRegions(searchParams.get('prefillRegions'));
  const prefillValues = revisionMode ? {
    startDate: searchParams.get('prefillStartDate') || '',
    endDate: searchParams.get('prefillEndDate') || '',
    regions: revisionRegions,
    categories: (searchParams.get('prefillCategories') || '').split(',').filter(Boolean),
    pax: parseInt(searchParams.get('prefillPax') || '0', 10) || undefined,
    arrivalAirport: searchParams.get('prefillArrival') || '',
    hotelAddress: searchParams.get('prefillHotel') || '',
    dietary: (searchParams.get('prefillDiet') || '').split(',').filter(Boolean),
    allergies: (searchParams.get('prefillAllergies') || '').split(',').filter(Boolean),
    freeText: searchParams.get('prefillFreeText') || '',
  } : (deepLinkRegions.length ? { regions: deepLinkRegions } : undefined);

  usePageMeta({
    // SEO metadata keeps the search term people actually type — it lives in the
    // four locale files (`pageMeta.planner`), which every locale defines, so the
    // literal below is an unreachable guard rather than a second copy of the copy.
    title: t.pageMeta?.planner?.title || 'Korea Trip Planner — Custom Itinerary',
    description: t.pageMeta?.planner?.description || 'Build a day-by-day Korea itinerary from your dates, cities, pace and dietary rules. Seoul, Busan, Jeju and more.',
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

  // The mobile bottom nav steps aside so the wizard owns the bottom of the
  // screen (index.css keys the rule off this class on <html>).
  useEffect(() => {
    if (!isMobile || typeof document === 'undefined') return;
    document.documentElement.classList.add('planner-mobile-active');
    return () => {
      document.documentElement.classList.remove('planner-mobile-active');
    };
  }, [isMobile]);

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
  //
  // 2026-08-10: the fallbacks used to be Korean string literals, so an English,
  // Japanese or Chinese reader whose locale file was missing the key got a
  // Korean notification. They now come from the four-language planner copy.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'loadingQuick' && status === 'quickSuccess') {
      haptic('success');
      const notifP = (p as { notifyPlanReadyTitle?: string; notifyPlanReadyBody?: string });
      notify({
        title: notifP.notifyPlanReadyTitle || c.ready.notifyTitle,
        body: notifP.notifyPlanReadyBody || c.ready.notifyBody,
        onlyIfHidden: true,  // skip OS notif when user is already looking
        onClick: () => {
          const el = document.getElementById('planner-quick-result');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      });
    }
    prevStatus.current = status;
  }, [status, p, c]);

  // Retry puts the traveller back on the brief they already filled in.
  //
  // The wizard is mounted for `idle`, `error` and `loadingQuick` alike, so it
  // never unmounts across a failure: every answer survives, and so does the
  // step, which stays on the final review. What broke the return trip was
  // `handleReset` ending in `window.scrollTo({ top: 0 })` — the answers were
  // still there, a screen and a half above where the traveller was looking.
  // The scroll now belongs to the page, which knows where the brief is.
  const wizardRef = useRef<HTMLDivElement | null>(null);
  const returningToBrief = useRef(false);

  function handleRetry() {
    returningToBrief.current = true;
    handleReset();
  }

  useEffect(() => {
    if (status !== 'idle' || !returningToBrief.current) return;
    returningToBrief.current = false;
    // After the effect, not inside the click: leaving `error` brings the mode
    // cards back above the wizard, so its position is only settled once the
    // idle render has committed.
    focusAndReveal(wizardRef.current);
  }, [status]);

  const MODES: { key: PlannerMode; kicker: string; title: string; body: string }[] = [
    { key: 'ai', ...c.modes.guided },
    { key: 'course', ...c.modes.builder },
  ];

  return (
    <div className="ec-root ec-planner">
      {/* PayPalBookingButton's success overlay is the last consumer of these
          keyframes and they are defined nowhere else. */}
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <PlannerMasthead copy={c} isMobile={isMobile} />

      <main className={isMobile ? 'px-4 pb-6 space-y-5' : 'ec-container-wide pb-10 space-y-8'}>
        <hr className="ec-rule-strong" />

        {/* Mode choice. On a phone the two options are a compact pair and only
            the chosen one explains itself underneath — full cards pushed the
            wizard's first question to y=901 on a 390×844 screen, and the one
            thing this page has already been burned by (2026-08-06) is the first
            question sitting below the fold. Desktop has the room, so it keeps
            the full cards. */}
        <div className="grid gap-4 lg:grid-cols-12 lg:gap-8">
        {status === 'idle' && (
          <section aria-labelledby="planner-mode-heading" className="lg:col-span-7">
            <h2 id="planner-mode-heading" className="ec-eyebrow">{c.modes.heading}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:gap-3">
              {MODES.map(({ key, kicker, title, body }) => {
                const active = plannerMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPlannerMode(key)}
                    className={`ec-option ${active ? 'is-selected' : ''}`}
                  >
                    <span className="ec-eyebrow block">{kicker}</span>
                    <span className="ec-question mt-1 block sm:mt-1.5">{title}</span>
                    <span className="ec-body-sm mt-1 hidden text-ec-ink-3 sm:block">{body}</span>
                  </button>
                );
              })}
            </div>
            <p className="ec-help mt-2 sm:hidden">
              {plannerMode === 'ai' ? c.modes.guided.body : c.modes.builder.body}
            </p>
          </section>
        )}

        {/* 🔴 2026-07-30: 가격을 여기서 **처음** 밝힌다.
            그동안 이 화면에는 금액이 한 글자도 없었고, 상단 배너만 "무료" 를 크게 말했다.
            손님은 전부 공짜인 줄 알고 들어왔다가 결제 단계에서 처음 $9.90 을 만난다.
            무료로 주는 것(미리보기·가입 쿠폰)과 파는 것(전체 일정)을 갈라서 먼저 적는다.
            2026-08-10: 데스크톱에서 모드 선택 **옆** 칸으로 옮겼다. 세로로 쌓으면 위저드
            첫 질문이 1280×720 화면 밖(y=823)으로 밀린다 — 고지 위치는 그대로 "설문 전"
            이면서 첫 화면 안에 들어온다. 모바일은 폭이 없으니 그대로 아래에 쌓인다. */}
        {plannerMode === 'ai' && (status === 'idle' || status === 'error') && (
          <div className={status === 'idle' ? 'lg:col-span-5' : 'lg:col-span-12'}>
            <AiPlannerPricingNote language={language} />
          </div>
        )}
        </div>

        {/* Wizard form. The wrapper is the retry target — `WizardSeenProbe`
            already owns its own ref for the visibility probe. */}
        {plannerMode === 'ai' && (status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <div ref={wizardRef} tabIndex={-1} className="scroll-mt-20">
            <WizardSeenProbe className="ec-panel">
              <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} initialValues={prefillValues} />
            </WizardSeenProbe>
          </div>
        )}

        {/* Error — the shared editorial state. It announces itself (assertive
            live region), says what to do next, and says that nothing was
            charged, which is the question people actually have here.

            2026-08-10 follow-up: it used to render after `PlannerSeoInfo`, which
            put it below ~700px of SEO copy — measured at y=2752 on a 1280×720
            screen whose reader was at scrollY 1180, and y=2682 at 390×844 with
            scrollY 1884. It belongs where the traveller already is, next to the
            brief that failed, and it takes focus on arrival. */}
        {status === 'error' && (
          <PlannerErrorPanel
            title={p.errorTitle}
            body={[localizedError, c.error.retryHint].filter(Boolean).join(' ')}
            retryLabel={p.retry}
            onRetry={handleRetry}
          />
        )}

        {plannerMode === 'course' && status === 'idle' && <CourseBuilderShell />}

        {/* 2026-08-06: 크롤러가 보는 정적 본문. 위저드는 상호작용이라 프리렌더에 1단계 껍데기만
            남았고, `<main>` 본문이 939자여서 구글이 크롤하고도 색인을 거부했다
            (`Crawled – currently not indexed`). /charter 가 7/30 에 같은 문제를 같은 방식으로
            해결했다 — 그때 형제인 여기에는 적용하지 않은 것을 채운다.
            결과 화면(quickSuccess)·로딩 중에는 숨긴다. 손님이 일정을 보는 중에 안내문이
            끼어들 이유가 없고, 크롤러는 어차피 idle 상태의 HTML 만 받는다. */}
        {(status === 'idle' || status === 'error') && (
          <PlannerSeoInfo language={language} t={t} />
        )}

        {/* Phase 1 loading — the free quick preview. `preview` drops the paid
            pipeline's ETA, phase checklist and agent counter: this call is one
            request that returns day one, and it is not emailed anywhere. */}
        {status === 'loadingQuick' && (
          <TriviaLoadingAnimation
            p={p as unknown as Parameters<typeof TriviaLoadingAnimation>[0]['p']}
            preview
            lang={language}
          />
        )}

        {/* Quick Success */}
        {status === 'quickSuccess' && resultQuick && (
          <div id="planner-quick-result" className="space-y-6">
            <QuickPreviewCard resultQuick={resultQuick} p={p} language={language} />
            <PurchaseSection
              p={p}
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

      {/* The evidence ledger sits after the brief on purpose. On a phone the
          first question has to be the first thing (2026-08-06: it was 1.6
          screens down and the June ad cohort left at a median of ten seconds);
          on desktop the masthead has already made the claim and this is where
          someone who wants the receipts comes to find them. */}
      <PlannerEvidence copy={c} isMobile={isMobile} />

      {!isMobile && <Footer t={t} />}
      {/* 첫 진입 시 1회 노출되는 사용 흐름 안내 모달 (localStorage flag) */}
      <AIIntroModal />
    </div>
  );
}
