// Planner page state handlers -- extracted verbatim from legacy PlannerPage.tsx.
// LOCKED region -- handlePaymentSuccess lifted verbatim.
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlannerFormValues } from '@/components/PlannerForm';
import { cityNameToAreaKey } from '../lib/formatters';
import { auth as firebaseAuth } from '@/lib/firebase';

// Audit P0-#2 (2026-05-04): /api/ai-planner-full 가 Authorization: Bearer <idToken>
// 필수. 패턴 출처: src/pages/AdminReconciliation.tsx:43-45 (`await user.getIdToken();
// headers: { Authorization: \`Bearer ${idToken}\` }`).
async function getAuthHeader(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) return {};
  try {
    const idToken = await user.getIdToken();
    return { Authorization: `Bearer ${idToken}` };
  } catch {
    return {};
  }
}

interface UsePlannerHandlersOptions {
  language: string;
  userEmail: string;
  setUserEmail: (email: string) => void;
}

type Status = 'idle' | 'loadingQuick' | 'quickSuccess' | 'loadingFull' | 'fullSuccess' | 'error';

export type PlannerErrorCode =
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_ERROR'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_INCOMPLETE'
  | 'DUPLICATE_ORDER'
  | 'REVISION_EXHAUSTED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'ABORT_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'MISSING_FORM'
  | 'NO_PLAN_URL'
  | 'UNKNOWN_ERROR';

interface ErrorPayload {
  code: PlannerErrorCode;
  details: string;
}

