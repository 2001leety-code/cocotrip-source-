/**
 * 회귀 잠금 (2026-07-28) — 서버 PDF 템플릿 누락.
 *
 * prod 는 VITE_USE_SERVER_PDF=true 라 손님이 실제로 받는 PDF 는 **서버판**이다.
 * 그런데 서버 템플릿에는 클라이언트 템플릿에 있던
 *   · 추천 식당(할랄/비건) — P193 SAFETY (health-risk 등급, silent drop 금지)
 *   · 예산표
 *   · 번역 (일/중/한 손님도 영어 PDF 를 받았다)
 * 이 통째로 없었다. 이 테스트가 그 재발을 막는다.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRecommendedRestaurantsSection,
  buildBudgetTableHtml,
  pdfLabels,
  pdfCategoryBar,
} from '../../api/_shared/pdf-sections.js';

const C = {
  accent: '#7C5CFC', pink: '#EA536E', heading: '#1a1a2e',
  sub: '#555', muted: '#888', cardBg: '#f8f9fc', border: '#e0e0e0',
};

const halalPlace = {
  name: '이태원 할랄식당', nameEn: 'Itaewon Halal', rating: 4.6, reviewCount: 1234,
  cuisine: 'Halal Korean', dong: '이태원동', dongEn: 'Itaewon-dong',
  nearestStopKm: 1.2, googleMapsUrl: 'https://maps.google.com/?q=1',
};

describe('서버 PDF — 추천 식당 (P193 SAFETY)', () => {
  it('할랄·비건 bucket 이 general 보다 먼저 나온다', () => {
    const html = buildRecommendedRestaurantsSection({
      recommended_restaurants: {
        general: [{ name: '일반식당' }],
        halal: [halalPlace],
        vegan: [{ name: '비건식당' }],
      },
    }, 'ko', C);
    const iHalal = html.indexOf('할랄');
    const iVegan = html.indexOf('비건');
    const iGeneral = html.indexOf('일반');
    expect(iHalal).toBeGreaterThan(-1);
    expect(iHalal).toBeLessThan(iVegan);
    expect(iVegan).toBeLessThan(iGeneral);
  });

  it('식이제한 bucket 이 비어도 침묵하지 않는다 (없다고 명시)', () => {
    const html = buildRecommendedRestaurantsSection({
      recommended_restaurants: { halal: [], general: [{ name: '일반식당' }] },
    }, 'ko', C);
    expect(html).toContain('아직 없습니다');
  });

  it('식이제한 배지 색이 일반과 다르다 (오독 = 안전 사고)', () => {
    const html = buildRecommendedRestaurantsSection({
      recommended_restaurants: { halal: [halalPlace], general: [{ name: '일반식당' }] },
    }, 'en', C);
    expect(html).toContain('#15803d');   // halal green
    expect(html).not.toContain('background:#7C5CFC;padding:2px 8px;border-radius:3px;margin-bottom:8px;">Halal');
  });

  it('4개 국어 라벨이 각각 나온다', () => {
    const data = { recommended_restaurants: { halal: [halalPlace] } };
    expect(buildRecommendedRestaurantsSection(data, 'ko', C)).toContain('할랄');
    expect(buildRecommendedRestaurantsSection(data, 'en', C)).toContain('Halal');
    expect(buildRecommendedRestaurantsSection(data, 'ja', C)).toContain('ハラール');
    expect(buildRecommendedRestaurantsSection(data, 'zh', C)).toContain('清真');
  });

  it('데이터가 없으면 빈 섹션을 그리지 않는다', () => {
    expect(buildRecommendedRestaurantsSection({}, 'en', C)).toBe('');
    expect(buildRecommendedRestaurantsSection({ recommended_restaurants: {} }, 'en', C)).toBe('');
    expect(buildRecommendedRestaurantsSection({ recommended_restaurants: { halal: [] } }, 'en', C)).toBe('');
  });

  it('식당명·주소가 HTML 이스케이프된다', () => {
    const html = buildRecommendedRestaurantsSection({
      recommended_restaurants: { general: [{ name: '<script>alert(1)</script>', address: 'A & B' }] },
    }, 'ko', C);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
  });
});

describe('서버 PDF — 예산표', () => {
  const budget = [
    { day: 1, transport_krw: 12000, entry_fees_krw: 8000, meals_krw: 30000, total_krw: 50000 },
    { day: 2, transport_krw: 5000, entry_fees_krw: 0, meals_krw: 25000, total_krw: 30000 },
  ];

  it('일자별 행 + 합계가 나온다', () => {
    const html = buildBudgetTableHtml(budget, 'ko', C);
    expect(html).toContain('예산 요약');
    expect(html).toContain('₩50,000');
    expect(html).toContain('₩30,000');
    expect(html).toContain('₩80,000');   // 합계
  });

  it('행이 없으면 빈 표를 그리지 않는다', () => {
    expect(buildBudgetTableHtml([], 'ko', C)).toBe('');
    expect(buildBudgetTableHtml(undefined as never, 'ko', C)).toBe('');
  });

  it('머리글이 손님 언어로 나온다', () => {
    expect(buildBudgetTableHtml(budget, 'ja', C)).toContain('予算まとめ');
    expect(buildBudgetTableHtml(budget, 'zh', C)).toContain('预算汇总');
  });
});

describe('서버 PDF — 실제 렌더 결과 (buildPlanHtml)', () => {
  const plan = {
    input: { language: 'ja', startDate: '2026-08-01', adults: 2 },
    itinerary: {
      tour_title: 'Seoul 3 Days',
      days: [{
        day: 1, theme: 'Palaces',
        stops: [
          { start_time: '09:00', display_name: '경복궁', category: 'landmark', description: 'desc', tip: 'go early' },
          { start_time: '12:00', display_name: '광장시장', category: 'food' },
        ],
      }],
      daily_budget_summary: [{ day: 1, transport_krw: 5000, entry_fees_krw: 3000, meals_krw: 20000, total_krw: 28000 }],
      recommended_restaurants: { halal: [halalPlace], vegan: [], general: [{ name: '일반식당' }] },
      arrival_guide: {
        airport: 'ICN',
        steps: [{ step: 1, title: 'Immigration', description: 'Follow signs', est_min: 40 }],
      },
    },
  };

  it('식이제한 섹션·예산표·손님 언어가 모두 최종 HTML 에 들어간다', async () => {
    const { buildPlanHtml } = await import('../../api/pdf/generate.js');
    const html = buildPlanHtml(plan);
    expect(html).toContain('ハラール');        // P193 식이제한 섹션 (일본어 손님)
    expect(html).toContain('予算まとめ');       // 예산표
    expect(html).toContain('入国ガイド');       // 가이드 제목 번역 — 예전엔 영어 고정
    expect(html).toContain('₩28,000');
    expect(html).not.toContain('Budget Summary'); // 영어 하드코딩 잔재 없음
  });

  it('stop 카드에 카테고리 색 바가 붙는다', async () => {
    const { buildPlanHtml } = await import('../../api/pdf/generate.js');
    const html = buildPlanHtml(plan);
    expect(html).toContain('border-left-color:#3B82F6');  // landmark
    expect(html).toContain('border-left-color:#EA580C');  // food
  });
});

describe('서버 PDF — 라벨·카테고리 색', () => {
  it('모르는 언어는 영어로 떨어진다', () => {
    expect(pdfLabels('fr').budgetSummary).toBe('Budget Summary');
    expect(pdfLabels(undefined as never).budgetSummary).toBe('Budget Summary');
  });

  it('카테고리 색이 웹 팔레트와 같고 모르는 값은 기본색', () => {
    expect(pdfCategoryBar('food')).toBe('#EA580C');
    expect(pdfCategoryBar('nature')).toBe('#059669');
    expect(pdfCategoryBar('unknown')).toBe('#7C5CFC');
    expect(pdfCategoryBar(undefined)).toBe('#7C5CFC');
  });
});
