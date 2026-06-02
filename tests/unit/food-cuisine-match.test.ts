/**
 * matchFoodPlaceholder cuisine 필드 매칭 회귀 가드 (2026-06-02, plan 279c7ce0).
 *
 * 버그: api/_food_index.json 은 `cuisine` 필드("Dessert"/"Cafe"/"Korean")를 쓰는데
 * matchFoodPlaceholder 의 type 필터(L462)가 `r.type || r.category` 만 봐서 verified_cafe
 * 후보가 전부 빈 문자열로 탈락 → "[추천 verified_cafe - 지역]" placeholder. 서울 cafe/dessert
 * 356개가 있는데 0건 매칭했음 (시뮬 확인). fix: rType 에 r.cuisine 폴백 추가.
 */
import { describe, it, expect } from 'vitest';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';

const idx = [
  { name: '카페A', city: 'seoul', cuisine: 'Cafe', rating: 4.5, reviews: 100, lat: 37.5, lng: 127.0, dietary_tags: [] },
  { name: '디저트B', city: 'seoul', cuisine: 'Dessert', rating: 4.7, reviews: 200, lat: 37.5, lng: 127.0, dietary_tags: [] },
  { name: '한식C', city: 'seoul', cuisine: 'Korean', rating: 4.8, reviews: 300, lat: 37.5, lng: 127.0, dietary_tags: [] },
];

describe('matchFoodPlaceholder cuisine 매칭 (plan 279c7ce0 verified_cafe placeholder fix)', () => {
  it('verified_cafe → cuisine=Cafe/Dessert 매칭 (food_index 는 type 필드 없이 cuisine 사용)', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe' }, idx, 'seoul', [], new Set());
    expect(m, 'verified_cafe 가 cuisine 필드로 매칭돼야 함 (NULL = placeholder 회귀)').toBeTruthy();
    expect(['Cafe', 'Dessert']).toContain(m.cuisine);
  });
  it('verified_cafe → 한식(non-cafe cuisine) 은 제외', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe' }, idx, 'seoul', [], new Set());
    expect(m.cuisine).not.toBe('Korean');
  });
  it('verified_lunch(isCafe=false) → cuisine 무관 매칭 (type 필터 미적용)', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, idx, 'seoul', [], new Set());
    expect(m).toBeTruthy();
  });
});
