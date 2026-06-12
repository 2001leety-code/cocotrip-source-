/**
 * PR-B: 투어 JSON-LD 가짜 평점 제거 회귀 테스트
 *
 * 검증 항목:
 * 1. 플래그 OFF(기본) → aggregateRating omit (#898 후속: 가짜 4.9/32 송출 제거)
 * 2. 플래그 ON + 실평점(rating>0, reviewCount>=1) → aggregateRating 실값
 * 3. 플래그 ON + 리뷰 없음(reviewCount=0) → aggregateRating 키 omit
 * 4. 플래그 ON + rating undefined → aggregateRating 키 omit
 * 5. 플래그 ON + reviewCount=1 경계값 → aggregateRating 실값 포함
 * 6. 항상: Schema.org 필수 필드(@context/@type/name/description/offers) 존재
 * 7. 항상: aggregateRating 있으면 @type=AggregateRating 포함
 */
import { describe, it, expect } from 'vitest';
import { buildTourJsonLd } from '@/pages/buildTourJsonLd';

const BASE_PARAMS = {
  slug: 'seoul-private-tour',
  tourTitle: 'Seoul Private Tour',
  tourSummary: 'A great tour of Seoul.',
  tourImage: 'https://cocotripkr.com/img/tour.jpg',
  tourPrice: 99.9,
};

describe('buildTourJsonLd — 플래그 OFF (기본)', () => {
  it('aggregateRating 키를 omit 함 (가짜 4.9/32 미송출)', () => {
    const result = buildTourJsonLd({ ...BASE_PARAMS, featureFlag: false });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('featureFlag 미전달 시에도 aggregateRating omit', () => {
    const result = buildTourJsonLd({ ...BASE_PARAMS });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('실평점 인자가 있어도 플래그 OFF면 aggregateRating omit', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      rating: 4.3,
      reviewCount: 7,
      featureFlag: false,
    });
    expect(result).not.toHaveProperty('aggregateRating');
  });
});

describe('buildTourJsonLd — 플래그 ON + 실평점 있음', () => {
  it('rating=4.7, reviewCount=15 → 실값 포함', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      rating: 4.7,
      reviewCount: 15,
      featureFlag: true,
    });
    expect(result.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.7',
      reviewCount: '15',
    });
  });

  it('reviewCount=1 경계값 → 실값 포함', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      rating: 5.0,
      reviewCount: 1,
      featureFlag: true,
    });
    expect(result.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '5',
      reviewCount: '1',
    });
  });
});

describe('buildTourJsonLd — 플래그 ON + 리뷰 없음 → omit', () => {
  it('reviewCount=0 → aggregateRating 키 없음', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      rating: 4.5,
      reviewCount: 0,
      featureFlag: true,
    });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('rating undefined → aggregateRating 키 없음', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      reviewCount: 5,
      featureFlag: true,
    });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('rating=0 → aggregateRating 키 없음', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      rating: 0,
      reviewCount: 5,
      featureFlag: true,
    });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('rating, reviewCount 둘 다 undefined → aggregateRating 키 없음', () => {
    const result = buildTourJsonLd({
      ...BASE_PARAMS,
      featureFlag: true,
    });
    expect(result).not.toHaveProperty('aggregateRating');
  });
});

describe('buildTourJsonLd — Schema.org 필수 필드 (플래그 무관)', () => {
  const variants = [
    { desc: '플래그 OFF', featureFlag: false as boolean | undefined },
    { desc: '플래그 ON + 실평점', featureFlag: true as boolean | undefined, rating: 4.5, reviewCount: 10 },
    { desc: '플래그 ON + 리뷰 없음', featureFlag: true as boolean | undefined },
  ];

  for (const v of variants) {
    it(`${v.desc} — @context/@type/name/description/offers 존재`, () => {
      const result = buildTourJsonLd({ ...BASE_PARAMS, ...v });
      expect(result['@context']).toBe('https://schema.org');
      expect(result['@type']).toBe('Product');
      expect(result.name).toBe(BASE_PARAMS.tourTitle);
      expect(result.description).toBe(BASE_PARAMS.tourSummary);
      expect(result.offers).toBeDefined();
    });
  }

  it('실평점(플래그 ON)일 때 aggregateRating @type=AggregateRating 포함', () => {
    const result = buildTourJsonLd({ ...BASE_PARAMS, rating: 4.5, reviewCount: 12, featureFlag: true });
    const ar = result.aggregateRating as Record<string, string>;
    expect(ar['@type']).toBe('AggregateRating');
  });

  it('offers 구조: @type/url/priceCurrency/price/availability 존재', () => {
    const result = buildTourJsonLd({ ...BASE_PARAMS });
    const offers = result.offers as Record<string, unknown>;
    expect(offers['@type']).toBe('Offer');
    expect(offers.priceCurrency).toBe('USD');
    expect(offers.price).toBe(BASE_PARAMS.tourPrice);
    expect(offers.availability).toBe('https://schema.org/InStock');
    expect(offers.url).toContain(BASE_PARAMS.slug);
  });
});
