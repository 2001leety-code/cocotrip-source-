// Planner page state handlers -- extracted verbatim from legacy PlannerPage.tsx.
// LOCKED region -- handlePaymentSuccess lifted verbatim.
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlannerFormValues } from '@/components/PlannerForm';
import { cityNameToAreaKey } from '../lib/formatters';
import { auth as firebaseAuth } from '@/lib/firebase';
import { isGuestAnonEnabled, shouldAttachGuestAnonToken } from '@/lib/guestReader';
import { markPlannerPendingComplete } from '@/lib/analytics';
import { track as posthogTrack } from '@/lib/posthog';
import { buildQuickPreviewPayload } from '../lib/quickPreviewIntent';
import { parseQuickPreviewResponse } from '../lib/quickPreviewContract';
import { buildFullPlannerIntentPayload } from '../lib/plannerIntent';

// feat/guest-anon-auth-pii (2026-06-15): 비로그인 게스트 + 플래그 ON 이면 격리된
// 익명 Firebase 인스턴스(guestReader)로 로그인해 idToken 을 x-guest-anon-token 헤더로
// 첨부한다. 결제용 Authorization 헤더는 절대 건드리지 않는다 (게스트는 그대로 없음 →
// 결제 경로 불변). 플래그 OFF(기본) = 빈 객체 반환 → 헤더/동작 동일.
async function getGuestAnonHeader(hasAuthorization: boolean): Promise<Record<string, string>> {
  if (!shouldAttachGuestAnonToken(hasAuthorization, isGuestAnonEnabled())) return {};
  try {
    const { ensureGuestAnon } = await import('@/lib/firebase');
    const gUser = await ensureGuestAnon();
    if (gUser) return { 'x-guest-anon-token': await gUser.getIdToken() };
  } catch { /* graceful — 실패해도 기존 게스트 결제 경로 그대로 진행 */ }
  return {};
}

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
  // 2026-08-24 (planner-trust-course, E/quick preview): stable quick-preview error codes.
  | 'MISSING_DESTINATION'
  | 'INVALID_DURATION'
  | 'INVALID_PAX'
  | 'MISSING_AIRPORT'
  | 'UNSUPPORTED_CITY'
  | 'CITY_DATA_UNAVAILABLE'
  | 'DIETARY_PREVIEW_UNAVAILABLE'
  // 2026-08-24 (planner-trust-course, client-hardening): permanent-data-gap and
  // rate-protection codes the server can now return (ai-planner-quick.js) — the
  // client union stayed a step behind the server's actual set.
  | 'PREFERENCE_DATA_UNAVAILABLE'
  | 'RATE_PROTECTION_DEGRADED'
  | 'INVALID_REQUEST'
  | 'CITY_MISMATCH'
  | 'MISSING_RESERVATION_STATUS'
  | 'INVALID_RESERVATION_STATUS'
  | 'MISSING_ARRIVAL_TIME'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_INCOMPLETE'
  // 결제 신뢰 검증 실패 계열 (paymentGate, 2026-07-15). 지역화 필수 —
  // PAYMENT_UNDER_REVIEW 는 "다시 결제하지 마세요"(이중청구 방지) 안내를 담고 있어,
  // 사전에 없으면 resolveErrorMessage 가 서버의 한국어 details 로 폴백해
  // en/ja/zh 사용자가 경고를 못 읽고 재결제할 위험이 있다.
  | 'PAYMENT_UNDER_REVIEW'
  | 'PAYMENT_VERIFY_FAILED'
  | 'PAYMENT_VERIFY_UNAVAILABLE'
  | 'PAYMENT_REVIEW_CHECK_UNAVAILABLE'
  // 주문 provenance + 실제 capture 검증 (P0-A/P0-B, 2026-07-15).
  | 'ORDER_PROVENANCE_MISSING'
  | 'ORDER_PRODUCT_MISMATCH'
  | 'ORDER_PROVENANCE_INVALID'
  | 'PAYMENT_PENDING_SETTLEMENT'
  | 'PAYMENT_NOT_CAPTURED'
  // 원자 발급 claim (P0, 2026-07-15). 둘 다 "다시 결제하지 마세요" 를 담고 있어 사전에 없으면
  // resolveErrorMessage 가 서버 한국어 details 로 폴백해 en/ja/zh 사용자가 경고를 못 읽고 재결제한다.
  | 'PLAN_GENERATION_IN_PROGRESS'
  | 'PLAN_ISSUANCE_CHECK_UNAVAILABLE'
  | 'PLAN_ISSUANCE_NEEDS_REVIEW'
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

  // 2026-08-24 (planner-trust-course, fail-closed success): a 200 only unlocks
  // quickSuccess/PurchaseSection when the body is shaped exactly like a usable
  // day-one preview — not merely present. Validation now lives in
  // `parseQuickPreviewResponse` (quickPreviewContract.ts), the SAME parser
  // `QuickPreviewCard` renders from — one shared reading of the payload, not
  // two independently-drifting ones.

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
    
    // 2026-08-24 (planner-trust-course, fail-closed retry budget): at most 2
    // HTTP attempts total, and the 2nd only happens after an actual transport
    // failure (fetch() itself throwing, typically TypeError) on the 1st. A
    // response the server actually sent — any 4xx/5xx, GEMINI_ERROR, or a
    // malformed 200 — is terminal and is never retried: retrying a real
    // validation/quota/city-mismatch rejection just repeats the same failure
    // (or double-spends a rate-limited/paid backend call) for no benefit.
    const MAX_ATTEMPTS = 2;
    const payload = JSON.stringify(buildQuickPreviewPayload(values, language));
    void posthogTrack('preview_requested', { language });

    function fail(code: PlannerErrorCode, details: string) {
      setErrorCode(code);
      setErrorMsg(details);
      setStatus('error');
      void posthogTrack('preview_degraded_or_failed', { language, code });
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch('/api/ai-planner-quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS && err instanceof TypeError) {
          console.warn(`[Planner] Network error on attempt ${attempt}, retrying...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        const p = normalizeFetchError(err);
        fail(p.code, p.details || (err instanceof Error ? err.message : 'Unknown error.'));
        return;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.details || errBody.error || `Server error (${res.status})`;
        const p = normalizeFetchError(new Error(msg), errBody.code, errBody.details);
        fail(p.code, p.details || msg);
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json || json.ok !== true || !parseQuickPreviewResponse(json.data, language)) {
        fail('INVALID_RESPONSE', 'The preview response was malformed.');
        return;
      }

      setResultQuick(json.data);
      setStatus('quickSuccess');
      void posthogTrack('preview_success', { language });
      setTimeout(() => {
        document.getElementById('planner-quick-result')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }
  }

  // 1b: Revision submit (2026-08-24, planner-trust-course, preserve paid revision
  // access). A revision link's city can be a historical non-10-chip city
  // (Sokcho/Tongyeong/Andong/...) that the new quick-preview exact-city gate
  // (cityResolver's UNSUPPORTED_CITY/CITY_MISMATCH) would reject outright — but
  // the traveler already paid for that plan and is entitled to regenerate it.
  // So a revision submit never calls /api/ai-planner-quick at all: it just
  // stashes the (possibly-old-city) form values for handleRevisionRegenerate
  // and flips to the same 'quickSuccess' status the real flow uses, so
  // PurchaseSection's existing revision branch (gated on revisionMode +
  // revisionPlanId, not on resultQuick's contents) renders. `resultQuick` gets
  // a placeholder object, not real preview data — PlannerPage hides
  // QuickPreviewCard in revision mode, and PurchaseSection's revision branch
  // never reads resultQuick's fields.
  async function handleRevisionSubmit(values: PlannerFormValues) {
    lastValues.current = values;
    setResultQuick({ __revisionPlaceholder: true });
    setStatus('quickSuccess');
  }

  // LOCKED region -- handlePaymentSuccess lifted verbatim from legacy PlannerPage.tsx L1414-1493
  // 2: PayPal payment success -> Full AI plan generation (paid)
  async function handlePaymentSuccess(paypalOrderId: string, aiCouponCode?: string) {
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
      // feat/guest-anon-auth-pii: 비로그인 게스트 + 플래그 ON 일 때만 별도 익명 토큰 헤더.
      // 플래그 OFF 또는 로그인 사용자 = {} → fetch 헤더 동일 (기존 동작 불변).
      const guestAnonHeaders = await getGuestAnonHeader(!!authHeaders.Authorization);
      // 2026-08-24 (planner-intent-v1): the ONE builder NEW and REVISION both
      // call — see src/pages/PlannerPage/lib/plannerIntent.ts. `flat` carries
      // every travel-preference field (backward-compatible key names); the
      // few keys below (paypalOrderId/aiCouponCode/identity/routing `area`)
      // are request-mechanics, not travel intent, so they stay here.
      const { flat } = buildFullPlannerIntentPayload(values, language);
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders, ...guestAnonHeaders },
        signal: controller.signal,
        body: JSON.stringify({
          paypalOrderId,
          aiCouponCode,  // P1-②: AI 무료 쿠폰 코드 (있으면 paymentGate 가 0원 통과 — paypalOrderId 없이도)
          guestName: 'Guest',
          email: userEmail,
          uid: values.uid || null,
          language,
          // area 는 client-only 라우팅 그룹 키 — plannerIntent.ts 의 intent 필드가
          // 아니라 이 호출부에서만 파생(첫 도시 기준).
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          ...flat,
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

      // P1 보완 (운영자 2026-07-11): 여기서는 이벤트를 발화하지 않는다 — 이 시점은 API 가
      // streaming 을 "수락"한 것일 뿐 플랜 완성이 아니다(최종 실패 가능). pending marker 만
      // 심고, PlanDetailPage(usePlanCompletionTracking)가 Firestore plan.status 'ready' 확정
      // 시 정확히 1회 발화 / 'error' 면 발화 없이 marker 폐기.
      try {
        const newPlanId = data?.planId
          || (typeof data?.planUrl === 'string' ? (data.planUrl.split('/my-plans/')[1] || '').split('?')[0] : '');
        if (newPlanId) {
          markPlannerPendingComplete(newPlanId, { durationDays: values.durationDays, freeCoupon: !!aiCouponCode });
        }
      } catch { /* analytics 실패 무시 — navigate 를 막지 않음 */ }

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
      // feat/guest-anon-auth-pii: revision 경로는 Authorization 필수(위에서 throw)이므로
      // guestAnonHeaders 는 항상 {} = 동작 불변. 호출처 parity 위해 동일하게 spread.
      const guestAnonHeaders = await getGuestAnonHeader(!!authHeaders.Authorization);
      // 2026-08-24 (planner-intent-v1): the SAME builder handlePaymentSuccess
      // calls, so a revision can only ever differ by revision metadata/token/
      // route mechanics below — never by a silently-omitted travel preference
      // (this used to be missing recommended_zone/recommended_zones/
      // recommended_zone_address/hotelByCity entirely).
      const { flat } = buildFullPlannerIntentPayload(values, language, {
        reasonCodes: revisionReason,
        note: revisionNote,
        avoidStopNames: avoidList,
      });
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders, ...guestAnonHeaders },
        signal: controller.signal,
        body: JSON.stringify({
          revisionOf: revisionPlanId,
          revisionToken: revisionToken,
          guestName: 'Guest',
          email: userEmail,
          uid: values.uid || null,
          language,
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          ...flat,
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

  // Retry after a failed quick preview: clear the request, keep the brief.
  //
  // 2026-08-10: this used to end with `window.scrollTo({ top: 0 })`. The wizard
  // stays mounted across the error, so every answer was still there — a screen
  // and a half above where the traveller had been reading. Where to put them
  // back is the page's call (PlannerPage focuses and reveals the wizard), not
  // this hook's, which knows nothing about the layout.
  function handleReset() {
    setStatus('idle');
    setResultQuick(null);
    setErrorMsg(null);
    setErrorCode(null);
    setUserEmail('');
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
    handleRevisionSubmit,
    handlePaymentSuccess,
    handleRevisionRegenerate,
    handleReset,
  };
}
