// useTourRating — 외부 키 설정됐으면 Google Places 우선, 아니면 internal fallback.
// 외부 호출 결과는 mount 후 setState로 바꾸므로 첫 렌더는 internal로 보이고 곧 외부로 갱신.
// tour-external-ids.ts 삭제됨 (5/25 sweep) — 아직 Google Place ID 미발급.
// 발급 후: 이 파일에 직접 Record<string, { googlePlaceId: string }> 인라인 추가.
import { useEffect, useState } from 'react';
import { fetchBestExternalRating, hasAnyExternalReviewKey } from '@/lib/external-reviews';
import type { ExternalRating } from '@/lib/external-reviews';

export type ResolvedRating = {
  rating?: number;
  reviewCount?: number;
  reviewSource?: 'internal' | 'google';
  externalUrl?: string;
};

interface Fallback {
  rating?: number;
  reviewCount?: number;
  reviewSource?: 'internal' | 'google';
}

export function useTourRating(tourId: string, fallback: Fallback): ResolvedRating {
  const [external, setExternal] = useState<ExternalRating | null>(null);

  useEffect(() => {
    if (!hasAnyExternalReviewKey()) return;
    // tour-external-ids.ts 삭제됨 — 빈 객체 반환과 동일 동작 유지.
    const ids: { googlePlaceId?: string } = {};
    if (!ids.googlePlaceId) return;
    let cancelled = false;
    fetchBestExternalRating(ids).then((r) => {
      if (!cancelled) setExternal(r);
    });
    return () => { cancelled = true; };
  }, [tourId]);

  if (external) {
    return {
      rating: external.rating,
      reviewCount: external.reviewCount,
      reviewSource: external.source,
      externalUrl: external.externalUrl,
    };
  }
  return {
    rating: fallback.rating,
    reviewCount: fallback.reviewCount,
    reviewSource: fallback.reviewSource,
  };
}
