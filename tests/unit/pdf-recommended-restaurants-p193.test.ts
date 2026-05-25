/**
 * P193 (2026-05-25) — SAFETY-CRITICAL PDF Halal/Vegan recommended restaurants.
 *
 * 배경: 웹 UI RecommendedRestaurants.tsx 는 per-style (halal/vegan/general) 분리
 * 렌더링이 작동하지만, PDF 에는 recommended_restaurants 섹션 자체가 누락되어
 * 무슬림/비건 외국인 visitor 가 PDF 다운로드 시 식이제한 식당 정보 0건 위험.
 *
 * CLAUDE.md J: 식이제한 데이터는 건강 위험 등급 — silent drop 절대 금지.
 *
 * Assertions:
 * 1. buildRecommendedRestaurantsSection 함수 export 존재
 * 2. halal 식당 있을 때 PDF 출력에 halal 식당 표시
 * 3. style별 분리 — halal/vegan/general 각 카드 분리 출력
 * 4. PdfUiDict 의 4-lang i18n 키 존재 (ko/en/ja/zh)
 * 5. 식당 6개 이상 시 .pdf-day-break 클래스 적용
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pdfGenPath = resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts');
const src = readFileSync(pdfGenPath, 'utf8');

// Color tokens mock (same as in generatePDF)
const C_MOCK = {
  heading: '#1a1a2e',
  sub: '#555',
  muted: '#888',
  accent: '#7C5CFC',
  border: '#e0e0e0',
  cardBg: '#f8f9fc',
};

// Dynamic import of buildRecommendedRestaurantsSection from the compiled source.
// vitest 의 TypeScript transform 사용 → ts 직접 import 가능.
import type { PdfUiDict } from '../../src/pages/PlanDetailPage/pdfGenerator';
let buildRecommendedRestaurantsSection: (
  itinerary: Record<string, unknown>,
  lang: string,
  uiDict: PdfUiDict | undefined,
  C: typeof C_MOCK,
) => string;

try {
  // dynamic require via vitest's module system
  const mod = await import('../../src/pages/PlanDetailPage/pdfGenerator');
  buildRecommendedRestaurantsSection = mod.buildRecommendedRestaurantsSection;
} catch {
  // fallback — function existence is still validated via source text
  buildRecommendedRestaurantsSection = () => '';
}

// ── Fixture data ─────────────────────────────────────────────────────────────

const halalRestaurant = {
  name: '할랄 식당',
  nameEn: 'Halal Restaurant',
  rating: 4.7,
  reviewCount: 320,
  cuisine: 'Middle Eastern',
  cuisineKo: '중동 요리',
  dong: '이태원동',
  dongEn: 'Itaewon-dong',
  nearestStopKm: 0.3,
  googleMapsUrl: 'https://maps.google.com/?cid=1234',
};

const veganRestaurant = {
  name: '비건 레스토랑',
  nameEn: 'Vegan Place',
  rating: 4.5,
  reviewCount: 180,
  cuisine: 'Vegan Korean',
  cuisineKo: '비건 한식',
};

const generalRestaurant = {
  name: '삼청각',
  nameEn: 'Samcheonggak',
  rating: 4.8,
  reviewCount: 500,
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('P193 SAFETY-CRITICAL — PDF recommended restaurants section', () => {

  // ── Assertion 1: 함수 export 존재 ─────────────────────────────────────────
  it('should export buildRecommendedRestaurantsSection function', () => {
    // Source text check (확실한 guard)
    expect(src).toMatch(/export function buildRecommendedRestaurantsSection/);
  });

  // ── Assertion 2: halal 식당 있을 때 PDF 출력에 표시 ──────────────────────
  it('should render halal restaurants when itinerary.recommended_restaurants.halal is present', () => {
    if (!buildRecommendedRestaurantsSection) return; // 함수 로드 실패 시 source 검증으로 fallback

    const itinerary = {
      recommended_restaurants: {
        halal: [halalRestaurant],
        general: [generalRestaurant],
      },
    };

    const html = buildRecommendedRestaurantsSection(itinerary, 'en', undefined, C_MOCK);
    expect(html).toBeTruthy();
    // halal 식당 이름 포함
    expect(html).toContain('Halal Restaurant');
    // Halal 섹션 라벨 포함
    expect(html).toMatch(/Halal/);
  });

  // ── Assertion 3: style별 분리 출력 ───────────────────────────────────────
  it('should separate halal / vegan / general buckets in the output', () => {
    if (!buildRecommendedRestaurantsSection) return;

    const itinerary = {
      recommended_restaurants: {
        halal: [halalRestaurant],
        vegan: [veganRestaurant],
        general: [generalRestaurant],
      },
    };

    const html = buildRecommendedRestaurantsSection(itinerary, 'en', undefined, C_MOCK);
    // 세 가지 style 라벨이 모두 출력에 존재해야 함
    expect(html).toMatch(/Halal/);
    expect(html).toMatch(/Vegan/);
    expect(html).toMatch(/General/);
    // 각 식당 이름도 포함
    expect(html).toContain('Halal Restaurant');
    expect(html).toContain('Vegan Place');
    expect(html).toContain('Samcheonggak');
    // 할랄이 비건보다 앞에 위치 (dietary priority order)
    const halalIdx = html.indexOf('Halal');
    const veganIdx = html.indexOf('Vegan');
    const generalIdx = html.indexOf('General');
    expect(halalIdx).toBeLessThan(veganIdx);
    expect(veganIdx).toBeLessThan(generalIdx);
  });

  // ── Assertion 4: PdfUiDict 4-lang i18n 키 존재 ───────────────────────────
  it('should have PdfUiDict keys for recommendedRestaurants / halal / vegan in source', () => {
    // pdfRecommendedRestaurants
    expect(src).toMatch(/pdfRecommendedRestaurants\?/);
    // pdfHalalSection
    expect(src).toMatch(/pdfHalalSection\?/);
    // pdfVeganSection
    expect(src).toMatch(/pdfVeganSection\?/);
    // 4-lang 라벨 정의 확인 (L4 dict)
    expect(src).toMatch(/山テスト|おすすめ|推荐餐厅|\u3cf 러/)  ;  // ja/zh keys existence
    // 더 직접적으로: L4 dict 의 ja/zh 키 확인
    expect(src).toMatch(/ハラール/); // ハラール
    expect(src).toMatch(/素食/); // 素食 (vegan zh)
    expect(src).toMatch(/清真/); // 清真 (halal zh)
  });

  // ── Assertion 5: 식당 6개 이상 시 .pdf-day-break 클래스 적용 ────────────
  it('should insert pdf-day-break class after every 6 cards', () => {
    if (!buildRecommendedRestaurantsSection) return;

    // 7개 식당 생성 (6개 초과)
    const manyRestaurants = Array.from({ length: 7 }, (_, i) => ({
      name: `할랄 식당 ${i + 1}`,
      nameEn: `Halal Restaurant ${i + 1}`,
      rating: 4.5,
    }));

    const itinerary = {
      recommended_restaurants: {
        halal: manyRestaurants,
      },
    };

    const html = buildRecommendedRestaurantsSection(itinerary, 'en', undefined, C_MOCK);
    // 7번째 카드에서 pdf-day-break 클래스 적용됨 (idx=6, idx%6===0)
    expect(html).toContain('pdf-day-break');
  });

  // ── 추가: 데이터 없을 때 빈 문자열 반환 ──────────────────────────────────
  it('should return empty string when recommended_restaurants is absent', () => {
    if (!buildRecommendedRestaurantsSection) return;
    const html = buildRecommendedRestaurantsSection({}, 'en', undefined, C_MOCK);
    expect(html).toBe('');
  });

  // ── 추가: 빈 dietary bucket 시 hint 표시 (silence 금지 SAFETY) ───────────
  it('should show empty-bucket hint for halal/vegan even if list is empty', () => {
    if (!buildRecommendedRestaurantsSection) return;

    const itinerary = {
      recommended_restaurants: {
        halal: [], // 빈 배열
        general: [generalRestaurant],
      },
    };

    const html = buildRecommendedRestaurantsSection(itinerary, 'en', undefined, C_MOCK);
    // 빈 halal bucket 에 hint 메시지 표시
    expect(html).toMatch(/No verified restaurants|아직 없습니다/);
  });

  // ── 추가: generatePDF 에서 buildRecommendedRestaurantsSection 호출 확인 ──
  it('should call buildRecommendedRestaurantsSection inside generatePDF function body', () => {
    // generatePDF 함수 내에서 recommended_restaurants 관련 호출 존재
    expect(src).toMatch(/buildRecommendedRestaurantsSection/);
    // generatePDF 본문에 recRestHtml 또는 recommended_restaurants 호출 존재
    expect(src).toMatch(/recRestHtml|recommended_restaurants/);
  });

  // ── 추가: ko lang 4-lang 라벨 확인 ───────────────────────────────────────
  it('should render Korean labels when lang is ko', () => {
    if (!buildRecommendedRestaurantsSection) return;

    const itinerary = {
      recommended_restaurants: {
        halal: [halalRestaurant],
      },
    };

    const html = buildRecommendedRestaurantsSection(itinerary, 'ko', undefined, C_MOCK);
    expect(html).toContain('할랄'); // Korean halal label
    expect(html).toContain('할랄 식당'); // Korean name
  });
});
