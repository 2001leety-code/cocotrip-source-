// JSON-LD 빌더 — 순수함수 (firebase/React 의존 0 → CI 테스트에서 직접 import 가능).
// PR-B: TourDetailPage.tsx 에서 분리 (테스트가 TourDetailPage 전체를 import 하면
//   src/lib/firebase.js getAuth() 가 CI(키 없음)에서 throw → "0 test" 실패. 순수 모듈로 격리.)
// VITE_FEATURE_REAL_TOUR_RATINGS === 'true' + 실제 검증 평점이 있을 때만 aggregateRating 송출.
// OFF(기본) 또는 검증 평점 없음 → aggregateRating 완전 omit.
// (#898 후속) 이전에는 하드코딩 4.9/32 를 Google JSON-LD 로 송출 = 가짜 집계 평점 =
// 구글 리치결과에 허위 별점 표시 → 소비자 보호/허위광고 리스크. 가짜 fallback 제거.
export function buildTourJsonLd(params: {
  slug: string;
  tourTitle: string;
  tourSummary: string;
  tourImage: string;
  tourPrice: number | string;
  rating?: number;
  reviewCount?: number;
  featureFlag?: boolean;
}): Record<string, unknown> {
  const {
    slug, tourTitle, tourSummary, tourImage, tourPrice,
    rating, reviewCount, featureFlag,
  } = params;

  const useRealRatings = featureFlag === true;
  const hasValidRating =
    useRealRatings &&
    typeof rating === 'number' &&
    rating > 0 &&
    typeof reviewCount === 'number' &&
    reviewCount >= 1;

  // 검증된 실제 평점이 있을 때만 aggregateRating 포함. 그 외(플래그 OFF/평점 없음)는 omit —
  // 가짜 별점을 구글 리치결과에 송출하지 않기 위함 (#898 후속, 법적 위험).
  const aggregateRating: Record<string, string> | null = hasValidRating
    ? {
        '@type': 'AggregateRating',
        ratingValue: String(rating),
        reviewCount: String(reviewCount),
      }
    : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: tourTitle,
    description: tourSummary,
    image: tourImage,
    brand: { '@type': 'Brand', name: 'CocoTrip' },
    offers: {
      '@type': 'Offer',
      url: `https://cocotripkr.com/tours/${slug}`,
      priceCurrency: 'USD',
      price: tourPrice,
      availability: 'https://schema.org/InStock',
    },
  };
  if (aggregateRating !== null) {
    jsonLd.aggregateRating = aggregateRating;
  }
  return jsonLd;
}
