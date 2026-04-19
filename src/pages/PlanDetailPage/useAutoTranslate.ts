// Auto-translate plan itinerary when header language changes.
// LOCKED region — extracted verbatim from src/pages/PlanDetailPage.tsx (L92-139) during P2
// Lock release. Logic MUST stay byte-identical (originalItineraryRef, AbortController
// cleanup, `[language, planLoaded]` dep array, fetch to /api/translate-plan).
import { useEffect, useRef, useState } from 'react';

export function useAutoTranslate(
  plan: any,
  setPlan: (updater: (prev: any) => any) => void,
  language: string,
): { isTranslating: boolean } {
  const originalItineraryRef = useRef<any>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  // NOTE: we watch `planLoaded` (boolean) instead of `plan` object identity so this effect
  //   fires exactly once when the Firestore snapshot first lands, and thereafter only when
  //   the user switches language. Watching plan directly would re-trigger on every Firestore
  //   update and re-translate unnecessarily.
  const planLoaded = !!plan?.itinerary;
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
        setPlan((prev: any) => prev ? { ...prev, itinerary: originalItineraryRef.current } : prev);
      }
      return;
    }
    // Translate to target language
    const controller = new AbortController();
    setIsTranslating(true);
    (async () => {
      try {
        const resp = await fetch('/api/translate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: originalItineraryRef.current || plan.itinerary, targetLang }),
          signal: controller.signal,
        });
        const data = await resp.json();
        if (data.translated) {
          setPlan((prev: any) => prev ? { ...prev, itinerary: data.translated } : prev);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[translate] failed:', e);
      } finally {
        setIsTranslating(false);
      }
    })();
    return () => { controller.abort(); setIsTranslating(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, planLoaded]);

  return { isTranslating };
}
