/**
 * MRT 벤치마킹 P4 — 투어 상세 페이지 위시리스트 하트 + 자사 투어 크로스셀 2장
 * (2026-08-19). TourDetailPage 는 Firebase(useTour)를 물고 있어 이 레포의 기존 관례대로
 * (tour-detail-mrt-p1.test.ts, tour-detail-mrt-p3.test.ts) 렌더 대신 소스 문자열로 배선을
 * 확인한다. getRelatedTours 는 순수 함수라 직접 import 해서 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getRelatedTours, TOURS } from '../../src/data/tours';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const pageSrc = read('../../src/pages/TourDetailPage.tsx');
const cssSrc = read('../../src/styles/editorial-tour-detail.css');
const copySrc = read('../../src/pages/tourDetailEditorialCopy.ts');
const analyticsSrc = read('../../src/lib/analytics.ts');

const BANNED = [/특가/, /인기/, /베스트/, /\bpopular\b/i, /\bbest\b/i, /\bdeal\b/i];

// ─────────────────────────────────────────────────────────────────────────────
describe('getRelatedTours — 카탈로그 전 투어에 대해', () => {
  for (const tour of TOURS) {
    it(`${tour.id}: 정확히 2개, 자기 자신 제외, id 중복 없음`, () => {
      const result = getRelatedTours(tour, 2);
      expect(result).toHaveLength(2);
      expect(result.some((t) => t.id === tour.id)).toBe(false);
      expect(new Set(result.map((t) => t.id)).size).toBe(result.length);
    });

    it(`${tour.id}: 동일 지역 투어가 있으면 교차 지역 채움보다 앞에 온다`, () => {
      const sameRegionExists = TOURS.some((t) => t.id !== tour.id && t.region === tour.region);
      const result = getRelatedTours(tour, 2);
      if (sameRegionExists) {
        expect(result[0].region).toBe(tour.region);
      }
    });

    it(`${tour.id}: 결정적 — 두 번 호출해도 같은 결과`, () => {
      const first = getRelatedTours(tour, 2).map((t) => t.id);
      const second = getRelatedTours(tour, 2).map((t) => t.id);
      expect(second).toEqual(first);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TourDetailPage.tsx — 위시리스트 배선', () => {
  it('WishlistToggle 을 import 한다', () => {
    expect(pageSrc).toContain("import { WishlistToggle } from '@/components/WishlistButton'");
  });

  it('WishlistToggle 을 productType="tour" 로 렌더한다', () => {
    const idx = pageSrc.indexOf('<WishlistToggle');
    expect(idx).toBeGreaterThan(-1);
    const block = pageSrc.slice(idx, pageSrc.indexOf('/>', idx));
    expect(block).toContain('productType="tour"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TourDetailPage.tsx — 크로스셀 섹션 배선', () => {
  it('getRelatedTours 와 TourCard 를 import 한다', () => {
    expect(pageSrc).toContain('getRelatedTours');
    expect(pageSrc).toContain("import { TourCard } from '@/components/tours/TourCard'");
  });

  it('trackTourRelatedClick 을 import 하고 호출한다', () => {
    expect(pageSrc).toMatch(/import\s*\{[^}]*trackTourRelatedClick[^}]*\}\s*from\s*'@\/lib\/analytics'/);
    expect(pageSrc).toContain('trackTourRelatedClick(');
  });

  it('tour-detail-related-section 은 세부 일정/취소정책 다음, tour-detail-hotel-section 앞에 온다', () => {
    const itineraryIdx = pageSrc.indexOf('id="itinerary"');
    const cancellationIdx = pageSrc.indexOf('<TourCancellationSection');
    const relatedIdx = pageSrc.indexOf('tour-detail-related-section');
    const hotelIdx = pageSrc.indexOf('tour-detail-hotel-section');
    expect(itineraryIdx).toBeGreaterThan(-1);
    expect(cancellationIdx).toBeGreaterThan(-1);
    expect(relatedIdx).toBeGreaterThan(-1);
    expect(hotelIdx).toBeGreaterThan(-1);
    expect(relatedIdx).toBeGreaterThan(itineraryIdx);
    expect(relatedIdx).toBeGreaterThan(cancellationIdx);
    expect(relatedIdx).toBeLessThan(hotelIdx);
  });

  it('TourCard 가 크로스셀 grid 안에서 렌더된다', () => {
    const relatedIdx = pageSrc.indexOf('tour-detail-related-section');
    const hotelIdx = pageSrc.indexOf('tour-detail-hotel-section', relatedIdx);
    const block = pageSrc.slice(relatedIdx, hotelIdx);
    expect(block).toContain('tour-detail-related-grid');
    expect(block).toContain('<TourCard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('analytics.ts — trackTourRelatedClick', () => {
  it('존재하고 trackFunnel 을 tour_related_click 으로 호출한다 (noQueue 없음)', () => {
    const idx = analyticsSrc.indexOf('export function trackTourRelatedClick');
    expect(idx).toBeGreaterThan(-1);
    const block = analyticsSrc.slice(idx, analyticsSrc.indexOf('\n}', idx) + 2);
    expect(block).toContain("trackFunnel('tour_related_click'");
    expect(block).not.toContain('noQueue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tourDetailEditorialCopy.ts — relatedToursLabel', () => {
  it('4개 언어 객체 전부에 존재한다', () => {
    const matches = copySrc.match(/relatedToursLabel:\s*'[^']+'/g) || [];
    expect(matches).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CSS 잠금 — editorial-tour-detail.css', () => {
  it('.tour-detail-related-grid 가 존재한다', () => {
    expect(cssSrc).toContain('.tour-detail-related-grid');
  });

  it('그라디언트·backdrop-filter·hex 색상·!important 없이 토큰만 쓴다 (회귀 가드)', () => {
    expect(cssSrc).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(cssSrc).not.toMatch(/backdrop-filter/i);
    expect(cssSrc).not.toContain('!important');
    expect(cssSrc).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('무근거 마케팅 문구 금지 (특가/인기/베스트/popular/best/deal)', () => {
  const relatedToursLabelSrc = (copySrc.match(/relatedToursLabel:\s*'[^']*'/g) || []).join('\n');
  const relatedIdx = pageSrc.indexOf('tour-detail-related-section');
  const hotelIdx = pageSrc.indexOf('tour-detail-hotel-section', relatedIdx);
  const pageSliceSrc = relatedIdx > -1 && hotelIdx > -1 ? pageSrc.slice(relatedIdx, hotelIdx) : '';
  const trackFnIdx = analyticsSrc.indexOf('export function trackTourRelatedClick');
  const trackFnSrc = trackFnIdx > -1 ? analyticsSrc.slice(trackFnIdx, analyticsSrc.indexOf('\n}', trackFnIdx) + 2) : '';

  const surfaces = [
    { name: 'tourDetailEditorialCopy.ts (relatedToursLabel)', src: relatedToursLabelSrc },
    { name: 'TourDetailPage.tsx (related section slice)', src: pageSliceSrc },
    { name: 'analytics.ts (trackTourRelatedClick)', src: trackFnSrc },
  ];

  for (const { name, src } of surfaces) {
    for (const pattern of BANNED) {
      it(`${name} 은 ${pattern} 를 포함하지 않는다`, () => {
        expect(src).not.toMatch(pattern);
      });
    }
  }
});
