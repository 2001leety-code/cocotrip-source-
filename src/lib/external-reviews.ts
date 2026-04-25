// External review fetcher (Tripadvisor / Google Places).
// 환경 변수 미설정 시 자동으로 internal fallback. 실제 API 통합은 사용자 키 발급 후.
//
// Required env (Vite):
//   VITE_TRIPADVISOR_API_KEY        — Tripadvisor Content API key
//   VITE_GOOGLE_PLACES_API_KEY      — Google Places New API key
//
// Tour 별 외부 ID 매핑은 src/data/tour-external-ids.ts 에 정의 (사용자가 발급 후 채움).

export type ExternalRating = {
  rating: number;
  reviewCount: number;
  source: 'tripadvisor' | 'google';
  /** 외부 리뷰 페이지 직링크 (사용자 클릭 시 새 탭). */
  externalUrl?: string;
};

const TRIPADVISOR_KEY = (import.meta as ImportMeta & { env?: { VITE_TRIPADVISOR_API_KEY?: string } }).env?.VITE_TRIPADVISOR_API_KEY;
const GOOGLE_PLACES_KEY = (import.meta as ImportMeta & { env?: { VITE_GOOGLE_PLACES_API_KEY?: string } }).env?.VITE_GOOGLE_PLACES_API_KEY;

/** 외부 API 키가 하나라도 설정됐는지 (UI에서 fetch 시도 여부 결정용). */
export function hasAnyExternalReviewKey(): boolean {
  return Boolean(TRIPADVISOR_KEY || GOOGLE_PLACES_KEY);
}

/**
 * Tripadvisor Content API location_id 기준 평점 가져오기.
 * 키 미설정 시 null 반환 (UI에서 internal fallback).
 */
export async function fetchTripadvisorRating(locationId: string): Promise<ExternalRating | null> {
  if (!TRIPADVISOR_KEY || !locationId) return null;
  try {
    const url = `https://api.content.tripadvisor.com/api/v1/location/${locationId}/details?language=en&key=${TRIPADVISOR_KEY}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json() as { rating?: string; num_reviews?: string; web_url?: string };
    const rating = parseFloat(data.rating || '0');
    const reviewCount = parseInt(data.num_reviews || '0', 10);
    if (!rating || !reviewCount) return null;
    return { rating, reviewCount, source: 'tripadvisor', externalUrl: data.web_url };
  } catch {
    return null;
  }
}

/**
 * Google Places (New) API place_id 기준 평점 가져오기.
 * 키 미설정 시 null 반환.
 */
export async function fetchGooglePlacesRating(placeId: string): Promise<ExternalRating | null> {
  if (!GOOGLE_PLACES_KEY || !placeId) return null;
  try {
    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=rating,userRatingCount,googleMapsUri&key=${GOOGLE_PLACES_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { rating?: number; userRatingCount?: number; googleMapsUri?: string };
    if (!data.rating || !data.userRatingCount) return null;
    return { rating: data.rating, reviewCount: data.userRatingCount, source: 'google', externalUrl: data.googleMapsUri };
  } catch {
    return null;
  }
}

/**
 * 외부 평점 우선순위 fetch. Tripadvisor → Google → null.
 * @param ids { tripadvisorLocationId?, googlePlaceId? }
 */
export async function fetchBestExternalRating(ids: { tripadvisorLocationId?: string; googlePlaceId?: string }): Promise<ExternalRating | null> {
  if (ids.tripadvisorLocationId) {
    const ta = await fetchTripadvisorRating(ids.tripadvisorLocationId);
    if (ta) return ta;
  }
  if (ids.googlePlaceId) {
    const g = await fetchGooglePlacesRating(ids.googlePlaceId);
    if (g) return g;
  }
  return null;
}
