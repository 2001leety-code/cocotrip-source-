// useTourRating — 외부 키 설정됐으면 Tripadvisor/Google 우선, 아니면 internal fallback.
// 외부 호출 결과는 mount 후 setState로 바꾸므로 첫 렌더는 internal로 보이고 곧 외부로 갱신.
import { useEffect, useState } from 'react';
import { fetchBestExternalRating, hasAnyExternalReviewKey } from '@/lib/external-reviews';
import type { ExternalRating } from '@/lib/external-reviews';
import { getTourExternalIds } from '@/data/tour-external-ids';

export type ResolvedRating = {
  rating?: number;
  reviewCount?: number;
  reviewSource?: 'internal' | 'tripadvisor' | 'google';
  externalUrl?: string;
};

interface Fallback {
  rating?: number;
  reviewCount?: number;
  reviewSource?: 'internal' | 'tripadvisor' | 'google';
}

export function useTourRating(tourId: string, fallback: Fallback): ResolvedRating {
  const [external, setExternal] = useState<ExternalRating | null>(null);

  useEffect(() => {
    if (!hasAnyExternalReviewKey()) return;
    const ids = getTourExternalIds(tourId);
    if (!ids.tripadvisorLocationId && !ids.googlePlaceId) return;
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
