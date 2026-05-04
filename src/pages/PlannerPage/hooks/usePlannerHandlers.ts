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
      if (!authHeaders.Authorization) {
        clearTimeout(timeoutId);
        const e = new Error('Sign-in required to generate AI plan. Please sign in and try again.') as Error & { code?: string };
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
          // Sprint 2 #5: undecided-hotel zone hint forwarded to backend.
          recommended_zone: values.recommended_zone || '',
          // 2026-05-03: zone 대표 주소 (RouteAgent가 공항↔zone 경로 계산용 fallback).
          recommended_zone_address: values.recommended_zone_address || '',
        }),
      });

      clearTimeout(timeoutId);

      let json;
      try {
        json = await res.json();
      } catch {
        const e = new Error(`Server returned invalid response (${res.status}). Please contact us via WhatsApp.`) as Error & { code?: string };
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
  async function handleRevisionRegenerate(values: PlannerFormValues, revisionPlanId: string, revisionToken: string | null) {
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
