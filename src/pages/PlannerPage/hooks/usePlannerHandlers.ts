// Planner page state handlers -- extracted verbatim from legacy PlannerPage.tsx.
// LOCKED region -- handlePaymentSuccess lifted verbatim.
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlannerFormValues } from '@/components/PlannerForm';
import { cityNameToAreaKey } from '../lib/formatters';

interface UsePlannerHandlersOptions {
  language: string;
  userEmail: string;
  setUserEmail: (email: string) => void;
}

type Status = 'idle' | 'loadingQuick' | 'quickSuccess' | 'loadingFull' | 'fullSuccess' | 'error';

export function usePlannerHandlers({ language, userEmail, setUserEmail }: UsePlannerHandlersOptions) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [resultQuick, setResultQuick] = useState<Record<string, unknown> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setStreamStep] = useState<number>(0);
  const [, setStreamAgent] = useState<string>('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const lastValues = useRef<PlannerFormValues | null>(null);

  // 1: Quick preview (free) -- ai-planner-quick call with auto-retry
  async function handleSubmit(values: PlannerFormValues) {
    lastValues.current = values;
    setStatus('loadingQuick');
    setResultQuick(null);
    setErrorMsg(null);
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
          throw new Error(msg);
        }

        const data = await res.json();
        setResultQuick(data);
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
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error.');
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
    setStreamStep(1);
    setStreamAgent('gemini');

    const values = lastValues.current;
    if (!values) {
      setPlanError('Form data missing. Please try again.');
      setIsGeneratingPlan(false);
      return;
    }

    try {
      // 120s timeout -- prevents infinite spinner on Vercel function failure
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        }),
      });

      clearTimeout(timeoutId);

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned invalid response (${res.status}). Please contact us via WhatsApp.`);
      }

      if (!res.ok) {
        throw new Error(data.details || data.error || `Server error (${res.status})`);
      }

      setStreamStep(4);
      setStreamAgent('done');

      if (data.planUrl) {
        navigate(data.planUrl);
      } else if (data.planId) {
        navigate(`/my-plans/${data.planId}`);
      } else {
        throw new Error('Plan created but no URL returned');
      }
    } catch (err: unknown) {
      console.error('[PlannerPage] Plan generation failed:', err);
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Server took too long (120s). Your payment is safe \u2014 please contact us via WhatsApp to get your plan.'
        : (err instanceof Error ? err.message : 'Something went wrong. Please contact us via WhatsApp.');
      setPlanError(msg);
      setIsGeneratingPlan(false);
    }
  }

  // 3: Free revision regeneration (consumes revisionCredits)
  async function handleRevisionRegenerate(values: PlannerFormValues, revisionPlanId: string, revisionToken: string | null) {
    if (!revisionPlanId) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    setStreamStep(1);
    setStreamAgent('gemini');

    try {
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || `Server error (${res.status})`);

      setStreamStep(4);
      setStreamAgent('done');

      if (data.planUrl) navigate(data.planUrl);
      else if (data.planId) navigate(`/my-plans/${data.planId}`);
      else throw new Error('Plan created but no URL returned');
    } catch (err: unknown) {
      console.error('[PlannerPage] Revision failed:', err);
      setPlanError(err instanceof Error ? err.message : 'Revision failed. Please contact us via WhatsApp.');
      setIsGeneratingPlan(false);
    }
  }

  function handleReset() {
    setStatus('idle');
    setResultQuick(null);
    setErrorMsg(null);
    setUserEmail('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return {
    status,
    resultQuick,
    errorMsg,
    isGeneratingPlan,
    planError,
    lastValues,
    handleSubmit,
    handlePaymentSuccess,
    handleRevisionRegenerate,
    handleReset,
  };
}
