/**
 * P298 (2026-05-29) SAFETY-CRITICAL: 할랄/비건 allergies → dietaryAll 합집합 통합 회귀 차단.
 *
 * 배경: WizardForm P10 (2026-04-24) 가 'Halal'/'Vegan' 을 style preference 에서
 *   ALLERGY_KEYS (data.tsx:237) 로 이동 → WizardStep1Food.tsx:65,67 에서 allergies
 *   배열로 체크. 그러나 handlerCore 는 dietPrefs 만 식이 검증·필터·추천·저장·dispatch
 *   체인에 전달 → 2026-04-24~05-29 할랄/비건 검증이 통째로 죽음 (무슬림/비건이
 *   9900원 내고 받은 plan 에 돼지고기집/육류 무검증 통과 = CLAUDE.md J 건강위험 1등급).
 *
 * 6월 상용화 audit (wf_f41a5123-db8) B1 발견 → 직접 grep 으로 7지점 확인 (audit 은 5지점
 *   보고, dispatch 경로 L358/L372 누락).
 *
 * Fix: dietaryAll = [...new Set([...dietPrefs, ...allergies])].filter(d => d && d !== 'None')
 *   → 7지점 (getFoodContext / logMetrics / blockMode / runGeminiPipeline / dispatch×2 /
 *   applyRecommendedRestaurants / savePlan) 모두 dietaryAll 전달.
 *
 * 회귀 시: 7지점 중 하나라도 dietPrefs 단독 → 그 경로에서 할랄/비건 누락 (건강위험 재발).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P298 dietary/allergies 합집합 통합 (SAFETY-CRITICAL)', () => {
  const src = readFileSync(resolve(ROOT, 'api/_ai_core/handlerCore.js'), 'utf8');

  // ── dietaryAll 선언 ────────────────────────────────────────────────────────

  it('dietaryAll 합집합 선언 (dietPrefs ∪ allergies, None 제외)', () => {
    expect(src).toContain('P298');
    expect(src).toContain('SAFETY-CRITICAL');
    // new Set 합집합 + None 필터
    expect(src).toMatch(/const dietaryAll\s*=\s*\[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(dietPrefs\)/);
    expect(src).toMatch(/\.\.\.\(Array\.isArray\(allergies\)/);
    expect(src).toMatch(/\.filter\(\(d\)\s*=>\s*d\s*&&\s*d\s*!==\s*['"]None['"]\)/);
  });

  // ── 7지점 모두 dietaryAll 전달 ──────────────────────────────────────────────

  it('지점1 — getFoodContext(area, dietaryAll, ...)', () => {
    expect(src).toMatch(/getFoodContext\(area,\s*dietaryAll,/);
  });

  it('지점2 — logPromptMetrics diet: dietaryAll', () => {
    expect(src).toMatch(/diet:\s*dietaryAll\.join/);
  });

  it('지점3 — block_mode userInput dietPrefs: dietaryAll (allergies 키 유지)', () => {
    expect(src).toMatch(/userInput:\s*\{[^}]*dietPrefs:\s*dietaryAll[^}]*allergies/);
  });

  it('지점4 — runGeminiPipeline dietary: dietaryAll', () => {
    expect(src).toMatch(/mode:\s*PLANNER_MODE,\s*\n\s*dietary:\s*dietaryAll/);
  });

  it('지점5+6 — dispatch×2 (block_mode Inngest + legacy Inngest) dietPrefs: dietaryAll', () => {
    // 두 dispatchOrInlineForHandlerCore 모두 dietPrefs: dietaryAll
    const matches = src.match(/dietPrefs:\s*dietaryAll/g) || [];
    // block_mode userInput(1) + dispatch×2 + applyRecommended(1) = 최소 4
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('지점7 — applyRecommendedRestaurants dietPrefs: dietaryAll', () => {
    expect(src).toMatch(/applyRecommendedRestaurants\(itinerary,\s*\{\s*area,\s*dietPrefs:\s*dietaryAll,\s*regions\s*\}\)/);
  });

  it('지점8 — savePlan dietary: dietaryAll', () => {
    expect(src).toMatch(/dietary:\s*dietaryAll,\s*foodIndex:/);
  });

  // ── 회귀 차단: dietPrefs 단독 사용 0 ────────────────────────────────────────

  it('회귀 — getFoodContext 가 dietPrefs 단독 사용 안 함', () => {
    expect(src).not.toMatch(/getFoodContext\(area,\s*dietPrefs,/);
  });

  it('회귀 — runGeminiPipeline / savePlan 이 dietary: dietPrefs 단독 사용 안 함', () => {
    expect(src).not.toMatch(/dietary:\s*dietPrefs\b/);
  });

  it('회귀 — applyRecommendedRestaurants 가 dietPrefs 단독 사용 안 함', () => {
    expect(src).not.toMatch(/applyRecommendedRestaurants\(itinerary,\s*\{\s*area,\s*dietPrefs,\s*regions/);
  });

  // ── 검증 함수가 'Halal'/'Vegan' 문자열 처리 (값 도달 = 작동 증명) ───────────

  it('responseValidator — checkDietaryViolation 이 halal/vegan 문자열 처리', () => {
    const validatorSrc = readFileSync(resolve(ROOT, 'api/_ai_core/responseValidator.js'), 'utf8');
    // dietary.some(d => /halal/i.test(d)) 패턴 — 'Halal' 문자열 매칭
    expect(validatorSrc).toMatch(/dietary\.some\(\(?d\)?\s*=>\s*\/halal\/i\.test/);
    expect(validatorSrc).toMatch(/dietary\.some\(\(?d\)?\s*=>\s*\/vegan\/i\.test/);
  });

  it('_food_helper — getTagsForDiet 가 Halal/Vegan 태그 매핑', () => {
    const foodSrc = readFileSync(resolve(ROOT, 'api/_food_helper.js'), 'utf8');
    expect(foodSrc).toMatch(/case\s*['"]Halal['"]:\s*tags\.add\(['"]halal['"]\)/);
    expect(foodSrc).toMatch(/case\s*['"]Vegan['"]:\s*tags\.add\(['"]vegan['"]\)/);
  });
});
