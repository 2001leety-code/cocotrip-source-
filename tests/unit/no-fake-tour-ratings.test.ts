/**
 * #898 후속 — 투어 상세/목록 가짜 평점 제거 회귀 가드 (fix/tour-detail-ratings).
 *
 * 이전: TOUR_META 에 투어별 rating 4.7~4.9 + 허구 reviewCount(23~142, reviewSource:'internal')
 *       이 박혀 있어 TourCard·TourDetailPage 평점칩·리뷰 집계블록·정렬·buildTourJsonLd 가
 *       전부 근거 없는 별점을 노출. /preview/mobile-tour 목업도 '4.9 (128 reviews)' +
 *       허구 후기(Emma L./Kenji T./Sofia M.) 를 표시. 소비자 보호/허위광고 리스크.
 *
 * 검증 가능한 실제 평점만 노출(useTourRating→Google Places 키, ReviewList→Firestore 실후기).
 * 이 테스트는 가짜 집계 평점·후기가 다시 들어오면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TOURS } from '../../src/data/tours';
import { buildTourJsonLd } from '../../src/pages/buildTourJsonLd';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('투어 데이터에 허구 집계 평점이 없다', () => {
  it('어떤 투어도 하드코딩 rating/reviewCount 를 갖지 않는다', () => {
    for (const tour of TOURS) {
      expect(tour.rating, `${tour.id} rating`).toBeUndefined();
      expect(tour.reviewCount, `${tour.id} reviewCount`).toBeUndefined();
      expect(tour.reviewSource, `${tour.id} reviewSource`).toBeUndefined();
    }
  });

  it('tours.ts 소스에 객체 리터럴 rating: 4.x / reviewCount 가 없다', () => {
    const src = read('src/data/tours.ts');
    expect(src).not.toMatch(/rating:\s*4\.\d/);
    expect(src).not.toMatch(/reviewCount:\s*\d/);
  });
});

describe('JSON-LD 는 검증 평점 없이는 aggregateRating 을 송출하지 않는다', () => {
  const BASE = {
    slug: 'seoul-private-tour',
    tourTitle: 'Seoul Private Tour',
    tourSummary: 'A great tour.',
    tourImage: 'https://cocotripkr.com/img/tour.jpg',
    tourPrice: 99,
  };

  it('플래그 OFF → aggregateRating omit (가짜 4.9/32 미송출)', () => {
    const result = buildTourJsonLd({ ...BASE, featureFlag: false });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('플래그 미전달 → aggregateRating omit', () => {
    const result = buildTourJsonLd({ ...BASE });
    expect(result).not.toHaveProperty('aggregateRating');
  });

  it('buildTourJsonLd.ts 소스에 하드코딩 4.9/32 가 없다', () => {
    const src = read('src/pages/buildTourJsonLd.ts');
    expect(src).not.toMatch(/ratingValue:\s*'4\.9'/);
    expect(src).not.toMatch(/reviewCount:\s*'32'/);
  });
});

describe('모바일 투어 상세 목업에 허구 후기/평점이 없다', () => {
  it('/preview/mobile-tour 에 4.9 별점·128 reviews·허구 후기 이름이 없다', () => {
    const src = read('src/pages/MobileTourDetailV2.tsx');
    expect(src).not.toMatch(/>\s*4\.9\s*</);
    expect(src).not.toMatch(/128 reviews/);
    for (const name of ['Emma L.', 'Kenji T.', 'Sofia M.']) {
      expect(src).not.toContain(name);
    }
  });
});
