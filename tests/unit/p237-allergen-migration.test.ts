/**
 * P237 — allergen migration + sub-type 세분화 검증 (2026-05-27)
 *
 * SAFETY-CRITICAL: allergen 잘못 처리 = 고객 건강 위험.
 *
 * assertion 5종:
 *   1. _food_index.json 의 모든 row 에 allergens 필드 존재 (migration 완료)
 *   2. allergens 4 key (nuts/shellfish/gluten/dairy) 모두 포함
 *   3. buildPrompt.js 에 한국 음식 숨은 allergen 가이드 포함 (P237 세분화)
 *   4. _food_helper.js 에 ALLERGEN_KEYS + filterByAllergens 존재
 *   5. migrate 스크립트 존재 + dry-run 옵션 지원
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

describe('P237 SAFETY-CRITICAL — Allergen Migration + 세분화', () => {
  it('1. _food_index.json 모든 row 에 allergens 필드 존재 (migration 완료)', () => {
    const raw = readFileSync(resolve(ROOT, 'api/_food_index.json'), 'utf-8');
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(arr.length).toBeGreaterThan(3000);

    const withAllergens = arr.filter(r => r.allergens !== undefined);
    // 마이그레이션 완료 = 100%
    expect(withAllergens.length).toBe(arr.length);
  });

  it('2. allergens 4 key (nuts/shellfish/gluten/dairy) 모두 포함', () => {
    const raw = readFileSync(resolve(ROOT, 'api/_food_index.json'), 'utf-8');
    const arr = JSON.parse(raw) as Array<{ allergens?: Record<string, boolean> }>;
    // 처음 100 row 검사
    const sample = arr.slice(0, 100);
    for (const row of sample) {
      const a = row.allergens;
      expect(a).toBeDefined();
      expect(a).toHaveProperty('nuts');
      expect(a).toHaveProperty('shellfish');
      expect(a).toHaveProperty('gluten');
      expect(a).toHaveProperty('dairy');
    }
  });

  it('3. buildPrompt.js 에 P237 알레르기 세분화 한국 음식 가이드 포함', () => {
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/buildPrompt.js'), 'utf-8');
    // P237 강화 섹션 존재
    expect(src).toMatch(/Korean food hidden allergen guide/);
    // 새우젓 숨은 allergen 경고 (kimchi base)
    expect(src).toMatch(/새우젓/);
    expect(src).toMatch(/kimchi/);
    // Gluten 섹션에 간장 경고
    expect(src).toMatch(/Gluten/);
    expect(src).toMatch(/간장/);
    // 땅콩 = peanut 경고
    expect(src).toMatch(/땅콩/);
    expect(src).toMatch(/peanut/);
  });

  it('4. _food_helper.js ALLERGEN_KEYS + filterByAllergens 존재 (P189 유지)', () => {
    const src = readFileSync(resolve(ROOT, 'api/_food_helper.js'), 'utf-8');
    expect(src).toMatch(/ALLERGEN_KEYS\s*=\s*\[/);
    expect(src).toMatch(/filterByAllergens/);
    // SAFETY: allergen tag prefix 사용 확인
    expect(src).toMatch(/ALLERGEN_TAG_PREFIX/);
    // 4종 allergen case 블록 존재
    expect(src).toMatch(/case 'Nuts'/);
    expect(src).toMatch(/case 'Shellfish'/);
    expect(src).toMatch(/case 'Gluten'/);
    expect(src).toMatch(/case 'Dairy'/);
  });

  it('5. migrate-food-index-allergens.mjs 존재 + dry-run 옵션 코드 포함', () => {
    const src = readFileSync(resolve(ROOT, 'scripts/migrate-food-index-allergens.mjs'), 'utf-8');
    expect(src).toMatch(/dry-run|--dry-run|DRY_RUN/);
    expect(src).toMatch(/allergens.*nuts|nuts.*allergens/is);
  });
});
