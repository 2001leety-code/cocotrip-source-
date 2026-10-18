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
import { WizardForm, type WizardInitialValues } from '@/components/WizardForm';
import { filterSupportedRegions } from '@/components/WizardForm/cityKeys';
import { AIIntroModal } from '@/components/AIIntroModal';
// Home's stylesheet carries the shared chrome, title serif, ticket and CTA that
// /planner reuses — imported here so a direct /planner visit has them too.
import '@/styles/home-dope.css';
import '@/styles/editorial-planner.css';
import { PAGE_STYLE } from './constants';
import { pickPlannerCopy } from './plannerCopy';
import { focusAndReveal } from '@/lib/motion';
import { PlannerMasthead, PlannerBriefNotes, PlannerEvidence } from './components/PlannerMasthead';
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
import { readPlannerRevisionSnapshot, clearPlannerRevisionSnapshot } from './lib/plannerRevisionSnapshot';

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
  // Revision bypass safety: both flag AND planId required to enter revision flow
  const validRevisionContext = revisionMode && !!revisionPlanId;
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

  // 2026-08-24 (planner-intent-v1 §3): the versioned snapshot RevisionCard
  // wrote (bound to THIS planId — readPlannerRevisionSnapshot returns null
  // for any mismatch) carries the full safe brief; the URL prefill* params
  // above are read only as a fallback for an old shared link that predates
  // the snapshot or landed after private-mode/sessionStorage blocked it.
  const revisionSnapshot = validRevisionContext
    ? readPlannerRevisionSnapshot(revisionPlanId || '')
    : null;
  // Read once: consumed into `prefillValues` below on this render, then
  // cleared so a later revision on a DIFFERENT plan never sees it again.
  useEffect(() => {
    if (revisionSnapshot) clearPlannerRevisionSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!revisionSnapshot]);

  const snapshotValues = revisionSnapshot?.values;
  const prefillValues: WizardInitialValues | undefined = validRevisionContext ? {
    startDate: snapshotValues?.startDate || searchParams.get('prefillStartDate') || '',
    endDate: snapshotValues?.endDate || searchParams.get('prefillEndDate') || '',
    regions: snapshotValues?.regions || revisionRegions,
    categories: snapshotValues?.categories || (searchParams.get('prefillCategories') || '').split(',').filter(Boolean),
    pax: snapshotValues?.pax || parseInt(searchParams.get('prefillPax') || '0', 10) || undefined,
    arrivalAirport: snapshotValues?.arrival_airport || searchParams.get('prefillArrival') || '',
    hotelAddress: snapshotValues?.hotel_address || searchParams.get('prefillHotel') || '',
    dietary: snapshotValues?.dietPrefs || (searchParams.get('prefillDiet') || '').split(',').filter(Boolean),
    dietaryRestrictions: snapshotValues?.dietaryRestrictions
      || (searchParams.get('prefillDietaryRestrictions') || '').split(',').filter(Boolean),
    freeText: snapshotValues?.freeText || searchParams.get('prefillFreeText') || '',
    // The fields below have no legacy URL-param equivalent — snapshot-only.
    departureAirport: snapshotValues?.departure_airport,
    arrivalTime: snapshotValues?.arrival_time,
    departureTime: snapshotValues?.departure_time,
    tourStartTime: snapshotValues?.tour_start_time,
    tourEndTime: snapshotValues?.tour_end_time,
    hotelByCity: snapshotValues?.hotelByCity,
    recommendedZone: snapshotValues?.recommended_zone,
    recommendedZones: snapshotValues?.recommended_zones,
    arrivalCityKey: snapshotValues?.arrival_city || snapshotValues?.entry_city,
    departureCityKey: snapshotValues?.departure_city,
    reservationStatus: snapshotValues?.reservation_status,
    tourPace: snapshotValues?.tourPace as WizardInitialValues['tourPace'],
    companions: snapshotValues?.companions as WizardInitialValues['companions'],
    luggage: snapshotValues?.luggage,
    wantAccom: snapshotValues?.wantAccom,
    accomBudget: snapshotValues?.accomBudget,
  } : (deepLinkRegions.length ? { regions: deepLinkRegions } : undefined);

  usePageMeta({
    // SEO metadata keeps the search term people actually type — it lives in the
    // four locale files (`pageMeta.planner`), which every locale defines, so the
    // literal below is an unreachable guard rather than a second copy of the copy.
    title: t.pageMeta?.planner?.title || 'Korea Trip Planner — Custom Itinerary',
    description: t.pageMeta?.planner?.description || 'Build a day-by-day Korea itinerary from your dates, cities, pace and dietary rules. Seoul, Busan, Jeju and more.',
    ogImage: '/hero-seoul-real.webp',
  });

  // 2026-05-05: free-claim funnel 제거 — selectedOption / optionBStep 상태 폐기.

  // B-9 (2026-05-12): admin sign-in 후 /planner 진입 시 userEmail 자동 prefill.
  // Test Mode 버튼 UX + ADMIN-BYPASS- flow 안정성 — userEmail input 수동 입력 누락
  // 으로 isSandboxAccount=false 가 되어 버튼이 안 보이는 회귀 방지.
  const { user: authUser } = useAuth();
  const authEmail = authUser?.email || '';
  const [userEmail, setUserEmail] = useState<string>(() => authEmail);
  // 사용자가 직접 수정한 이메일은 그대로 두고, 비어 있을 때만 새 로그인 이메일을 prefill한다.
  if (authEmail && !userEmail) setUserEmail(authEmail);

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
    handleSubmit, handleRevisionSubmit, handlePaymentSuccess, handleRevisionRegenerate, handleReset,
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
  const activeMode = MODES.find((m) => m.key === plannerMode) || MODES[0];

  // Mobile destination step only: the wizard hosts this one note inside its ticket (before
  // the navigation) and reports it here, so the stage stops rendering its own — one instance,
  // never two. Other steps and desktop keep the prior placement at the top of the stage.
  const [pricingHosted, setPricingHosted] = useState(false);
  const pricingNote = <AiPlannerPricingNote language={language} />;

  // 2026-10-07 (compact workspace): presentation only. While the guided brief
  // is on screen, desktop splits into a rail (headline + mode) and a stage
  // (price note, then the current question). Everything else — the course
  // builder, the result, the loading screen — gets the full width. The flag
  // only changes class names; the element tree is identical either way, so
  // the wizard keeps its one instance across idle / error / loadingQuick.
  const splitWorkspace = plannerMode === 'ai'
    && (status === 'idle' || status === 'error' || status === 'loadingQuick');

  return (
    <div className="ec-root ec-planner">
      {/* PayPalBookingButton's success overlay is the last consumer of these
          keyframes and they are defined nowhere else. */}
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main className={`planner-main ${isMobile ? 'px-4 pb-6' : 'ec-container-wide pb-10'}`}>
        <div className={`planner-workspace ${splitWorkspace ? 'is-split' : ''}`}>
          <div className="planner-rail">
            <PlannerMasthead copy={c} />

            {/* Mode choice — two one-line buttons. The long description of the
                chosen mode sits in a native disclosure below the form (with the
                other supporting notes) and still describes the pressed button;
                full cards pushed the first question to y=901 on a 390×844
                screen (2026-08-06), and on this page nothing outranks the first
                question. */}
            {status === 'idle' && (
              <section aria-labelledby="planner-mode-heading" className="planner-modes">
                <h2 id="planner-mode-heading" className="ec-eyebrow">{c.modes.heading}</h2>
                <div className="planner-mode-row">
                  {MODES.map(({ key, title }) => {
                    const active = plannerMode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        aria-describedby={active ? 'planner-mode-desc' : undefined}
                        onClick={() => setPlannerMode(key)}
                        className={`planner-mode-btn ${active ? 'is-selected' : ''}`}
                      >
                        {title}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="planner-stage">
            {/* 🔴 2026-07-30: 가격을 여기서 **처음** 밝힌다.
                그동안 이 화면에는 금액이 한 글자도 없었고, 상단 배너만 "무료" 를 크게 말했다.
                손님은 전부 공짜인 줄 알고 들어왔다가 결제 단계에서 처음 $9.90 을 만난다.
                무료로 주는 것(미리보기·가입 쿠폰)과 파는 것(전체 일정)을 갈라서 먼저 적는다.
                2026-10-07: 오른쪽 스테이지의 맨 위, 위저드 바로 앞. DOM 에서도 화면에서도
                설문보다 먼저 오고, 접히거나 숨지 않는다. */}
            {plannerMode === 'ai' && (status === 'idle' || status === 'error') && !pricingHosted && (
              <div className="planner-price">
                {pricingNote}
              </div>
            )}

            {/* Wizard form. The wrapper is the retry target — `WizardSeenProbe`
                already owns its own ref for the visibility probe. */}
            {plannerMode === 'ai' && (status === 'idle' || status === 'error' || status === 'loadingQuick') && (
              <div ref={wizardRef} tabIndex={-1} className="scroll-mt-20">
                <WizardSeenProbe className="ec-panel planner-question">
                  <WizardForm
                    onSubmit={validRevisionContext ? handleRevisionSubmit : handleSubmit}
                    isLoading={status === 'loadingQuick'}
                    initialValues={prefillValues}
                    isRevision={validRevisionContext}
                    pricingNote={pricingNote}
                    onPricingNoteHosted={setPricingHosted}
                  />
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
          </div>
        </div>

        {/* The five inputs and the long-form description, collapsed, after the
            brief — they used to stand above it as five paragraphs. The mode
            description leads them; the closed <details> keeps its text in the
            DOM, so `aria-describedby` on the pressed mode button still resolves. */}
        {status === 'idle' && (
          <details className="planner-mode-more">
            <summary>{activeMode.kicker}</summary>
            <p id="planner-mode-desc" className="ec-body-sm text-ec-ink-3">{activeMode.body}</p>
          </details>
        )}
        {(status === 'idle' || status === 'error') && <PlannerBriefNotes copy={c} />}

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
            {/* 2026-08-24 (planner-trust-course, revision entitlement): a revision
                submit never calls /api/ai-planner-quick (see handleRevisionSubmit) —
                resultQuick is a non-displayed placeholder, not a real preview, so
                the card that would render it stays hidden. */}
            {!validRevisionContext && <QuickPreviewCard resultQuick={resultQuick} p={p} language={language} />}
            <PurchaseSection
              p={p}
              language={language}
              userEmail={userEmail}
              setUserEmail={setUserEmail}
              isGeneratingPlan={isGeneratingPlan}
              planError={localizedPlanError}
              resultQuick={resultQuick}
              lastValues={lastValues}
              revisionMode={validRevisionContext}
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
