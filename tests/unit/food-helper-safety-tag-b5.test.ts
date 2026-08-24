// ─────────────────────────────────────────────────────────────────────────────
// B5 (P309, 2026-05-30) — 검증식당 SAFETY tag 폴백 차단 회귀 테스트
//
// 배경: _food_helper.js 가 할랄/비건 식당 부족 시 일반식당으로 채우고 "Verified
//   Halal Restaurants" 헤더 + verified:true 도장을 찍음 → 무슬림에게 돼지/소고기집
//   추천 (busan '돼지나무사랑걸렸네', '감천사골소머리곰탕' 실측 누출).
//
// P309 fix:
//   1. getTagsForDiet: SAFETY tag (halal/vegan) 존재 시 cuisine 선호(Meat 등)가
//      'general' 태그를 추가하지 못하게 차단 → Halal+Meat 가 ['halal','general'] 대신
//      ['halal'] 이 됨.
//   2. getFoodContext Step 2: hasSafetyTag 시 general 폴백 절대 금지.
//
// 본 테스트: getTagsForDiet 가 SAFETY tag 조합에서 general 을 섞지 않는지 검증.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
// @ts-expect-error — _food_helper.js 는 JS 모듈 (타입 선언 없음)
import { getTagsForDiet } from '../../api/_food_helper.js';

describe('B5 (P309) — getTagsForDiet SAFETY tag 폴백 차단', () => {
  it('Halal 단독 → [halal] (general 없음)', () => {
    expect(getTagsForDiet(['Halal'])).toEqual(['halal']);
  });

  it('Vegan 단독 → [vegan] (general 없음)', () => {
    expect(getTagsForDiet(['Vegan'])).toEqual(['vegan']);
  });

  it('🔴 SAFETY 핵심: Halal + Meat → [halal] (general 누출 금지)', () => {
    // 이전 버그: ['halal','general'] → 일반 고기집이 Verified Halal 로 오표기.
    const tags = getTagsForDiet(['Halal', 'Meat']);
    expect(tags).toContain('halal');
    expect(tags).not.toContain('general');
  });

  it('🔴 SAFETY 핵심: Vegan + Seafood + Spicy → [vegan] (general 누출 금지)', () => {
    const tags = getTagsForDiet(['Vegan', 'Seafood', 'Spicy']);
    expect(tags).toContain('vegan');
    expect(tags).not.toContain('general');
  });

  it('Halal + Vegan 동시 → [halal, vegan] (general 없음)', () => {
    const tags = getTagsForDiet(['Halal', 'Vegan']);
    expect(tags).toEqual(expect.arrayContaining(['halal', 'vegan']));
    expect(tags).not.toContain('general');
  });

  it('SAFETY tag 없는 cuisine 선호 (Meat) → [general] (정상 폴백 유지)', () => {
    // SAFETY tag 없으면 general 정상 — 일반식당 추천 가능해야 함.
    expect(getTagsForDiet(['Meat'])).toEqual(['general']);
  });

  it('Meat + Seafood (SAFETY 없음) → [general] (중복 제거)', () => {
    expect(getTagsForDiet(['Meat', 'Seafood'])).toEqual(['general']);
  });

  it('2026-08-24: 레거시 알레르겐 값(Nuts) 단독 → [general] (allergen 태그 제거됨, 안전 무시)', () => {
    // 알레르겐 4종(Nuts/Shellfish/Gluten/Dairy) 입력은 wizard 에서 제거됨(data.tsx ALLERGY_KEYS).
    // 레거시 클라이언트/저장된 세션이 여전히 보내면 default 분기로 떨어져 general 로 처리된다.
    expect(getTagsForDiet(['Nuts'])).toEqual(['general']);
  });

  it('🔴 SAFETY: Halal + 레거시 Nuts → [halal] (general 없음, Nuts 는 무해 무시)', () => {
    const tags = getTagsForDiet(['Halal', 'Nuts']);
    expect(tags).toEqual(['halal']);
    expect(tags).not.toContain('general');
  });

  it('빈 dietPrefs → [general] (기존 동작 보존)', () => {
    expect(getTagsForDiet([])).toEqual(['general']);
    expect(getTagsForDiet(undefined as never)).toEqual(['general']);
  });
});
