// Public translations share the API projection and bypass private caches.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { projectPublicPlan } from '@/lib/publicPlanProjection.js';
import type { PlanDocument, SetPlanFn } from './types';

const EXPECTED_TRANSLATOR_VERSION = 2;

/** SHA-256 of the exact translation source, stored instead of a source copy.
 * Resolves null when Web Crypto is unavailable or fails; callers then bypass the cache. */
export async function translationSourceFingerprint(sourceLang: string, itinerary: unknown): Promise<string | null> {
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof TextEncoder !== 'function') return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sourceLang, itinerary])));
    return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}

export interface AutoTranslateAccess {
  planId: string;
  publicView: boolean;
  allowCache: boolean;
  // Opaque viewer/data boundary, never a raw token. The page also clears stale plan data.
  accessKey: string;
}

export function useAutoTranslate(
  plan: PlanDocument | null,
  setPlan: SetPlanFn,
  language: string,
  access: AutoTranslateAccess | boolean = false,
): { isTranslating: boolean; translationError: string | null } {
  const planId = typeof access === 'boolean' ? String(plan?.id || plan?.planId || '') : access.planId;
  const publicView = typeof access === 'boolean' ? !access : access.publicView;
  const allowCache = !publicView && (typeof access === 'boolean' ? access : access.allowCache);
  const accessKey = typeof access === 'boolean' ? '' : access.accessKey;
  const originalLang = plan?.input?.language || 'en';
  const planLoaded = !!plan?.itinerary;
  const boundary = JSON.stringify([planId, accessKey, publicView, allowCache, originalLang]);
  const itineraryKey = JSON.stringify(plan?.itinerary || null);
  const [sourceState, setSourceState] = useState(() => ({
    boundary, source: plan, sourceKey: itineraryKey, appliedKey: '',
  }));
  // Own translation writes are not new originals; edits and streamed snapshots are.
  if (sourceState.boundary !== boundary
    || (itineraryKey !== sourceState.sourceKey && itineraryKey !== sourceState.appliedKey)) {
    setSourceState({ boundary, source: plan, sourceKey: itineraryKey, appliedKey: '' });
  }
  const sourceKey = sourceState.sourceKey;
  const requestKey = JSON.stringify([boundary, language, planLoaded, sourceKey]);
  const requestRef = useRef({ generation: 0, controller: null as AbortController | null });
  const [translationState, setTranslationState] = useState({ key: '', completed: false, error: null as string | null });
  const activeState = translationState.key === requestKey ? translationState : null;

  // Invalidate before passive effects. Old cache/API success, error and finally
  // callbacks cannot write through a newly committed plan/access/language boundary.
  useLayoutEffect(() => {
    // The tracker object is never replaced; cleanup aborts whichever controller is live then.
    const request = requestRef.current;
    request.controller?.abort();
    request.generation += 1;
    request.controller = null;
    return () => { request.controller?.abort(); };
  }, [requestKey]);

  useEffect(() => {
    const source = sourceState.source;
    if (!planLoaded || !source?.itinerary || sourceState.boundary !== boundary) return;
    const original = {
      source,
      itinerary: publicView ? (projectPublicPlan(source) as PlanDocument).itinerary : source.itinerary,
    };
    const controller = new AbortController();
    const generation = requestRef.current.generation;
    requestRef.current.controller = controller;
    const isCurrent = () => !controller.signal.aborted && requestRef.current.generation === generation;
    const safeItinerary = (itinerary: PlanDocument['itinerary']) => {
      if (!publicView) return itinerary;
      return (projectPublicPlan({ input: original.source.input, itinerary }, {
        language,
        privateSource: original.source,
      }) as PlanDocument).itinerary;
    };
    const apply = (itinerary: PlanDocument['itinerary']) => {
      if (!isCurrent()) return;
      const safe = safeItinerary(itinerary);
      setSourceState(previous => isCurrent() ? { ...previous, appliedKey: JSON.stringify(safe) } : previous);
      setPlan((previous) => isCurrent() && previous ? { ...previous, itinerary: safe } : previous);
    };
    const finish = (error: string | null) => {
      if (isCurrent()) setTranslationState({ key: requestKey, completed: true, error });
    };

    if (language === originalLang) {
      apply(original.itinerary);
      finish(null);
      return () => { controller.abort(); };
    }

    void (async () => {
      let error: string | null = null;
      try {
        // Owner cache entries are valid only for the exact source they were translated from.
        // Timestamps cannot order writes from other tabs, so legacy unbound entries miss.
        // Without a fingerprint the cache is neither read nor written; translation still runs.
        let sourceFingerprint: string | null = null;
        if (allowCache && planId) {
          sourceFingerprint = await translationSourceFingerprint(originalLang, original.itinerary);
          if (!isCurrent()) return;
        }
        if (sourceFingerprint) {
          try {
            const cache = await getDoc(doc(db, 'plans', planId, 'translations', language));
            if (!isCurrent()) return;
            if (cache.exists()) {
              const cached = cache.data();
              const version = (cached.translatorVersion as number | undefined) || 1;
              const stale = cached.sourceFingerprint !== sourceFingerprint || version < EXPECTED_TRANSLATOR_VERSION;
              if (cached.itinerary && !stale) {
                apply(cached.itinerary as PlanDocument['itinerary']);
                return;
              }
            }
          } catch (cacheError) {
            if (!isCurrent()) return;
            console.warn('[translate] cache read failed, falling back to API:', cacheError);
          }
        }
        if (!isCurrent()) return;
        const response = await fetch('/api/translate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: original.itinerary, targetLang: language }),
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        const json = await response.json();
        if (!isCurrent()) return;
        const payload = json?.data;
        if (!response.ok || !payload?.translated || typeof payload.translated !== 'object' || Array.isArray(payload.translated)) {
          throw new Error('Translation failed');
        }
        const translated = safeItinerary(payload.translated as PlanDocument['itinerary']);
        apply(translated);
        if (allowCache && planId && sourceFingerprint && isCurrent()) {
          try {
            await setDoc(doc(db, 'plans', planId, 'translations', language), {
              itinerary: translated,
              cachedAt: new Date().toISOString(),
              sourceLang: originalLang,
              sourceFingerprint,
              translatorVersion: (payload.translatorVersion as number | undefined) || EXPECTED_TRANSLATOR_VERSION,
            });
          } catch (writeError) {
            if (!isCurrent()) return;
            console.warn('[translate] cache write failed:', writeError);
          }
        }
      } catch (cause: unknown) {
        if (!isCurrent()) return;
        if (cause instanceof Error && cause.name !== 'AbortError') {
          console.error('[translate] failed:', cause);
          error = cause.message || 'Translation failed';
        }
      } finally {
        finish(error);
      }
    })();
    return () => { controller.abort(); };
  }, [boundary, requestKey, planLoaded, language, originalLang, allowCache, publicView, planId, setPlan,
    sourceState.source, sourceState.boundary]);

  return {
    isTranslating: planLoaded && language !== originalLang && !activeState?.completed,
    translationError: activeState?.error || null,
  };
}
