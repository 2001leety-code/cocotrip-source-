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
import {
  Sparkles, AlertTriangle, MapPin, Navigation, ShieldCheck, ListPlus, Wand2,
} from 'lucide-react';
import { PAGE_STYLE } from './constants';
// Codex 모바일 라이트 히어로 3종 — index 400줄 잠금으로 추출(내용 무변경).
import { CocoIcon, MobilePlannerHero, MobilePlannerPrinciples } from './components/MobilePlannerHero';
import { usePlannerHandlers } from './hooks/usePlannerHandlers';
import { resolveErrorMessage } from './hooks/errorMessages';
import { TriviaLoadingAnimation } from './components/TriviaLoadingAnimation';
import { QuickPreviewCard } from './components/QuickPreviewCard';
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
  // ?mode=course — 공유 코스 수신/'내 코스 열기' 딥링크 (2026-07-04). 초기값만 — 결제 흐름 무접촉.
  const [plannerMode, setPlannerMode] = useState<PlannerMode>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'course' ? 'course' : 'ai');
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
    <div className={`${isMobile ? 'm-page planner-mobile-ai' : 'min-h-screen'} ${REFINED ? 'refined-planner' : ''}`} style={isMobile ? undefined : { background: '#080b14' }}>
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* 2026-08-06: 모바일에서는 히어로를 위저드 **아래**로 내린다 (</main> 뒤 참조).
          6월 광고 유입 109명이 `/planner` 에 도착해 플랜 생성 0, 체류 중앙값 10초로 이탈했다.
          오류는 0건 — 못 쓴 게 아니라 안 썼다. 실측하니 첫 질문이 y=1369px, 화면 844px →
          **1.6 화면 아래**였다. 광고를 눌러 "여행 플래너"를 기대하고 온 사람이 프로모배너·
          히어로·추천카드·쿠키배너를 지나 스크롤해야 첫 질문을 만난다. 10초로는 안 된다.
          컴포넌트는 그대로 두고 **순서만** 바꾼다(Codex 디자인 SSOT, 재설계 아님).
          데스크톱은 화면이 넓어 히어로와 위저드가 같이 보이므로 손대지 않는다. */}
      {isMobile ? null : (
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-5">
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
                <h1 className="text-[34px] font-black leading-[1.05] whitespace-pre-line text-white">
                  {p.heroTitle}
                </h1>
                <p className="text-[14px] text-white/58 leading-relaxed mt-2 whitespace-pre-line">
                  {p.heroSubtitle}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* VP strip — compact trust chips (모바일은 위 주석대로 </main> 뒤로 이동) */}
      {isMobile ? null : <div className="max-w-5xl mx-auto px-4 sm:px-6 mb-5">
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
      </div>}

      <main className={`${isMobile ? 'mx-auto max-w-[430px] px-4 py-3 space-y-4' : 'max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-8'}`}>
        {status === 'idle' && (
          <section
            className={isMobile ? 'planner-mobile-mode-grid' : 'grid gap-2 rounded-[22px] p-2 sm:grid-cols-2'}
            style={isMobile ? undefined : { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {(() => {
              // 모드 선택 문구 4언어 (2026-07-05 — 기존 영어 고정 해소).
              const L = (language === 'ko' || language === 'ja' || language === 'zh') ? language : 'en';
              // 2026-07-17: 모바일 축약 문구(mAiT 등)도 4언어 — 기존엔 모바일만 영어 고정이었음.
              const MODE_TEXT = {
                en: { aiT: 'Let AI plan everything', aiB: 'Answer the survey and get a complete Korea itinerary.', cT: 'Build from my places', cB: 'Add restaurants, addresses, and fixed plans. AI helps beside you.', mAiT: 'AI itinerary', mAiB: 'Fast survey, complete Korea plan.', mCT: 'Build my course', mCB: 'Add places, map pins, and fixed plans.' },
                ko: { aiT: 'AI가 전부 짜드려요', aiB: '설문에 답하면 완성된 한국 일정을 받아요.', cT: '내 장소로 만들기', cB: '맛집·주소·확정 일정을 넣으면 AI가 옆에서 도와줘요.', mAiT: 'AI 일정 만들기', mAiB: '빠른 설문으로 완성 일정 받기.', mCT: '내 코스 만들기', mCB: '장소·지도핀·확정 일정 직접 추가.' },
                ja: { aiT: 'AIがすべて計画', aiB: 'アンケートに答えると完成した韓国旅程が届きます。', cT: '自分の場所で作る', cB: 'グルメ・住所・確定予定を入れるとAIが横でサポート。', mAiT: 'AI旅程を作る', mAiB: '簡単アンケートで完成旅程。', mCT: '自分のコース作成', mCB: '場所・ピン・確定予定を追加。' },
                zh: { aiT: 'AI帮你全部规划', aiB: '回答问卷即可获得完整的韩国行程。', cT: '用我的地点创建', cB: '添加美食·地址·固定安排，AI在旁协助。', mAiT: 'AI行程规划', mAiB: '快速问卷，完整韩国行程。', mCT: '创建我的路线', mCB: '添加地点·地图标记·固定安排。' },
              }[L];
              return [
                { key: 'ai' as PlannerMode, icon: Wand2, title: MODE_TEXT.aiT, body: MODE_TEXT.aiB, mTitle: MODE_TEXT.mAiT, mBody: MODE_TEXT.mAiB },
                { key: 'course' as PlannerMode, icon: ListPlus, title: MODE_TEXT.cT, body: MODE_TEXT.cB, mTitle: MODE_TEXT.mCT, mBody: MODE_TEXT.mCB },
              ];
            })().map(({ key, icon: Icon, title, body, mTitle, mBody }) => {
              const active = plannerMode === key;
              const displayTitle = isMobile ? mTitle : title;
              const displayBody = isMobile ? mBody : body;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlannerMode(key)}
                  className={`${isMobile ? 'planner-mobile-mode-card' : 'flex items-center gap-3 rounded-[18px] p-3 text-left transition-all'} ${active ? 'is-active' : ''}`}
                  style={isMobile ? undefined : active
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
                  {isMobile ? <CocoIcon icon={Icon} active={active} /> : (
                    <span
                      className="grid h-10 w-10 place-items-center rounded-2xl shrink-0"
                      style={{ background: active ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'rgba(255,255,255,0.06)' }}
                    >
                      <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-white/55'}`} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className={isMobile ? 'block text-[13px] font-black text-[#15143d]' : 'block text-[13px] font-black text-white'}>{displayTitle}</span>
                    <span className={isMobile ? 'mt-0.5 block text-[11px] font-semibold leading-relaxed text-[#7b719f]' : 'mt-0.5 block text-[11px] leading-relaxed text-white/45'}>{displayBody}</span>
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {/* 🔴 2026-07-30: 가격을 여기서 **처음** 밝힌다.
            그동안 이 화면에는 금액이 한 글자도 없었고, 상단 배너만 "무료" 를 크게 말했다.
            손님은 전부 공짜인 줄 알고 들어왔다가 결제 단계에서 처음 $9.90 을 만난다.
            무료로 주는 것(미리보기·가입 쿠폰)과 파는 것(전체 일정)을 갈라서 먼저 적는다. */}
        {plannerMode === 'ai' && (status === 'idle' || status === 'error') && (
          <AiPlannerPricingNote language={language} />
        )}

        {/* Wizard form */}
        {plannerMode === 'ai' && (status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <WizardSeenProbe className={isMobile ? 'planner-mobile-form m-card m-appear p-3.5 shadow-2xl' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-[22px] p-5 sm:p-6 shadow-2xl'}>
            <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} initialValues={prefillValues} />
          </WizardSeenProbe>
        )}

        {plannerMode === 'course' && status === 'idle' && (
          <div className={isMobile ? 'planner-mobile-course-shell' : undefined}>
            <CourseBuilderShell />
          </div>
        )}

        {/* 2026-08-06: 크롤러가 보는 정적 본문. 위저드는 상호작용이라 프리렌더에 1단계 껍데기만
            남았고, `<main>` 본문이 939자여서 구글이 크롤하고도 색인을 거부했다
            (`Crawled – currently not indexed`). /charter 가 7/30 에 같은 문제를 같은 방식으로
            해결했다 — 그때 형제인 여기에는 적용하지 않은 것을 채운다.
            결과 화면(quickSuccess)·로딩 중에는 숨긴다. 손님이 일정을 보는 중에 안내문이
            끼어들 이유가 없고, 크롤러는 어차피 idle 상태의 HTML 만 받는다. */}
        {(status === 'idle' || status === 'error') && (
          <PlannerSeoInfo language={language} t={t} />
        )}

        {/* Phase 1 Loading — full tips array + 4-step phases (i18n loading_tips/loading_step1~4) */}
        {status === 'loadingQuick' && (
          <div className="mt-8">
            <TriviaLoadingAnimation p={p as unknown as Parameters<typeof TriviaLoadingAnimation>[0]['p']} streamStep={1} />
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mt-4 sm:rounded-2xl sm:p-8 sm:mt-8 text-center">
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
          <div id="planner-quick-result" className={isMobile ? 'planner-mobile-result space-y-4' : 'space-y-6'}>
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

      {/* 모바일 한정: 위저드를 첫 화면에 두려고 히어로·원칙 스트립을 여기로 내렸다(위 주석).
          내용·디자인은 그대로이고 위치만 바뀐다. 위저드를 이미 지나온 손님에게는
          둘러볼 거리로 남는다. */}
      {isMobile && (
        <>
          <MobilePlannerHero language={language} onLanguageChange={changeLanguage} />
          <MobilePlannerPrinciples />
        </>
      )}

      {!isMobile && <Footer t={t} />}
      {/* 첫 진입 시 1회 노출되는 사용 흐름 안내 모달 (localStorage flag) */}
      <AIIntroModal />
    </div>
  );
}
