// ─────────────────────────────────────────────────────────────────────────────
// useTour — slug 로 투어 lookup. Firestore 우선 + 정적 tours.ts 폴백.
// (Phase 1, 2026-05-19)
//
// 마이그레이션 전략 (PHASE0 §F):
//   1. Firestore 의 published 투어 우선
//   2. 없으면 정적 TOURS_RAW (slug 매칭)
//   3. 둘 다 없으면 null
//
// Phase 4 (2026-05-19): URL ?preview=draft → 어드민이 발행 전 draft 미리보기.
//   - fetchDraft 우선 시도 → Firestore rules 가 admin 검증 (비-admin 은 자연 차단)
//   - draft 없거나 권한 없으면 published / 정적 폴백
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Tour } from '@/data/tours';
import { getTourBySlug } from '@/data/tours';
import { fetchTourBySlug, fetchDraft } from '@/lib/tours-firestore';

interface TourLoadState {
  tour: Tour | undefined;
  loading: boolean;
  error: Error | null;
  /** 'firestore' = 어드민 등록, 'static' = 코드, undefined = 아직 로드 중 / not found */
  source: 'firestore' | 'static' | undefined;
}

export interface UseTourState extends TourLoadState {
  retry: () => void;
}

type LocalTourState = 'ready' | 'loading' | 'error' | 'not-found' | 'permission' | 'partial' | 'empty';

const LOCAL_TOUR_STATES = new Set<LocalTourState>([
  'ready',
  'loading',
  'error',
  'not-found',
  'permission',
  'partial',
  'empty',
]);

function localFixtureKey(requested: string | null): LocalTourState | null {
  if (typeof window === 'undefined') return null;
  const { hostname } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
  if (!requested || !LOCAL_TOUR_STATES.has(requested as LocalTourState)) return null;
  return requested as LocalTourState;
}

function fixtureError(code?: string): Error {
  const error = new Error('Local tour-detail state fixture');
  if (code) Object.assign(error, { code });
  return error;
}

function buildLocalFixture(state: LocalTourState | null, slug: string | undefined): TourLoadState | null {
  if (!state) return null;
  const staticTour = slug ? getTourBySlug(slug) : undefined;

  if (state === 'loading') {
    return { tour: undefined, loading: true, error: null, source: undefined };
  }
  if (state === 'error') {
    return { tour: undefined, loading: false, error: fixtureError(), source: undefined };
  }
  if (state === 'permission') {
    return { tour: undefined, loading: false, error: fixtureError('permission-denied'), source: undefined };
  }
  if (state === 'not-found') {
    return { tour: undefined, loading: false, error: null, source: undefined };
  }
  if (state === 'partial') {
    return { tour: staticTour, loading: false, error: fixtureError(), source: staticTour ? 'static' : undefined };
  }
  if (state === 'empty') {
    return {
      tour: staticTour ? { ...staticTour, stops: [] } : undefined,
      loading: false,
      error: null,
      source: staticTour ? 'static' : undefined,
    };
  }
  return { tour: staticTour, loading: false, error: null, source: staticTour ? 'static' : undefined };
}

/** slug 로 투어 조회. Firestore → 정적 폴백. ?preview=draft 시 draft 우선. */
export function useTour(slug: string | undefined): UseTourState {
  const [searchParams] = useSearchParams();
  const previewDraft = searchParams.get('preview') === 'draft';
  const localState = localFixtureKey(searchParams.get('localTourState'));
  const fixture = buildLocalFixture(localState, slug);
  const [requestKey, setRequestKey] = useState(0);
  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  const [state, setState] = useState<TourLoadState>({
    tour: undefined,
    loading: !!slug,
    error: null,
    source: undefined,
  });

  useEffect(() => {
    if (localState) return;
    let cancelled = false;

    const commitInitialState = (nextState: TourLoadState) => {
      queueMicrotask(() => {
        if (!cancelled) setState(nextState);
      });
    };

    if (!slug) {
      commitInitialState({ tour: undefined, loading: false, error: null, source: undefined });
      return () => { cancelled = true; };
    }

    // 1) 정적 폴백 즉시 표시 (Firestore fetch 중에도 paint 가능)
    const staticTour = getTourBySlug(slug);
    if (staticTour) {
      commitInitialState({ tour: staticTour, loading: true, error: null, source: 'static' });
    } else {
      commitInitialState({ tour: undefined, loading: true, error: null, source: undefined });
    }

    // 2) Firestore lookup (draft 우선 if preview, else published)
    //    Firestore rules 가 draft read = admin only → 비-admin 은 자연스럽게 폴백.
    const firestoreLookup = previewDraft
      ? fetchDraft(slug).then((draft) => draft || fetchTourBySlug(slug))
      : fetchTourBySlug(slug);

    firestoreLookup
      .then((firestoreTour) => {
        if (cancelled) return;
        if (firestoreTour) {
          setState({ tour: firestoreTour, loading: false, error: null, source: 'firestore' });
        } else if (staticTour) {
          setState({ tour: staticTour, loading: false, error: null, source: 'static' });
        } else {
          setState({ tour: undefined, loading: false, error: null, source: undefined });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Firestore 실패 시 정적 폴백 유지 (운영 안정성)
        if (staticTour) {
          setState({ tour: staticTour, loading: false, error: err, source: 'static' });
        } else {
          setState({ tour: undefined, loading: false, error: err, source: undefined });
        }
      });

    return () => { cancelled = true; };
  }, [slug, previewDraft, requestKey, localState]);

  return { ...(fixture || state), retry };
}