export function usePlannerHandlers({ language, userEmail, setUserEmail }: UsePlannerHandlersOptions) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [resultQuick, setResultQuick] = useState<Record<string, unknown> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<PlannerErrorCode | null>(null);
  const [, setStreamStep] = useState<number>(0);
  const [, setStreamAgent] = useState<string>('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planErrorCode, setPlanErrorCode] = useState<PlannerErrorCode | null>(null);
  const lastValues = useRef<PlannerFormValues | null>(null);

  function normalizeFetchError(err: unknown, codeFromServer?: string, detailsFromServer?: string): ErrorPayload {
    if (codeFromServer) {
      return { code: codeFromServer as PlannerErrorCode, details: detailsFromServer || '' };
    }
    if (err instanceof Error) {
      if (err.name === 'AbortError') return { code: 'ABORT_TIMEOUT', details: err.message };
      if (err instanceof TypeError) return { code: 'NETWORK_ERROR', details: err.message };
      return { code: 'UNKNOWN_ERROR', details: err.message };
    }
    return { code: 'UNKNOWN_ERROR', details: 'Unknown error.' };
  }

  // 1: Quick preview (free) -- ai-planner-quick call with auto-retry
  async function handleSubmit(values: PlannerFormValues) {
    lastValues.current = values;
    setStatus('loadingQuick');
    setResultQuick(null);
    setErrorMsg(null);
    setErrorCode(null);
    setStreamStep(1);
    setStreamAgent('gemini');
    
    const MAX_RETRIES = 2;
    const payload = JSON.stringify({ 
      destination: (values.regions || []).join(', ') || 'Seoul',
      preferences: (values.categories || []).join(', ') || '',
      categories: values.categories || ['culture'],
      durationDays: values.durationDays || 3,
      pax: values.pax || 2,
      language,
      regions: values.regions || ['Seoul'],
      dietPrefs: values.dietPrefs || [],
      allergies: values.allergies || [],
      priceRange: values.priceRange || 'Any',
      special_request: values.freeText || '',
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/ai-planner-quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = errBody.details || errBody.error || `Server error (${res.status})`;
          if ((res.status === 404 || res.status >= 500) && attempt < MAX_RETRIES) {
            console.warn(`[Planner] Attempt ${attempt + 1} got ${res.status}, retrying in 1.5s...`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          const e = new Error(msg) as Error & { code?: string; details?: string };
          e.code = errBody.code;
          e.details = errBody.details;
          throw e;
        }

        const json = await res.json();
        const quickData = json.data;
        setResultQuick(quickData);
        setStatus('quickSuccess');
        setTimeout(() => {
          document.getElementById('planner-quick-result')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES && err instanceof TypeError) {
          console.warn(`[Planner] Network error on attempt ${attempt + 1}, retrying...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        const payload = normalizeFetchError(
          err,
          (err as { code?: string }).code,
          (err as { details?: string }).details || (err as Error).message,
        );
        setErrorCode(payload.code);
        setErrorMsg(payload.details || (err instanceof Error ? err.message : 'Unknown error.'));
        setStatus('error');
        return;
      }
    }
  }

  // LOCKED region -- handlePaymentSuccess lifted verbatim from legacy PlannerPage.tsx L1414-1493
  // 2: PayPal payment success -> Full AI plan generation (paid)
  async function handlePaymentSuccess(paypalOrderId: string) {
    setIsGeneratingPlan(true);
    setPlanError(null);
    setPlanErrorCode(null);
    setStreamStep(1);
    setStreamAgent('gemini');

    const values = lastValues.current;
    if (!values) {
      setPlanErrorCode('MISSING_FORM');
      setPlanError('Form data missing. Please try again.');
      setIsGeneratingPlan(false);
      return;
    }

    try {
      // 2026-05-03: timeout 120s → 300s. 백엔드 ai-planner-full.js는
      // maxDuration=300 (Vercel Pro 5분)인데 client가 2분만 기다려서 정상
      // 응답 전에 abort → "signal is aborted without reason" UX 망가짐.
      // 5분으로 매칭 + 의미있는 reason 전달 (DOMException name='AbortError'
      // 유지해서 catch 블록의 err.name === 'AbortError' 체크 호환).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new DOMException(
          'AI 플랜 생성이 5분 이상 걸려 중단했습니다. 잠시 후 다시 시도하거나 WhatsApp으로 문의주세요.',
          'AbortError'
        ));
      }, 300000);

      const authHeaders = await getAuthHeader();
      // 2026-05-10 (P0-2 launch blocker): guest checkout 지원 — token 없어도
      // paypalOrderId 있으면 진행. backend paymentGate.js 가 PayPal order 검증으로
      // guest 결제 인증. 외국인 sign-in 미인증자도 결제만 완료하면 plan 생성 가능.
      // 2026-05-12 (B-9 fix): ADMIN-BYPASS-* / TEST-* prefix 는 server-side 가
      // Firebase ID token 으로 검증 → auth 헤더 필수. MANUAL-* 만 pending_bookings
      // doc 으로 검증 가능 → guard 통과 허용. PR #332 의 guard relax 부작용 차단.
      const needsAuth = paypalOrderId?.startsWith('ADMIN-BYPASS-') || paypalOrderId?.startsWith('TEST-');
      if (!authHeaders.Authorization && (!paypalOrderId || needsAuth)) {
        clearTimeout(timeoutId);
        const errMsg = needsAuth
          ? 'Sign-in required for admin/test mode. Sign in with admin account first.'
          : 'Sign-in or payment required to generate AI plan.';
        const e = new Error(errMsg) as Error & { code?: string };
        e.code = 'AUTH_REQUIRED';
        throw e;
      }
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        signal: controller.signal,
        body: JSON.stringify({
          paypalOrderId,
          guestName: 'Guest',
          email: userEmail,
          startDate: values.startDate,
          endDate: values.endDate,
          destination: (values.regions || []).join(', ') || 'Seoul',
          // 2026-05-10 (P0-1 launch blocker): regions array forward — PR #331 다도시
          // fix 가 backend 에서 작동하려면 array 형태로 받아야 함. area 는 첫 도시 만.
          regions: values.regions || ['Seoul'],
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          preferences: (values.categories || []).join(', ') || '',
          styles: values.categories || ['culture'],
          durationDays: values.durationDays || 3,
          pax: values.pax || 2,
          language,
          arrival_airport: values.arrival_airport || '',
          departure_airport: values.departure_airport || '',
          hotel_address: values.hotel_address || '',
          mobility: values.mobility || 'ok',
          uid: values.uid || null,
          dietPrefs: values.dietPrefs || [],
          allergies: values.allergies || [],
          priceRange: values.priceRange || 'Any',
          special_request: values.freeText || '',
          // 2026-05-10 (P1 launch blocker): WizardForm 에서 수집했지만 누락된
          // 필드들 forward. AirportToLodgingGuide / RouteAgent 의 late-night /
          // heavy-luggage 분기 작동 + Firestore input 보존을 위해 필요.
          // PlannerFormValues 는 snake_case (arrival_time/departure_time) 로
          // 정의되어 있고 backend ai-planner-full.js 는 body.arrivalTime
          // (camelCase) 로 읽으므로 read snake_case → send camelCase 변환.
          ...(values.arrival_time ? { arrivalTime: values.arrival_time } : {}),
          ...(values.departure_time ? { departureTime: values.departure_time } : {}),
          // P239 (2026-05-27): tourStartTime — 운영자 architectural fix forward.
          // 새벽 도착 시 호텔 transit only + tourStartTime 부터 stops 작성.
          // snake_case input → camelCase backend (다른 시각 필드와 일관).
          // default 09:00 → 옛 plan 호환: backend 가 명시 안 받아도 09:00 폴백.
          ...(values.tour_start_time ? { tourStartTime: values.tour_start_time } : {}),
          // #tour-end (2026-06-05): tourEndTime forward — 매일 관광 종료 cap (snake→camel).
          ...(values.tour_end_time ? { tourEndTime: values.tour_end_time } : {}),
          ...(values.luggage ? { luggage: values.luggage } : {}),
          ...(values.spiceLevel ? { spiceLevel: values.spiceLevel } : {}),
          ...(Array.isArray(values.bucketDishes) && values.bucketDishes.length ? { bucketDishes: values.bucketDishes } : {}),
          ...(values.tourPace ? { tourPace: values.tourPace } : {}),
          // Sprint 2 #5: undecided-hotel zone hint forwarded to backend.
          recommended_zone: values.recommended_zone || '',
          // 2026-05-11 (B-2 fix): 도시별 zone Record. 다도시 plan 시 backend
          // buildPrompt MULTI-CITY HANDLING 섹션이 city 별 zone hint 사용.
          // 단도시 plan 도 동일 형식 전달 (regression 0 — backend Record.length===1 자동 fallback).
          ...(values.recommended_zones && Object.keys(values.recommended_zones).length > 0
            ? { recommended_zones: values.recommended_zones }
            : {}),
          // 2026-05-03: zone 대표 주소 (RouteAgent가 공항↔zone 경로 계산용 fallback).
          recommended_zone_address: values.recommended_zone_address || '',
          // B9-20 (2026-05-09 round 4): WizardForm 에서 받은 wantAccom/accomBudget
          // 을 backend 로 forward. 누락 시 ai-planner-full 의 [ACCOMMODATION REQUEST]
          // 프롬프트 분기가 작동 안 함 → Gemini 가 호텔 추천 자체를 생성 안 함.
          ...(values.wantAccom ? { wantAccom: true, accomBudget: values.accomBudget || 'moderate' } : {}),
          // 2026-05-10 B10-1/B10-2: 다도시 plan 입국 도시 명시 + 도시별 호텔 forward.
          // backend buildPrompt.js 가 hotelByCity 받으면 day 별 prompt 에 도시별
          // hotel inject. entry_city 는 RouteAgent 의 entry 공항→첫 호텔 경로 계산용.
          ...(values.entry_city ? { entry_city: values.entry_city } : {}),
          ...(values.hotelByCity && Object.keys(values.hotelByCity).length > 0 ? { hotelByCity: values.hotelByCity } : {}),
          // 2026-05-21 (P125): 사용자 명시적 입국/출국 도시 (Wizard cycle UI).
          ...(values.arrival_city ? { arrival_city: values.arrival_city } : {}),
          ...(values.departure_city ? { departure_city: values.departure_city } : {}),
        }),
      });

      clearTimeout(timeoutId);

      let json;
      try {
        json = await res.json();
      } catch {
        // batch 9 fix (B9-6): JSON parse 실패 시 raw body 콘솔 dump + 메시지에 status 포함.
        // 502/504/HTML error page 케이스 진단 위해 운영자가 DevTools 콘솔에서 정확한
        // 원인 즉시 확인 가능. body는 200자까지만 (HTML 에러 페이지의 핵심만).
        let rawBody = '';
        try { rawBody = await res.text(); } catch { /* already consumed */ }
        console.error('[handlePaymentSuccess] Non-JSON response | status:', res.status, '| body[:200]:', rawBody.slice(0, 200));
        const e = new Error(`Server returned non-JSON response (HTTP ${res.status}). Check DevTools console for raw body. Please contact us via WhatsApp.`) as Error & { code?: string };
        e.code = 'INVALID_RESPONSE';
        throw e;
      }

      if (!res.ok) {
        const e = new Error(json.details || json.error || `Server error (${res.status})`) as Error & { code?: string; details?: string };
        e.code = json.code;
        e.details = json.details;
        throw e;
      }

      const data = json.data;

      setStreamStep(4);
      setStreamAgent('done');

      // P169: streaming 모드 — status: 'streaming' 이면 planId 받아서 바로 navigate.
      // PlanDetailPage 가 onSnapshot 으로 Firestore 점진 update 자동 감지 (이미 사용 중).
      // 비스트리밍 모드 (status: undefined 또는 'ready') 도 동일 navigate 흐름 유지.
      if (data?.planUrl) {
        navigate(data.planUrl);
      } else if (data?.planId) {
        navigate(`/my-plans/${data.planId}`);
      } else {
        const e = new Error('Plan created but no URL returned') as Error & { code?: string };
        e.code = 'NO_PLAN_URL';
        throw e;
      }
    } catch (err: unknown) {
      console.error('[PlannerPage] Plan generation failed:', err);
      const payload = normalizeFetchError(
        err,
        (err as { code?: string }).code,
        (err as { details?: string }).details || (err as Error).message,
      );
      setPlanErrorCode(payload.code);
      setPlanError(payload.details || (err instanceof Error ? err.message : 'Something went wrong. Please contact us via WhatsApp.'));
      setIsGeneratingPlan(false);
    }
  }

  // 3: Free revision regeneration (consumes revisionCredits)
  // W4: accepts revisionReason (comma-joined chips), revisionNote (free text), avoidList (stop names)
  async function handleRevisionRegenerate(
    values: PlannerFormValues,
    revisionPlanId: string,
    revisionToken: string | null,
    revisionReason?: string | null,
    revisionNote?: string | null,
    avoidList?: string | null,
  ) {
    if (!revisionPlanId) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    setPlanErrorCode(null);
    setStreamStep(1);
    setStreamAgent('gemini');

    try {
      // 2026-05-03: revision도 동일한 ai-planner-full endpoint 호출 — 같은 5분
      // 타임아웃 적용 (이전엔 timeout 자체가 없어서 무한 spinner 위험).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new DOMException(
          'AI 재생성이 5분 이상 걸려 중단했습니다. 잠시 후 다시 시도하거나 WhatsApp으로 문의주세요.',
          'AbortError'
        ));
      }, 300000);

      // Audit P0-#2: revision 도 인증 필수.
      const authHeaders = await getAuthHeader();
      if (!authHeaders.Authorization) {
        clearTimeout(timeoutId);
        const e = new Error('Sign-in required to regenerate AI plan. Please sign in and try again.') as Error & { code?: string };
        e.code = 'AUTH_REQUIRED';
        throw e;
      }
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        signal: controller.signal,
        body: JSON.stringify({
          revisionOf: revisionPlanId,
          revisionToken: revisionToken,
          guestName: 'Guest',
          email: userEmail,
          startDate: values.startDate,
          endDate: values.endDate,
          destination: (values.regions || []).join(', ') || 'Seoul',
          // 2026-05-10 (P0-1): regions array forward — 다도시 revision 도 작동.
          regions: values.regions || ['Seoul'],
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          preferences: (values.categories || []).join(', ') || '',
          styles: values.categories || ['culture'],
          durationDays: values.durationDays || 3,
          pax: values.pax || 2,
          language,
          arrival_airport: values.arrival_airport || '',
          departure_airport: values.departure_airport || '',
          hotel_address: values.hotel_address || '',
          mobility: values.mobility || 'ok',
          uid: values.uid || null,
          dietPrefs: values.dietPrefs || [],
          allergies: values.allergies || [],
          priceRange: values.priceRange || 'Any',
          special_request: values.freeText || '',
          // 2026-05-10 (P1): WizardForm 누락 필드 forward — paid path 와 동일.
          // PlannerFormValues = snake_case, backend body 는 camelCase 기대.
          ...(values.arrival_time ? { arrivalTime: values.arrival_time } : {}),
          ...(values.departure_time ? { departureTime: values.departure_time } : {}),
          // P239 (2026-05-27): revision path 도 tourStartTime forward (paid path 와 동일 영역 적용).
          ...(values.tour_start_time ? { tourStartTime: values.tour_start_time } : {}),
          // #tour-end (2026-06-05): revision path 도 tourEndTime forward.
          ...(values.tour_end_time ? { tourEndTime: values.tour_end_time } : {}),
          ...(values.luggage ? { luggage: values.luggage } : {}),
          ...(values.spiceLevel ? { spiceLevel: values.spiceLevel } : {}),
          ...(Array.isArray(values.bucketDishes) && values.bucketDishes.length ? { bucketDishes: values.bucketDishes } : {}),
          ...(values.tourPace ? { tourPace: values.tourPace } : {}),
          // W4: revision reason → server buildRevisionInstruction
          ...(revisionReason ? { revisionReason } : {}),
          ...(revisionNote   ? { revisionNote }   : {}),
          ...(avoidList      ? { avoidList }       : {}),
          // B9-20 (2026-05-09 round 4): revision 에서도 wantAccom forward.
          ...(values.wantAccom ? { wantAccom: true, accomBudget: values.accomBudget || 'moderate' } : {}),
          // 2026-05-10 B10-1/B10-2: revision 에서도 다도시 entry_city + hotelByCity forward.
          ...(values.entry_city ? { entry_city: values.entry_city } : {}),
          ...(values.hotelByCity && Object.keys(values.hotelByCity).length > 0 ? { hotelByCity: values.hotelByCity } : {}),
          // 2026-05-21 (P125): 사용자 명시적 입국/출국 도시 (Wizard cycle UI).
          ...(values.arrival_city ? { arrival_city: values.arrival_city } : {}),
          ...(values.departure_city ? { departure_city: values.departure_city } : {}),
        }),
      });

      clearTimeout(timeoutId);

      const json = await res.json();
      if (!res.ok) {
        const e = new Error(json.details || json.error || `Server error (${res.status})`) as Error & { code?: string; details?: string };
        e.code = json.code;
        e.details = json.details;
        throw e;
      }

      const data = json.data;

      setStreamStep(4);
      setStreamAgent('done');

      if (data?.planUrl) navigate(data.planUrl);
      else if (data?.planId) navigate(`/my-plans/${data.planId}`);
      else {
        const e = new Error('Plan created but no URL returned') as Error & { code?: string };
        e.code = 'NO_PLAN_URL';
        throw e;
      }
    } catch (err: unknown) {
      console.error('[PlannerPage] Revision failed:', err);
      const payload = normalizeFetchError(
        err,
        (err as { code?: string }).code,
        (err as { details?: string }).details || (err as Error).message,
      );
      setPlanErrorCode(payload.code);
      setPlanError(payload.details || (err instanceof Error ? err.message : 'Revision failed. Please contact us via WhatsApp.'));
      setIsGeneratingPlan(false);
    }
  }

  function handleReset() {
    setStatus('idle');
    setResultQuick(null);
    setErrorMsg(null);
    setErrorCode(null);
    setUserEmail('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return {
    status,
    resultQuick,
    errorMsg,
    errorCode,
    isGeneratingPlan,
    planError,
    planErrorCode,
    lastValues,
    handleSubmit,
    handlePaymentSuccess,
    handleRevisionRegenerate,
    handleReset,
  };
}
