// useTourRating — Google Places runtime 호출 없이 검증된 internal 집계만 반환.
// 함수 시그니처와 반환 타입은 기존 호출부 호환을 위해 유지한다.

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

export function useTourRating(_tourId: string, fallback: Fallback): ResolvedRating {
  return {
    rating: fallback.rating,
    reviewCount: fallback.reviewCount,
    reviewSource: fallback.reviewSource,
  };
}
