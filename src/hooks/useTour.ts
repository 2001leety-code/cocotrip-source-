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
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Tour } from '@/data/tours';
import { getTourBySlug } from '@/data/tours';
import { fetchTourBySlug, fetchDraft } from '@/lib/tours-firestore';

interface UseTourState {
  tour: Tour | undefined;
  loading: boolean;
  error: Error | null;
  /** 'firestore' = 어드민 등록, 'static' = 코드, undefined = 아직 로드 중 / not found */
  source: 'firestore' | 'static' | undefined;
}

/** slug 로 투어 조회. Firestore → 정적 폴백. ?preview=draft 시 draft 우선. */
export function useTour(slug: string | undefined): UseTourState {
  const [searchParams] = useSearchParams();
  const previewDraft = searchParams.get('preview') === 'draft';

  const [state, setState] = useState<UseTourState>({
    tour: undefined,
    loading: !!slug,
    error: null,
    source: undefined,
  });

  useEffect(() => {
    if (!slug) {
      setState({ tour: undefined, loading: false, error: null, source: undefined });
      return;
    }

    let cancelled = false;

    // 1) 정적 폴백 즉시 표시 (Firestore fetch 중에도 paint 가능)
    const staticTour = getTourBySlug(slug);
    if (staticTour) {
      setState({ tour: staticTour, loading: true, error: null, source: 'static' });
    }

    // 2) Firestore lookup (draft 우선 if preview, else published)
    //    Firestore rules 가 draft read = admin only → 비-admin 은 자연스럽게 폴백.
    const firestoreLookup = previewDraft
      ? fetchDraft(slug).then((draft) => draft ?? fetchTourBySlug(slug))
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
  }, [slug, previewDraft]);

  return state;
}
