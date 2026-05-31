// JSON-LD 빌더 — 순수함수 (firebase/React 의존 0 → CI 테스트에서 직접 import 가능).
// PR-B: TourDetailPage.tsx 에서 분리 (테스트가 TourDetailPage 전체를 import 하면
//   src/lib/firebase.js getAuth() 가 CI(키 없음)에서 throw → "0 test" 실패. 순수 모듈로 격리.)
// VITE_FEATURE_REAL_TOUR_RATINGS === 'true' 일 때만 실 평점 사용.
// OFF(기본) 또는 리뷰 없음 → 하드코딩 4.9/32 유지 (byte-identical 현재 동작).
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

  const aggregateRating: Record<string, string> | null = hasValidRating
    ? {
        '@type': 'AggregateRating',
        ratingValue: String(rating),
        reviewCount: String(reviewCount),
      }
    : useRealRatings
      ? null  // 플래그 ON + 리뷰 없음 → omit
      : {
          '@type': 'AggregateRating',
          ratingValue: '4.9',
          reviewCount: '32',
        };

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
