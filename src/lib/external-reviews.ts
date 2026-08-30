// External review compatibility surface.
// Google Places runtime 호출은 비용 hard-stop 정책으로 비활성화했다.
// 기존 import/타입 호환을 위해 export 모양은 유지하고 항상 internal fallback 을 사용한다.

export type ExternalRating = {
  rating: number;
  reviewCount: number;
  source: 'google';
  /** 외부 리뷰 페이지 직링크 (사용자 클릭 시 새 탭). */
  externalUrl?: string;
};

/** Runtime 외부 리뷰 호출은 항상 비활성. */
export function hasAnyExternalReviewKey(): boolean {
  return false;
}

/**
 * 이전 Google Places 호출부와의 빌드 호환용 no-op.
 */
export async function fetchGooglePlacesRating(placeId: string): Promise<ExternalRating | null> {
  void placeId;
  return null;
}

/**
 * 이전 외부 평점 선택 호출부와의 빌드 호환용 no-op.
 */
export async function fetchBestExternalRating(ids: { googlePlaceId?: string }): Promise<ExternalRating | null> {
  void ids;
  return null;
}
