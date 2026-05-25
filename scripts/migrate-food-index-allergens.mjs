#!/usr/bin/env node
/**
 * migrate-food-index-allergens.mjs — P189 (2026-05-25) SAFETY-CRITICAL
 *
 * _food_index.json 의 모든 row 에 allergens 필드가 없으면 false default 채우기.
 * 기존 allergens 데이터(있다면) 보존, 누락 key 만 보충.
 *
 * 사용법 (운영자 직접 실행):
 *   node scripts/migrate-food-index-allergens.mjs
 *   node scripts/migrate-food-index-allergens.mjs --dry-run   # 실제 쓰기 없이 통계만
 *
 * 주의:
 *   - 본 PR 에서는 migration 실행 X. 운영자가 직접 결정 후 실행.
 *   - migration 후 allergen 정보 실측 retrofit 은 별도 DB 수집 cycle 에서 처리.
 *   - true 값으로의 수정은 본 스크립트 scope 외 — 각 식당 allergen 실측 필요.
 *
 * allergens schema (P189):
 *   {
 *     "nuts": false,      // 견과류 포함 메뉴 있음 여부 (false = 미확인 or 없음)
 *     "shellfish": false, // 해산물/조개류
 *     "gluten": false,    // 글루텐 (밀가루)
 *     "dairy": false      // 유제품
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX_PATH = resolve(ROOT, 'api', '_food_index.json');

const DRY_RUN = process.argv.includes('--dry-run');

const ALLERGENS_DEFAULT = {
  nuts: false,
  shellfish: false,
  gluten: false,
  dairy: false,
};

function main() {
  if (!existsSync(INDEX_PATH)) {
    console.error(`[P189 migrate] ERROR: ${INDEX_PATH} not found`);
    process.exit(1);
  }

  console.log(`[P189 migrate] Loading ${INDEX_PATH}...`);
  const raw = readFileSync(INDEX_PATH, 'utf-8');
  let index;
  try {
    index = JSON.parse(raw);
  } catch (err) {
    console.error(`[P189 migrate] ERROR: JSON parse failed: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(index)) {
    console.error(`[P189 migrate] ERROR: _food_index.json is not an array`);
    process.exit(1);
  }

  let addedCount = 0;
  let patchedCount = 0;
  let skippedCount = 0;

  for (const row of index) {
    if (!row.allergens || typeof row.allergens !== 'object') {
      // allergens 필드 전체 없음 → false default 추가
      row.allergens = { ...ALLERGENS_DEFAULT };
      addedCount++;
    } else {
      // allergens 필드 있지만 일부 key 누락 → 보충
      let patched = false;
      for (const [k, v] of Object.entries(ALLERGENS_DEFAULT)) {
        if (row.allergens[k] === undefined) {
          row.allergens[k] = v;
          patched = true;
        }
      }
      if (patched) patchedCount++;
      else skippedCount++;
    }
  }

  console.log(`[P189 migrate] Stats:`);
  console.log(`  - Total rows: ${index.length}`);
  console.log(`  - allergens added (was missing): ${addedCount}`);
  console.log(`  - allergens partially patched: ${patchedCount}`);
  console.log(`  - allergens already complete: ${skippedCount}`);

  if (DRY_RUN) {
    console.log(`\n[P189 migrate] DRY-RUN mode — no changes written.`);
    console.log(`[P189 migrate] Run without --dry-run to apply.`);
    return;
  }

  const output = JSON.stringify(index, null, 0);
  writeFileSync(INDEX_PATH, output, 'utf-8');

  const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(2);
  console.log(`\n[P189 migrate] Written: ${INDEX_PATH} (${sizeMB} MB)`);
  console.log(`[P189 migrate] DONE. 다음 단계: 각 식당 allergen 정보 실측 후 DB 수집 cycle 에서 true 값으로 retrofit.`);
}

main();
