// PlanDetailPage container: Firestore listener + swipe carousel + edit mode.
// Split from src/pages/PlanDetailPage.tsx (1144L) during P2 Lock release.
// LOCKED regions moved out:
//   - auto-translate useEffect  -> ./useAutoTranslate.ts
//   - handleDownloadPDF body    -> ./pdfGenerator.ts
// PDF button keeps `disabled={isPdfGenerating || isTranslating}` exactly as before.
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { clearPlannerWizardSnapshot } from '@/hooks/useWizardPersistence';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { Flag, RefreshCw } from 'lucide-react';

// P225: streaming hang timeout (default 5분). Vercel maxDuration=300s 기준.
// ENV로 오버라이드 가능하지만 빌드타임 상수이므로 기본값 안전 default 보장.
const STREAMING_PLACEHOLDER_TIMEOUT_MS =
  typeof import.meta.env.VITE_STREAMING_PLACEHOLDER_TIMEOUT_MS === 'string'
    ? parseInt(import.meta.env.VITE_STREAMING_PLACEHOLDER_TIMEOUT_MS, 10) || 300_000
    : 300_000;
import { trackEvent } from '@/lib/analytics';
import { track as posthogTrack } from '@/lib/posthog';
import { ReviewList } from '@/components/ReviewList';
import { EcLoading } from '@/components/ui/states';

import { useAutoTranslate } from './useAutoTranslate';
import { generatePDF } from './pdfGenerator';
import { DayTimeline } from './components/DayTimeline';
import { EditModeToggle } from './components/EditModeToggle';
import { AddStopModal } from './components/AddStopModal';
import { ErrorState } from './components/ErrorState';
import { PlanDocumentMasthead } from './components/PlanDocumentMasthead';
import { PlanDocumentState } from './components/PlanDocumentState';
import { ReportPlanModal } from './components/ReportPlanModal';
import { RecommendedRestaurants } from './components/RecommendedRestaurants';
import { SwipeContainer } from './components/SwipeContainer';
// SlideProgress 제거됨 (2026-05-03) — 탭만으로 네비게이션 일원화.
// import { SlideProgress } from './components/SlideProgress';
import { PreTripSlide } from './components/PreTripSlide';
import { SectionTabs } from './components/SectionTabs';
import { IntroSlide } from './components/IntroSlide';
import { OutroSlide } from './components/OutroSlide';
import { ActivityGuideSlide } from './components/ActivityGuideSlide';
import { AdSlide } from './components/AdSlide';
import { QualityWarningsPanel } from './components/QualityWarningsPanel';
import { UserPlanNoticesPanel } from './components/UserPlanNoticesPanel';
import { usePlanEditor } from './hooks/usePlanEditor';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { usePlanCompletionTracking } from './hooks/usePlanCompletionTracking';
import { buildSlides } from './lib/buildSlides';
import { formatDayLabel } from './lib/dayLabel';
import { getPlanDocumentStatus } from './lib/planStats';
import type { PlanDocument } from './types';
import { getPlanDetailUI } from './types';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';

