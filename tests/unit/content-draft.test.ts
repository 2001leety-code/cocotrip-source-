import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js, no type decls
import { selectFoodMaterials, pickDailyMaterial, kstDayIndex } from '../../api/_shared/contentDraftSelector.js';
// @ts-expect-error — ESM .js
import { buildContentPrompt } from '../../api/_shared/contentPromptBuilder.js';
// @ts-expect-error — ESM .js
import { parseContentJson, sanitizeDraft, formatDraftMessage } from '../../api/_shared/contentDraftFormat.js';

// 2026-06-10 마케팅 콘텐츠 직원 — 머지 전 로컬 검증($0). 순수함수만, Gemini X.

const FOOD = [
  { name: '종로 한식집', nameEn: 'Jongno Hansik', city: 'seoul', dong: '종로', rating: 4.8, reviewCount: 1200, cuisine: 'Korean', cuisineKo: '한식', priceLabel: '₩10,000-20,000', priceLabelKo: '1-2만원', placeId: 'A' },
  { name: '부산 회집', nameEn: 'Busan Hoejip', city: 'busan', dong: '해운대', rating: 4.6, reviewCount: 300, cuisine: 'Seafood', cuisineKo: '해산물', priceLabel: 'Unknown', priceLabelKo: '미정', placeId: 'B' },
  { name: '저품질', nameEn: 'Low', city: 'seoul', rating: 4.0, reviewCount: 1000, placeId: 'C' },          // 평점 미달
  { name: '리뷰부족', nameEn: 'FewReviews', city: 'seoul', rating: 4.9, reviewCount: 10, placeId: 'D' },    // 리뷰 미달
  { name: '대전집', nameEn: 'Daejeon', city: 'daejeon', rating: 4.9, reviewCount: 500, placeId: 'E' },      // 화이트리스트 밖
  { name: '영문명없음', nameEn: '', city: 'seoul', rating: 4.9, reviewCount: 500, placeId: 'F' },           // nameEn 누락
];

describe('selectFoodMaterials — 필터·정규화·결정적 정렬', () => {
  const mats = selectFoodMaterials(FOOD);
  it('고품질(4.5+,리뷰50+) + 화이트리스트(seoul/busan) + 필수필드 = 2곳', () => {
    expect(mats.map((m: any) => m.name)).toEqual(['종로 한식집', '부산 회집']); // placeId A,B 정렬
  });
  it("Unknown/미정 가격 → 빈 문자열 (가격 주장 안 함)", () => {
    const busan = mats.find((m: any) => m.city === 'busan');
    expect(busan.priceLabel).toBe('');
    expect(busan.priceLabelKo).toBe('');
  });
  it('cityLabel 한글 매핑', () => {
    expect(mats.find((m: any) => m.city === 'seoul').cityLabel).toBe('서울');
  });
  it('빈/undefined 입력 → [] (throw 없음)', () => {
    expect(selectFoodMaterials([])).toEqual([]);
    expect(selectFoodMaterials(undefined)).toEqual([]);
  });
});

describe('pickDailyMaterial / kstDayIndex — 결정적 rotation', () => {
  const mats = selectFoodMaterials(FOOD);
  it('같은 dayIndex = 같은 소재, 다음 날 = 다른 소재', () => {
    expect(pickDailyMaterial(mats, 0)).toBe(mats[0]);
    expect(pickDailyMaterial(mats, 1)).toBe(mats[1]);
    expect(pickDailyMaterial(mats, 2)).toBe(mats[0]); // wrap (2곳)
  });
  it('빈 리스트 → null', () => {
    expect(pickDailyMaterial([], 5)).toBeNull();
  });
  it('kstDayIndex 결정적 (같은 시각=같은 인덱스)', () => {
    const d = new Date('2026-06-10T02:00:00Z');
    expect(kstDayIndex(d)).toBe(kstDayIndex(d));
    expect(kstDayIndex(new Date('2026-06-11T02:00:00Z'))).toBe(kstDayIndex(d) + 1);
  });
});

describe('buildContentPrompt — 사실 주입 + 금지 지시', () => {
  const { systemInstruction, userPrompt } = buildContentPrompt(selectFoodMaterials(FOOD)[0]); // 종로 한식집
  it('주입한 사실(이름/평점/가격)이 프롬프트에 포함', () => {
    expect(userPrompt).toContain('종로 한식집');
    expect(userPrompt).toContain('4.8');
    expect(userPrompt).toContain('1-2만원');
  });
  it('새 사실 금지 + 식이주장 금지 지시 포함', () => {
    expect(systemInstruction).toContain('지어내지');
    expect(systemInstruction).toMatch(/할랄|비건|식이/);
  });
});

describe('parseContentJson — 코드펜스/잡텍스트 방어', () => {
  it('순수 JSON', () => {
    expect(parseContentJson('{"variants":[],"hashtags":[]}')).toEqual({ variants: [], hashtags: [] });
  });
  it('```json 펜스 제거', () => {
    expect(parseContentJson('```json\n{"variants":[1]}\n```')).toEqual({ variants: [1] });
  });
  it('앞뒤 잡텍스트 중 {} 추출', () => {
    expect(parseContentJson('여기 있어요: {"a":1} 끝')).toEqual({ a: 1 });
  });
  it('파싱 불가 → null', () => {
    expect(parseContentJson('not json')).toBeNull();
    expect(parseContentJson(null)).toBeNull();
  });
});

describe('sanitizeDraft — 식이주장 폐기 (SAFETY)', () => {
  it('할랄/비건 주장 variant 제거', () => {
    const d = sanitizeDraft({ variants: [
      { hook: '정보', ko: '여긴 할랄 인증 식당', en: 'halal certified' },
      { hook: '감성', ko: '따뜻한 한 끼', en: 'A warm meal' },
    ], hashtags: ['#서울', '#halal'] });
    expect(d.variants).toHaveLength(1);
    expect(d.variants[0].hook).toBe('감성');
    expect(d.hashtags).toEqual(['#서울']); // #halal 제거
  });
  it('전부 식이주장 → null (폐기)', () => {
    expect(sanitizeDraft({ variants: [{ ko: '비건 천국', en: 'vegan' }] })).toBeNull();
  });
  it('구조 이상 → null', () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft({ variants: 'x' })).toBeNull();
  });
});

describe('formatDraftMessage — 사실 카드 + graceful', () => {
  const m = selectFoodMaterials(FOOD)[0]; // 종로
  it('정상 draft → 사실 카드 + variants + 발행 안내', () => {
    const msg = formatDraftMessage(m, { variants: [{ hook: '감성', ko: '맛있다', en: 'Yummy' }], hashtags: ['#서울맛집'] });
    expect(msg).toContain('종로 한식집');
    expect(msg).toContain('맛있다');
    expect(msg).toContain('발행은 직접');
  });
  it('draft null(AI 실패) → 사실 카드 + 실패 안내 (throw 없음)', () => {
    const msg = formatDraftMessage(m, null);
    expect(msg).toContain('종로 한식집');     // 사실 카드는 코드가 렌더 = 항상
    expect(msg).toContain('생성 실패');
  });
});
