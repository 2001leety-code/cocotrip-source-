/**
 * 식이 SAFETY — 프로덕션 스키마(r.tag 문자열) 매칭 + payload 손상 throw 회귀 (2026-06-12 SAFETY 버그헌트).
 *
 * 🔴 버그: matchFoodPlaceholder 가 r.dietary_tags(배열)만 읽었는데 프로덕션 _food_index.json 은
 *    r.tag(단일 문자열, halal 109·vegan 188 row) → halal/vegan block_mode 매칭이 프로덕션에서 항상 0
 *    (fail-closed → legacy 폴백, 안전하나 block_mode 식이 매칭 죽음). 기존 테스트는 mock 에
 *    dietary_tags 배열을 써서 이 갭을 못 잡았음(테스트가 프로덕션 스키마를 안 봄). 이 테스트는
 *    프로덕션 스키마(r.tag)로 락 — dietaryTagsOf 가 tag·dietary_tags 둘 다 읽어 실제 동작 보장.
 */
import { describe, it, expect } from 'vitest';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';

// 프로덕션 _food_index.json 스키마: tag = 단일 문자열, dietary_tags 필드 없음.
const PROD_HALAL = { name: '서울 할랄식당', city: 'seoul', cuisine: 'Korean', rating: 4.5, reviewCount: 500, lat: 37.5717, lng: 126.9858, tag: 'halal' };
const PROD_GENERAL = { name: '서울 일반식당', city: 'seoul', cuisine: 'Korean', rating: 5, reviewCount: 3000, lat: 37.5717, lng: 126.9858, tag: 'general' };
const PROD_VEGAN = { name: '서울 비건식당', city: 'seoul', cuisine: 'Korean', rating: 4.6, reviewCount: 700, lat: 37.5717, lng: 126.9858, tag: 'vegan' };

describe('matchFoodPlaceholder — 프로덕션 스키마(r.tag 문자열) dietary 매칭', () => {
  const ph = { placeholder: 'verified_lunch', lat: 37.5717, lng: 126.9858 };

  it('halal 손님 → r.tag="halal" 식당만 (일반식당 평점 높아도 배제, SAFETY)', () => {
    const m = matchFoodPlaceholder(ph, [PROD_GENERAL, PROD_HALAL], 'seoul', ['halal'], new Set());
    expect(m?.name).toBe('서울 할랄식당');
  });
  it('vegan 손님 → r.tag="vegan" 식당만', () => {
    const m = matchFoodPlaceholder(ph, [PROD_GENERAL, PROD_VEGAN], 'seoul', ['vegan'], new Set());
    expect(m?.name).toBe('서울 비건식당');
  });
  it('halal 손님 + halal 식당 없음 → null (fail-closed, 일반식당 절대 안 줌)', () => {
    const m = matchFoodPlaceholder(ph, [PROD_GENERAL, PROD_VEGAN], 'seoul', ['halal'], new Set());
    expect(m).toBeNull();
  });
  it('제한 없는 손님 → 평점 높은 일반식당 정상 선택', () => {
    const m = matchFoodPlaceholder(ph, [PROD_GENERAL, PROD_HALAL], 'seoul', [], new Set());
    expect(m?.name).toBe('서울 일반식당');
  });
  it('legacy 스키마(dietary_tags 배열)도 여전히 매칭 (하위호환)', () => {
    const legacyHalal = { name: 'legacy 할랄', city: 'seoul', cuisine: 'Korean', rating: 4, reviewCount: 100, lat: 37.5717, lng: 126.9858, dietary_tags: ['halal'] };
    const m = matchFoodPlaceholder(ph, [PROD_GENERAL, legacyHalal], 'seoul', ['halal'], new Set());
    expect(m?.name).toBe('legacy 할랄');
  });
});

describe('shapeRequest — 식이/알레르기 payload 손상 throw (CLAUDE.md J silent drop 금지)', () => {
  const base = { city: 'Seoul', days: 2, language: 'en' };
  it('정상 배열 → 통과', () => {
    const r = shapeRequest({ ...base, dietPrefs: ['Halal'], allergies: ['Nuts'] }, 'a@b.com');
    expect(r.dietPrefs).toEqual(['Halal']);
    expect(r.allergies).toEqual(['Nuts']);
  });
  it('키 부재(미선택) → 빈배열 (정상, 현행 유지)', () => {
    const r = shapeRequest({ ...base }, 'a@b.com');
    expect(r.dietPrefs).toEqual([]);
    expect(r.allergies).toEqual([]);
  });
  it('dietPrefs 가 문자열(전송 손상) → throw (silent [] 금지)', () => {
    expect(() => shapeRequest({ ...base, dietPrefs: 'Halal' }, 'a@b.com')).toThrow(/INVALID_DIETARY_PAYLOAD/);
  });
  it('allergies 가 문자열(전송 손상) → throw', () => {
    expect(() => shapeRequest({ ...base, allergies: 'Nuts' }, 'a@b.com')).toThrow(/INVALID_DIETARY_PAYLOAD/);
  });
  it('allergies 가 객체(손상) → throw', () => {
    expect(() => shapeRequest({ ...base, allergies: { nuts: true } }, 'a@b.com')).toThrow(/INVALID_DIETARY_PAYLOAD/);
  });
});
