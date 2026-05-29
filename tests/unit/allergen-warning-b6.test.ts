// ─────────────────────────────────────────────────────────────────────────────
// B6 (P310, 2026-05-30) — 알레르기 4종 텍스트 검출 회귀 테스트 (SAFETY-CRITICAL)
//
// 배경: checkDietaryViolation 은 halal/vegan/vegetarian 만 분기 → Nuts/Shellfish/
//   Gluten/Dairy 검사 전무. 견과류 알레르기 손님이 견과 식당 추천받을 위험.
//
// P310 fix: validateResponse 에 checkAllergenWarnings 추가.
//   - severity='warning' (P280 v1 무한 retry 사고 회피 — critical 절대 금지)
//   - 명시적 재료명만 (한식 hidden allergen false-positive 회피)
//   - admin 가시화 우선
//
// 본 테스트: validateResponse (export) 를 통해 allergen_warning 박제 + severity 검증.
//   ⭐ 핵심: severity 가 'warning' 이지 'critical' 이 아님 (retry loop 차단 보증).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
// @ts-expect-error — responseValidator.js 는 JS 모듈 (타입 선언 없음)
import { validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';

function planWith(foodStops: Array<Record<string, unknown>>) {
  return {
    days: [{ day: 1, stops: foodStops.map((s) => ({ category: 'food', ...s })) }],
  };
}

describe('B6 (P310) — allergen_warning 검출', () => {
  it('Nuts 선택 + 견과 식당 (땅콩/강정) → allergen_warning 박제', () => {
    const issues = validateResponse(
      planWith([{ name: '서울 땅콩강정 전문점', display_name: 'Peanut Snack' }]),
      { lang: 'ko', dietary: ['Nuts'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBeGreaterThan(0);
    expect(aw[0].allergen).toBe('nuts');
  });

  it('⭐ SAFETY 핵심: allergen_warning 은 severity=warning (critical 아님 — retry loop 차단)', () => {
    const issues = validateResponse(
      planWith([{ name: '새우튀김 맛집', display_name: 'Shrimp Tempura' }]),
      { lang: 'ko', dietary: ['Shellfish'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBeGreaterThan(0);
    for (const w of aw) expect(w.severity).toBe('warning');
    // P280 교훈: allergen_warning 이 critical retry trigger 에 절대 안 걸림.
    expect(hasCriticalDietaryViolation(issues)).toBe(false);
  });

  it('Gluten 선택 + 냉면/라면 → allergen_warning (간장 같은 광역 조미료는 별도)', () => {
    const issues = validateResponse(
      planWith([{ name: '평양냉면 명가', display_name: 'Naengmyeon' }]),
      { lang: 'ko', dietary: ['Gluten'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBeGreaterThan(0);
    expect(aw[0].allergen).toBe('gluten');
  });

  it('Dairy 선택 + 치즈/크림 → allergen_warning', () => {
    const issues = validateResponse(
      planWith([{ name: '치즈등갈비', display_name: 'Cheese Galbi' }]),
      { lang: 'ko', dietary: ['Dairy'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBeGreaterThan(0);
    expect(aw[0].allergen).toBe('dairy');
  });

  it('false-positive 회피: Nuts 선택 + 일반 식당 (비빔밥 — 재료명 미노출) → warning 없음', () => {
    const issues = validateResponse(
      planWith([{ name: '전주비빔밥', display_name: 'Bibimbap' }]),
      { lang: 'ko', dietary: ['Nuts'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBe(0);
  });

  it('false-positive 회피: 광역 조미료 (간장/고추장) 단독은 gluten warning 안 띄움', () => {
    const issues = validateResponse(
      planWith([{ name: '간장게장 백반', display_name: 'Soy Crab' }]),
      { lang: 'ko', dietary: ['Gluten'] },
      [],
    );
    // '간장' 은 gluten 키워드에 없음 (광역 조미료 제외). gluten warning 0.
    const glutenAw = issues.filter((i: { type: string; allergen?: string }) =>
      i.type === 'allergen_warning' && i.allergen === 'gluten');
    expect(glutenAw.length).toBe(0);
  });

  it('dietary 에 알레르기 없음 (Halal 만) → allergen_warning 안 띄움', () => {
    const issues = validateResponse(
      planWith([{ name: '새우 전문점', display_name: 'Shrimp House' }]),
      { lang: 'ko', dietary: ['Halal'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBe(0);
  });

  it('non-food stop 은 검사 안 함 (관광지 이름에 재료 키워드 있어도)', () => {
    const issues = validateResponse(
      { days: [{ day: 1, stops: [{ category: 'attraction', name: '새우젓 박물관', display_name: 'Museum' }] }] },
      { lang: 'ko', dietary: ['Shellfish'] },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBe(0);
  });

  it('dietary 미전달 → allergen_warning 안 띄움 (기존 caller 호환)', () => {
    const issues = validateResponse(
      planWith([{ name: '새우 전문점' }]),
      { lang: 'ko' },
      [],
    );
    const aw = issues.filter((i: { type: string }) => i.type === 'allergen_warning');
    expect(aw.length).toBe(0);
  });
});
