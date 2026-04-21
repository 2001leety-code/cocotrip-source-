// Auto-translate plan itinerary when header language changes.
// Option B: On-demand translation with Firestore cache.
//
// Flow:
//   1. Language change detected
//   2. If targetLang === originalLang → restore original (no API call)
//   3. Check Firestore cache: plans/{planId}/translations/{lang}
//   4. Cache HIT → apply cached translation instantly
//   5. Cache MISS → call /api/translate-plan → save result to Firestore → apply
//
// This approach ensures:
//   - First translation per language incurs one Gemini API call
//   - All subsequent visits load from Firestore cache (instant, free)
//   - PDF generation can also read from cache
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PlanDocument, SetPlanFn } from './types';

export function useAutoTranslate(
  plan: PlanDocument | null,
  setPlan: SetPlanFn,
  language: string,
): { isTranslating: boolean } {
  const originalItineraryRef = useRef<PlanDocument['itinerary'] | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  // NOTE: we watch `planLoaded` (boolean) instead of `plan` object identity so this effect
  //   fires exactly once when the Firestore snapshot first lands, and thereafter only when
  //   the user switches language. Watching plan directly would re-trigger on every Firestore
  //   update and re-translate unnecessarily.
  const planLoaded = !!plan?.itinerary;
  const planId: string = (plan as Record<string, unknown>)?.id as string || '';

  useEffect(() => {
    if (!planLoaded || !plan?.itinerary) return;
    // Store original itinerary on first load (never overwrite)
    if (!originalItineraryRef.current) {
      originalItineraryRef.current = JSON.parse(JSON.stringify(plan.itinerary));
    }
    const targetLang = language as string;
    // The plan's original language - restore when user switches back
    const originalLang = plan.input?.language || 'en';
    if (targetLang === originalLang) {
      // Restore original without API call
      if (originalItineraryRef.current) {
        setPlan((prev) => prev ? { ...prev, itinerary: originalItineraryRef.current! } : prev);
      }
      return;
    }

    // Translate to target language (with Firestore cache)
    const controller = new AbortController();
    setIsTranslating(true);
    (async () => {
      try {
        // --- Step 1: Check Firestore cache ---
        if (planId && planId.length > 0) {
          try {
            const cacheRef = doc(db, 'plans', planId as string, 'translations', targetLang);
            const cacheSnap = await getDoc(cacheRef);
            if (cacheSnap.exists()) {
              const cached = cacheSnap.data();
              if (cached?.itinerary) {
                // Stale cache detection: if plan was edited after cache was written, skip cache
                const planUpdatedAt = (plan as Record<string, unknown>).updatedAt as string | undefined;
                const cachedAt = cached.cachedAt as string | undefined;
                if (planUpdatedAt && cachedAt && planUpdatedAt > cachedAt) {
                  console.info('[translate] cache stale — plan edited after cache, re-translating');
                } else {
                  // Cache HIT — apply immediately
                  setPlan((prev) => prev ? { ...prev, itinerary: cached.itinerary as PlanDocument['itinerary'] } : prev);
                  setIsTranslating(false);
                  return;
                }
              }
            }
          } catch (cacheErr) {
            // Cache read failed (permissions, etc.) — fall through to API
            console.warn('[translate] cache read failed, falling back to API:', cacheErr);
          }
        }

        // --- Step 2: API call (cache MISS) ---
        const resp = await fetch('/api/translate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: originalItineraryRef.current || plan.itinerary, targetLang }),
          signal: controller.signal,
        });
        const json = await resp.json();
        const payload = json.data;
        if (payload.translated) {
          setPlan((prev) => prev ? { ...prev, itinerary: payload.translated } : prev);

          // --- Step 3: Write to Firestore cache ---
          if (planId && planId.length > 0) {
            try {
              const cacheRef = doc(db, 'plans', planId as string, 'translations', targetLang);
              await setDoc(cacheRef, {
                itinerary: payload.translated,
                cachedAt: new Date().toISOString(),
                sourceLang: originalLang,
              });
            } catch (writeErr) {
              // Non-critical: cache write failure doesn't affect UX
              console.warn('[translate] cache write failed:', writeErr);
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') console.error('[translate] failed:', e);
      } finally {
        setIsTranslating(false);
      }
    })();
    return () => { controller.abort(); setIsTranslating(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, planLoaded]);

  return { isTranslating };
}