export default function PlanDetailPage() {
  const { planId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, loading: authLoading } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  // P235: 'notfound' = 문서 없음 / 'unauthorized' = 접근 거부 / 'autherror' = 인증 만료·JS 캐시 불일치
  const [error, setError] = useState<'notfound' | 'unauthorized' | 'autherror' | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [addStopDay, setAddStopDay] = useState<number | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // P225: streaming hang timeout — 스트리밍 시작 시각 + timed-out 플래그
  const streamingStartRef = useRef<number | null>(null);
  const [streamingTimedOut, setStreamingTimedOut] = useState(false);

  // Plan editor (optimistic Firestore updates + auto transit recalc)
  const editor = usePlanEditor(planId || '', plan, setPlan);

  // Drag sensors with distance constraint for mobile scroll compatibility
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Build slide array from plan data
  const slides = useMemo(() => (plan ? buildSlides(plan) : []), [plan]);
  const { current, goToSlide } = useSwipeNavigation(slides.length);

  // P1 보완 (2026-07-11): planner_complete/free_plan_redeemed — plan.status 확정 시점 1회.
  usePlanCompletionTracking(planId, plan?.status, !!plan);

  // Firestore listener
  //
  // PR #450 (Audit W-H16 — 2026-05-16): deps used to be
  //   [planId, token, user, authLoading]
  // — `user` is the Firebase User object, whose REFERENCE changes on every
  // token refresh (esp. after PR #449 added 50min periodic + visibility
  // refresh). Each ref change tore down the onSnapshot subscription and
  // immediately re-subscribed → leaked listener handles + redundant
  // Firestore reads. Switched to `user?.uid` (stable string) so the
  // effect only re-runs when the actual identity changes.
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!planId) { setError('notfound'); setLoading(false); return; }
    if (authLoading) return;
    setError(null);
    setLoading(true);

    // DEV-only (로컬 플랜 하네스): /my-plans/x?localPlan=<scenario> → vite dev 가 서빙하는
    //   /local-plans/<scenario>.json(= scripts/plan-local/outputs/plan-<scenario>.json) 을 fetch 해
    //   PlanDetailPage 로 렌더. `npm run plan:test -- <scenario>` 출력을 prod 처럼 눈으로 확인용.
    //   import.meta.env.DEV 가드 → prod 빌드서 통째 tree-shake(무영향). 소유자로 표시(마스킹 없이 full).
    if (import.meta.env.DEV) {
      const localScenario = searchParams.get('localPlan');
      if (localScenario && /^[a-z0-9-]+$/i.test(localScenario)) {
        let devCancelled = false;
        fetch(`/local-plans/${localScenario}.json`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
          .then((p) => { if (devCancelled) return; setIsOwner(true); setPlan(p as PlanDocument); setLoading(false); })
          .catch(() => { if (devCancelled) return; setError('notfound'); setLoading(false); });
        return () => { devCancelled = true; };
      }
    }

    // fix/plan-pii-wire-leak (2026-06-20): 공유 플랜 PII wire 누출 차단.
    //   이전엔 비소유자/공개/게스트 플랜도 클라이언트 onSnapshot 으로 읽어(룰 19-21 이 허용)
    //   원본 doc(accessToken·guestEmail·pricing·hotel_address 등)이 JS 마스킹 전에 WebSocket
    //   프레임으로 브라우저에 전송 → Network 탭/프레임에서 raw PII 관측 가능했다. accessToken
    //   이 새면 ?token= 으로 마스킹을 완전 우회(소유자급).
    //   → 비소유자(비로그인 + 로그인 비소유자)는 /api/get-plan(resolvePlanAccess)로만 읽는다.
    //     서버가 wire 전에 마스킹(공개=masked / 토큰=full / 그외=403) → 브라우저는 마스킹된
    //     doc 만 받는다. 소유자(로그인 본인)만 onSnapshot 실시간 경로 유지(편집 즉시 반영).
    //   firestore.rules plans read 도 소유자 전용으로 좁힘(룰 + 코드 이중 차단).

    // snapshot/API 응답 공통 처리 — viewerUid 는 ownerCheck 용 (로그인=uid).
    // API 경로 plan 은 이미 서버 마스킹됨 → 아래 마스킹은 멱등(방어심층). isOwner 도 set.
    const handleSnap = (data: PlanDocument, viewerUid: string | null | undefined) => {
      const ownerCheck = !!(viewerUid && data.uid === viewerUid);
      const hasToken = data.accessToken && data.accessToken === token;
      const isGuestPlan = !data.uid;
      const isPublicShared = data.isPublic === true;
      if (!ownerCheck && !hasToken && !isGuestPlan && !isPublicShared) { setError('unauthorized'); setLoading(false); return; }
      // PII masking — 소유자도 유효 토큰 보유자도 아닌 접근(공유 링크 또는 게스트 플랜 planId 노출).
      // 버그헌트 2026-06-14: 게스트 플랜(uid 없음)을 토큰 없이 보면 PII(이메일·주소·알레르기·토큰)가
      // 그대로 노출되던 것 → 마스킹. itinerary 뷰는 유지(안 깨짐). 이제 wire-레벨 차단은 비소유자
      // 가 /api/get-plan(서버 마스킹) 경유라 달성 — 이 JS 마스킹은 멱등 방어심층으로 유지.
      const noPiiAccess = !ownerCheck && !hasToken;
      if (noPiiAccess && (isPublicShared || isGuestPlan)) {
        delete data.uid; delete data.guestEmail;
        delete data.accessToken;
        if (data.input) {
          delete data.input.guestName;
          delete data.input.specialRequest;
          delete data.input.hotel_address;
          delete data.input.arrival_airport;
          delete data.input.departure_airport;
          delete data.input.dietary;
          delete data.input.allergies;
        }
        delete data.pricing;
      }
      setIsOwner(ownerCheck);
      setPlan(data);
      setLoading(false);
    };

    // 소유자 onSnapshot 경로의 에러 핸들러 — 동작 100% 동일.
    const handleErrLegacy = (err: unknown) => {
      // P235: permission-denied = 인증 만료 또는 PWA 스테일 캐시 → 재로그인/새로고침 안내.
      // 그 외 (not-found, network 등) = 일반 notfound 처리.
      const code = (err as { code?: string })?.code || '';
      console.error('[PlanDetail] Firestore read error:', code, err);
      if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
        setError('autherror');
      } else {
        setError('notfound');
      }
      setLoading(false);
    };

    // cancelled 가드 — 비동기 fetch 가 effect cleanup 후 setState 하지 않도록.
    let cancelled = false;

    // 비소유자(비로그인 + 로그인 비소유자) 서버 경유 읽기 — wire 전에 서버 마스킹.
    //   200 → handleSnap(json.plan, viewerUid) (서버가 공개=masked / 토큰=full 반환).
    //   403 → unauthorized / 404 → notfound / 그 외 → autherror.
    const fetchViaApi = async (viewerUid: string | null | undefined) => {
      try {
        const url = token
          ? `/api/get-plan?planId=${encodeURIComponent(planId)}&token=${encodeURIComponent(token)}`
          : `/api/get-plan?planId=${encodeURIComponent(planId)}`;
        const resp = await fetch(url);
        const json = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (resp.ok && json && json.ok && json.plan) {
          handleSnap(json.plan as PlanDocument, viewerUid);
          return;
        }
        if (resp.status === 403) { setError('unauthorized'); setLoading(false); return; }
        if (resp.status === 404) { setError('notfound'); setLoading(false); return; }
        setError('autherror'); setLoading(false);
      } catch (fetchErr) {
        if (cancelled) return;
        console.error('[PlanDetail] get-plan fetch failed:', fetchErr);
        setError('autherror'); setLoading(false);
      }
    };

    // 비로그인 = 무조건 비소유자 → onSnapshot 절대 안 함, API 만.
    //   (서버가 공개=masked / 토큰=full / 그외=403 으로 판정 → raw PII 가 브라우저에 안 옴.)
    if (!uid) {
      void fetchViaApi(uid);
      return () => { cancelled = true; };
    }

    // 로그인 = 소유자 실시간 경로(onSnapshot). 본인 plan 만 룰이 read 허용.
    //   permission-denied = 로그인 비소유자(룰 거부) → API 로 폴백(서버가 공개/토큰 판정).
    const unsub = onSnapshot(doc(db, 'plans', planId), (snap) => {
      if (cancelled) return;
      if (!snap.exists()) { setError('notfound'); setLoading(false); return; }
      handleSnap(snap.data() as PlanDocument, uid);
    }, (err) => {
      if (cancelled) return;
      const code = (err as { code?: string })?.code || '';
      if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
        void fetchViaApi(uid);
        return;
      }
      handleErrLegacy(err);
    });
    return () => { cancelled = true; unsub(); };
  }, [planId, token, uid, authLoading]);

  // share_visit tracking
  useEffect(() => {
    if (searchParams.get('shared') === '1' && planId) {
      trackEvent('share_visit', { plan_id: planId });
    }
  }, [planId, searchParams]);

  // Sprint 2 #7: plan_generated PostHog event — fire once per planId/session.
  // We can't tap the AI generation moment from the frontend (it happens
  // server-side after PayPal capture), so we proxy "plan exists + reached
  // detail page" as the generation event. sessionStorage guard prevents
  // refire on translation updates, snapshot patches, or component remount
  // within the same browser session.
  useEffect(() => {
    if (!planId || !plan) return;
    const sessionKey = `posthog:plan_generated:${planId}`;
    try {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.sessionStorage.setItem(sessionKey, '1');
    } catch { /* private mode — fall through and fire (worst case: dupe) */ }
    void posthogTrack('plan_generated', {
      planId,
      area: plan.input?.area,
      pace: plan.input?.pace as string | undefined,
      durationDays: (plan.itinerary?.days || []).length || undefined,
      pax: plan.input?.adults || plan.input?.pax,
      language: plan.input?.language,
    });
  }, [planId, plan]);

  // Dynamic OG meta tags
  const days = useMemo(() => (plan?.itinerary?.days) || [], [plan]);
  usePageMeta({
    title: plan?.itinerary?.tour_title || 'Travel Plan',
    description: `${plan?.input?.area || 'Korea'} ${days.length}-day itinerary | CocoTrip`,
    ogImage: `https://cocotripkr.com/api/og-image?planId=${planId}`,
    ogUrl: `https://cocotripkr.com/my-plans/${planId}`,
  });

  // Auto-translate (locked hook - see useAutoTranslate.ts for invariants)
  const { isTranslating, translationError } = useAutoTranslate(plan, setPlan, language);

  // PDF download (locked module - see pdfGenerator.ts for invariants)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const handleDownloadPDF = useCallback(async () => {
    if (!plan) return;
    // P207 Layer 2 — button-level streaming guard (OutroSlide disabled prop 보완).
    // pdfGenerator.ts 내부에도 동일 guard 존재 — 2중 방어.
    if (plan._streaming_in_progress === true) return;
    setIsPdfGenerating(true);
    try {
      const uiDict = getPlanDetailUI(t);
      const transitDict = ((t as Record<string, unknown>).planDetail as Record<string, unknown> | undefined)?.transit as Record<string, string> | undefined;
      await generatePDF(plan, uiDict, transitDict, language);
    } finally {
      setIsPdfGenerating(false);
    }
  }, [plan, t]);

  // P169: streaming 진행 중 여부 (Firestore _streaming_in_progress 필드)
  const isStreamingInProgress = !loading && plan && plan._streaming_in_progress === true;
  // P312 (2026-05-30 1차 → 2026-06-12 2차): plan.status === 'error' (P292 sweep / P307
  // onFailure 가 streaming stuck/worker 실패를 마킹). 1차는 상단 인라인 배너 + 그 아래
  // 빈/부분 itinerary 슬라이드(SectionTabs/SwipeContainer)를 그대로 렌더 → 결제 후 빈 화면
  // + 작동 안 하는 탭 노출. 2차는 notfound/autherror 처럼 **풀페이지 ErrorState 로 이른
  // return** (아래 분기) — 슬라이드 렌더 자체를 차단. 자동 재시도(S2-b)는 Gemini 재호출
  // 비용 + error plan 처리 정책(신규 planId vs revisionOf) 운영자 결정 필요 → 별도.
  const isPlanError = !loading && !!plan && plan.status === 'error';
  const streamingProgress = !loading && plan
    ? plan._streaming_progress
    : undefined;

  // P244: window.__pageReady ready signal — Playwright visual spec 전용.
  // loading=false 도달 시점 (plan 렌더 완료 또는 error 상태 확정) 에 emit.
  // deployment_status trigger 에서 Firebase auth 미주입 → unauthorized 상태 포함 전체 케이스 커버.
  // 비유: "요리가 나왔든 품절이든 — 주방이 '답변 완료' 간판 걸기"
  // waitForSelector('[data-testid="section-tabs-scroll"]') 는 plan 로드 성공 시만 노출 → 인증 없는 CI 에서 항상 timeout.
  useEffect(() => {
    if (!loading && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__pageReady = true;
    }
  }, [loading]);

  // P316 (2026-05-30): 결제 완료 + 소유자 확인 시 planner 위저드 autosave 정리.
  // WizardForm 의 handleGenerate 성공 시점에는 결제 미완료 가능성(SDK 멈춤/광고차단/
  // 새로고침) 때문에 snapshot 을 보존하지만, plan 이 확정 결제(plan.paid)되면 더 이상
  // resume 가 필요 없다 → 결제 후 /planner 재진입 시 stale "이어서 작성" modal 미노출.
  // isOwner 는 onSnapshot listener 가 ownerCheck 로 set (uid === data.uid).
  const isPaid = !loading && !!(plan && plan.paid);
  useEffect(() => {
    if (isPaid && isOwner) clearPlannerWizardSnapshot();
  }, [isPaid, isOwner]);

  // P225: streaming hang timeout — _streaming_in_progress 최초 감지 시 타이머 시작.
  // STREAMING_PLACEHOLDER_TIMEOUT_MS 경과 후 streamingTimedOut=true → 오류 UI 표시.
  // streaming 완료 시 cleanup으로 타이머 취소 + startRef 리셋.
  // setState는 setTimeout callback(비동기) 및 cleanup(비동기)에서만 호출 — cascade 없음.
  useEffect(() => {
    if (!isStreamingInProgress) {
      // 스트리밍 완료 또는 미시작 — startRef 리셋, cleanup에서 timedOut 상태 클리어
      streamingStartRef.current = null;
      return () => { setStreamingTimedOut(false); };
    }
    // 스트리밍 시작 — startRef 최초 설정 (재진입 시 유지)
    if (streamingStartRef.current === null) {
      streamingStartRef.current = Date.now();
    }
    const elapsed = Date.now() - streamingStartRef.current;
    const remaining = STREAMING_PLACEHOLDER_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      // 이미 timeout 경과 — requestAnimationFrame으로 defer (effect body 직접 setState 회피)
      const raf = requestAnimationFrame(() => setStreamingTimedOut(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => {
      setStreamingTimedOut(true);
    }, remaining);
    return () => { window.clearTimeout(timer); };
  }, [isStreamingInProgress]);

  // Loading / Error states
  const ui = getPlanDetailUI(t);
  if (loading) {
    return (
      <div className="ec-root min-h-screen" data-testid="plan-document">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <PlanDocumentState kind="loading" ui={ui} />
        <Footer t={t} />
      </div>
    );
  }

  if (error === 'notfound') {
    return (
      <div className="ec-root min-h-screen" data-testid="plan-document">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <PlanDocumentState
          kind="not-found"
          ui={ui}
          action={<Link to="/planner" className="ec-btn ec-btn-primary">{ui.createNewPlan}</Link>}
        />
        <Footer t={t} />
      </div>
    );
  }

  if (error === 'unauthorized') {
    return (
      <div className="ec-root min-h-screen" data-testid="plan-document">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <PlanDocumentState
          kind="permission"
          ui={ui}
          action={<Link to="/my-plans" className="ec-btn ec-btn-secondary">{ui.backToPlans}</Link>}
        />
        <Footer t={t} />
      </div>
    );
  }

  // P235: PWA stale cache 로 인한 인증 만료 에러 — 새로고침 유도.
  // Firestore permission-denied = 옛 JS 의 Firebase 클라이언트 인증 상태 불일치 or 토큰 만료.
  // 빗댄 표현: "문은 있는데 열쇠가 맞지 않음" — 사용자는 plan 을 삭제하지 않았으므로 notfound 아님.
  // 새로고침 시 SW 가 새 JS 를 받아 Firebase 재인증 → 정상 표시.
  if (error === 'autherror') {
    return (
      <div className="ec-root min-h-screen" data-testid="plan-document">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <PlanDocumentState kind="session" ui={ui} onRetry={() => window.location.reload()} />
        <Footer t={t} />
      </div>
    );
  }

  // P312 2차 (2026-06-12): plan.status === 'error' → 풀페이지 에러 상태.
  // notfound/unauthorized/autherror 와 동일하게 이른 return 으로 빈/깨진 슬라이드 렌더 차단.
  // (1차 인라인 배너는 ErrorState 컴포넌트로 대체 — 아래 slideElements/JSX 미도달.)
  if (isPlanError) {
    return (
      <ErrorState
        language={language}
        t={t}
        onLanguageChange={changeLanguage}
        ui={getPlanDetailUI(t)}
      />
    );
  }

  if (!plan) return null;

  if (days.length === 0 && !isStreamingInProgress) {
    return (
      <div className="ec-root min-h-screen" data-testid="plan-document">
        <Header language={language} t={t} onLanguageChange={changeLanguage} />
        <PlanDocumentState
          kind="empty"
          ui={ui}
          action={(
            <>
              <Link to="/planner" className="ec-btn ec-btn-primary">{ui.createNewPlan}</Link>
              <Link to="/my-plans" className="ec-btn ec-btn-secondary">{ui.backToPlans}</Link>
            </>
          )}
        />
        <Footer t={t} />
      </div>
    );
  }

  // days already defined above via useMemo

  // Render each slide based on type
  const slideElements = slides.map((slide, idx) => {
    switch (slide.type) {
      case 'preTrip':
        return <PreTripSlide key={`preTrip-${idx}`} plan={plan} planId={planId || ''} />;
      case 'intro':
        return <IntroSlide key={`intro-${idx}`} plan={plan} planId={planId || ''} isTranslating={isTranslating} translationError={translationError} isOwner={isOwner} />;
      case 'day': {
        const dayIdx = typeof slide.dayIndex === 'number' ? slide.dayIndex : 0;
        // P224: defensive guard — days[dayIdx] may be undefined during streaming
        // race condition (Firestore snapshot arrives before itinerary.days is fully
        // populated). Render a skeleton instead of crashing DayTimeline.
        const dayData = days[dayIdx];
        if (!dayData) {
          return (
            <div key={`day-${dayIdx}-skeleton`} className="ec-card my-6">
              <EcLoading label={`${ui.loadingPlan} ${formatDayLabel(language, dayIdx + 1)}`} lines={5} />
            </div>
          );
        }
        return (
          <div key={`day-${dayIdx}`}>
            {/* Edit toggle — 소유자만 (공유 링크 고객에겐 미노출). */}
            {isOwner && (
              <div className="flex justify-end mb-3">
                <EditModeToggle editMode={editMode} onToggle={() => setEditMode(!editMode)} />
              </div>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                const activeMatch = String(active.id).match(/^day-(\d+)-stop-(\d+)$/);
                const overMatch = String(over.id).match(/^day-(\d+)-stop-(\d+)$/);
                if (activeMatch && overMatch && activeMatch[1] === overMatch[1]) {
                  editor.reorderStops(parseInt(activeMatch[1], 10), parseInt(activeMatch[2], 10), parseInt(overMatch[2], 10), token);
                }
              }}
            >
              <DayTimeline
                day={dayData}
                dayIndex={dayIdx}
                editMode={editMode}
                isRecalculating={editor.isRecalculating}
                onDeleteStop={(di, si) => editor.deleteStop(di, si, token)}
                onAddStop={(di) => setAddStopDay(di)}
                onApplyOrder={(di, order) => editor.applyStopOrder(di, order, token)}
                plan={plan}
                isOwner={isOwner}
              />
            </DndContext>
          </div>
        );
      }
      case 'ad':
        return <AdSlide key={`ad-${idx}`} adType={slide.adType || 'hotel'} plan={plan} />;
      case 'activityGuide':
        return <ActivityGuideSlide key={`activityGuide-${idx}`} plan={plan} language={language} />;
      case 'outro':
        return (
          <OutroSlide
            key={`outro-${idx}`}
            plan={plan}
            planId={planId || ''}
            token={token}
            isPdfGenerating={isPdfGenerating}
            isTranslating={isTranslating}
            isOwner={isOwner}
            isStreamingInProgress={!!isStreamingInProgress}
            onDownloadPDF={handleDownloadPDF}
          />
        );
      default:
        return null;
    }
  });

  return (
    <div className="ec-root min-h-screen" data-testid="plan-document">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <PlanDocumentMasthead
        plan={plan}
        status={getPlanDocumentStatus(plan, Boolean(isStreamingInProgress))}
        ui={ui}
        regionNames={((t as unknown as { planner?: { regionNames?: Record<string, string> } }).planner?.regionNames) || {}}
      />
      <main data-testid="plan-document-ready" className="ec-container-wide py-8 md:py-12">
        {/* P169: Streaming 진행 중 인디케이터 배너 (onSnapshot 자동 감지) */}
        {/* P225: streamingTimedOut 시 오류 배너 + 새로고침 버튼 */}
        {isStreamingInProgress && (
          <div className="mb-6">
            <PlanDocumentState
              kind="partial"
              ui={ui}
              busy={!streamingTimedOut}
              title={streamingTimedOut
                ? ui.streamingTimeoutTitle
                : `${ui.documentBuilding}${streamingProgress ? ` · ${formatDayLabel(language, streamingProgress)}` : ''}`}
              body={streamingTimedOut ? ui.streamingTimeoutBody : ui.partialPlanBody}
              action={streamingTimedOut ? (
                <button type="button" onClick={() => window.location.reload()} className="ec-btn ec-btn-secondary">
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {ui.refreshPage}
                </button>
              ) : undefined}
            />
          </div>
        )}
        {/* P312 안내: status==='error' 는 위에서 풀페이지 ErrorState 로 이른 return 됨
            (이 JSX 에 도달하지 않음). 1차 인라인 배너는 ErrorState 컴포넌트로 이전. */}

        {/* Section tabs (2026-05-03 사용자 결정: 탭만으로 네비게이션, dots/swipe 제거) */}
        <SectionTabs slides={slides} current={current} onJump={goToSlide} />

        {/* Swipe carousel */}
        <SwipeContainer
          current={current}
          onSlideChange={goToSlide}
          editMode={editMode}
        >
          {slideElements}
        </SwipeContainer>

        {/* AddStopModal: sibling to SwipeContainer, overlays regardless of current slide */}
        <AddStopModal
          open={addStopDay !== null}
          onClose={() => setAddStopDay(null)}
          onAdd={(stopData) => {
            if (addStopDay !== null) {
              editor.addStop(addStopDay, stopData, token);
              setAddStopDay(null);
            }
          }}
        />

        {/* 2026-05-04 학습 루프 Tier 1-A 신고 모달 */}
        <ReportPlanModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          planId={planId || ''}
          userEmail={user?.email || ''}
          language={(['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh'}
        />

        {/* Must-visit restaurants (DB-derived, backend `pickRecommendedRestaurantsByStyle`).
           Accepts both legacy array shape and new per-style map { general, vegan?, halal? }. */}
        {plan?.itinerary?.recommended_restaurants && (() => {
          const recs = plan.itinerary.recommended_restaurants;
          const isArr = Array.isArray(recs);
          const isMap = !isArr && recs && typeof recs === 'object';
          const hasContent = isArr
            ? recs.length > 0
            : isMap
              ? Object.values(recs as Record<string, unknown>).some(
                  (v) => Array.isArray(v) && v.length > 0,
                )
              : false;
          if (!hasContent) return null;
          const ui = getPlanDetailUI(t);
          const lng = (language as 'ko' | 'en' | 'ja' | 'zh') || 'en';
          return (
            <div className="mt-8">
              <RecommendedRestaurants
                items={recs}
                language={lng}
                labelTitle={ui.recommendedRestaurantsTitle}
                labelSubtitle={ui.recommendedRestaurantsSubtitle}
                labelReviews={ui.reviews}
                labelOpenMap={ui.openMap}
                labelKmAway={ui.kmAway}
                labelGeneralSection={ui.recRestaurantsGeneral}
                labelVeganSection={ui.recRestaurantsVegan}
                labelHalalSection={ui.recRestaurantsHalal}
                labelEmptyBucket={ui.recRestaurantsEmpty}
                labelCitySubSection={ui.recRestaurantsCitySubSection}
              />
            </div>
          );
        })()}

        {/* Reviews Section */}
        <div className="mt-8">
          <ReviewList targetType="plan" targetId={planId || ''} surface="paper" />
        </div>

        {/* P294 (2026-05-29): 사용자 UI quality_warnings 노출 panel.
            화이트리스트 (positive notices 만) + 4lang i18n + purple/pink 디자인 토큰.
            QualityWarningsPanel (admin amber) 와 구분. severity='critical' 제외. */}
        <UserPlanNoticesPanel
          qualityWarnings={plan.itinerary?.quality_warnings as never}
        />

        {/* P121 (2026-05-20): 운영자 전용 quality_warnings + qualityScore 노출.
            isAdminEmail 가드 — 일반 사용자에게는 null 반환. */}
        <QualityWarningsPanel
          userEmail={user?.email || null}
          qualityWarnings={plan.itinerary?.quality_warnings as never}
          qualityScore={(plan as Record<string, unknown>).qualityScore as never}
          planId={planId || ''}
          plannerMode={plan.plannerMode}
        />

        {/* 2026-05-04: 플랜 신고 버튼 (Tier 1-A 학습 루프). 인라인 — floating 보다 덜 방해적. */}
        <div className="mt-10 border-t border-ec-line pt-6">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="ec-btn ec-btn-quiet -ml-3 min-h-[44px]"
          >
            <Flag className="w-3.5 h-3.5" />
            {language === 'ko' ? '플랜에 문제가 있나요?' :
             language === 'ja' ? 'プランに問題がありますか？' :
             language === 'zh' ? '行程有问题？' :
             'Report an issue with this plan'}
          </button>
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
