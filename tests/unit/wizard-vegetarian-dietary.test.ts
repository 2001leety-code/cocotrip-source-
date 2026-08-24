/**
 * 위자드 Vegetarian 옵션 (2026-07-13) — SAFETY 갭 완결 회귀 가드.
 *
 * 배경: 백엔드 안전 체인(dietary-trust·responseValidator·_food_helper)은 이미 vegetarian 을
 * 전부 지원하는데 위자드 ALLERGY_KEYS 에만 누락돼 채식 사용자가 표현 불가였음.
 * 이 테스트는 ①위자드가 Vegetarian 을 노출하고 ②capitalized 값이 커버리지 게이트의
 * lowercase 정규화를 통과하며 ③vegan 식당이 vegetarian 요청을 커버하는 불변식을 고정.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkDietaryCoverage } from '../../api/_shared/dietary-trust.js';
import { DIETARY_RESTRICTION_KEYS } from '../../src/components/WizardForm/data';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

const trustedVegan = { name: '비건식당', city: 'seoul', tag: 'vegan', verification_status: 'vegan_options', rating: 4.7, reviewCount: 100 };
const trustedHalal = { name: '할랄식당', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', rating: 4.6, reviewCount: 80 };

describe('위자드 Vegetarian 노출', () => {
  it('DIETARY_RESTRICTION_KEYS 에 Vegetarian 포함, Halal·Vegan 과 함께, None 은 마지막', () => {
    expect(DIETARY_RESTRICTION_KEYS).toContain('Vegetarian');
    expect(DIETARY_RESTRICTION_KEYS).toContain('Halal');
    expect(DIETARY_RESTRICTION_KEYS).toContain('Vegan');
    expect(DIETARY_RESTRICTION_KEYS[DIETARY_RESTRICTION_KEYS.length - 1]).toBe('None');
  });

  it('i18n dietaryRestrictionVegetarian 4언어 존재', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh']) {
      const locale = JSON.parse(read(`../../src/i18n/locales/${lang}.json`));
      expect(locale.planner?.dietaryRestrictionVegetarian, `${lang}.json dietaryRestrictionVegetarian 누락`).toBeTruthy();
    }
  });
});

describe('checkDietaryCoverage — Vegetarian(위자드 capitalized 값) 처리', () => {
  it('capitalized "Vegetarian" 을 lowercase 정규화해 커버리지 판정', () => {
    // vegan 식당이 있는 도시 = vegetarian 커버 (vegan⊃vegetarian)
    const r = checkDietaryCoverage([trustedVegan], ['seoul'], ['Vegetarian']);
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('vegan 식당은 vegetarian 요청을 커버 (역은 불가)', () => {
    // vegetarian 전용 식당만 있으면 vegan 요청은 미충족
    const vegOnly = { name: '채식당', city: 'busan', tag: 'vegetarian', verification_status: 'vegan_options', rating: 4.5, reviewCount: 60 };
    expect(checkDietaryCoverage([vegOnly], ['busan'], ['Vegetarian']).ok).toBe(true);   // vegetarian→vegetarian OK
    expect(checkDietaryCoverage([vegOnly], ['busan'], ['Vegan']).ok).toBe(false);        // vegan은 vegetarian 식당으로 커버 불가
  });

  it('vegetarian 후보 0 도시 = missing (완화 금지)', () => {
    const r = checkDietaryCoverage([trustedHalal], ['seoul'], ['Vegetarian']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ city: 'seoul', diet: 'vegetarian' }]);
  });
});
