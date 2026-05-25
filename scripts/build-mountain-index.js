/**
 * build-mountain-index.js
 *
 * src/data/mountains/{gangwon,gyeongsang,jeolla_jeju_chungcheong}.json
 * → api/_mountain_index.json 통합 (60 row).
 *
 * 스키마 검증: elevation_m + difficulty + trails[] 필수.
 * SAFETY-CRITICAL — 외국인 visitor 등산 안전 데이터 (거리/난이도/시간).
 *
 * Usage: node scripts/build-mountain-index.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MOUNTAINS_DIR = join(ROOT, 'src', 'data', 'mountains');
const OUTPUT_PATH = join(ROOT, 'api', '_mountain_index.json');

const SOURCE_FILES = [
  'gangwon.json',
  'gyeongsang.json',
  'jeolla_jeju_chungcheong.json',
];

// ── 스키마 검증 ────────────────────────────────────────────────────────────────
// SAFETY-CRITICAL: elevation_m + difficulty + trails[] 전부 필수.
// 누락 시 외국인이 코스 선택 판단 불가 → 사고 위험.
const REQUIRED_FIELDS = ['elevation_m', 'difficulty', 'trails'];

function validateRow(row, source) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (row[field] === undefined || row[field] === null) {
      errors.push(`${field} 누락`);
    }
  }
  if (Array.isArray(row.trails) && row.trails.length === 0) {
    errors.push('trails[] 빈 배열 — 코스 정보 없음');
  }
  if (errors.length > 0) {
    throw new Error(`[mountain-index] ${source} key=${row.key}: ${errors.join(', ')}`);
  }
}

function loadJson(filename) {
  const filePath = join(MOUNTAINS_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(`[mountain-index] 파일 없음: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  console.log(`  [${filename}] ${data.length} rows loaded`);
  return data;
}

function main() {
  console.log('CocoTrip — Building Mountain Index (SAFETY-CRITICAL)');
  console.log(`  Source dir: ${MOUNTAINS_DIR}\n`);

  const all = [];
  for (const filename of SOURCE_FILES) {
    const rows = loadJson(filename);
    for (const row of rows) {
      // SAFETY-CRITICAL 검증: 필수 필드 누락 시 빌드 중단
      validateRow(row, filename);
      all.push(row);
    }
  }

  console.log(`\n  Total: ${all.length} mountains`);

  // region별 통계 출력
  const regionCounts = {};
  const difficultyCounts = {};
  for (const m of all) {
    regionCounts[m.region] = (regionCounts[m.region] || 0) + 1;
    difficultyCounts[m.difficulty] = (difficultyCounts[m.difficulty] || 0) + 1;
  }
  console.log('  By region:', JSON.stringify(regionCounts));
  console.log('  By difficulty:', JSON.stringify(difficultyCounts));

  // Hallasan 존재 확인 (위자드 Hallasan 옵션 전용 lookup)
  const hallasan = all.find((m) => m.key === 'hallasan');
  if (!hallasan) {
    throw new Error('[mountain-index] SAFETY-CRITICAL: hallasan row 없음 — 제주 Hallasan 옵션 작동 불가');
  }
  console.log(`  Hallasan found: ${hallasan.name.en} (${hallasan.elevation_m}m, reservation_required=${hallasan.tags?.includes('reservation_required')})`);

  // 출력 (minified)
  const output = JSON.stringify(all, null, 0);
  writeFileSync(OUTPUT_PATH, output, 'utf-8');

  const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`\n  Output: ${OUTPUT_PATH}`);
  console.log(`  Size: ${sizeKB} KB (${all.length} mountains)`);
  console.log('\nMountain index built successfully! (SAFETY-CRITICAL verified)');
}

main();
