/**
 * One-off: api/_food_index.json 의 multilang concat 식당 이름 정리.
 *
 * 사용자 PDF 보고로 발견: 식당 이름에 4개 언어 concat ("한 | English | 中 | 日") 누수.
 * 542/2595 (21%) 식당 영향.
 *
 * 본 스크립트:
 *   - name 필드: ko 토큰만 추출 (Hangul 우선)
 *   - nameEn 필드: en 토큰만 추출 (Latin 우선)
 *   - 변경 사항 dry-run 또는 in-place
 *
 * Usage:
 *   node scripts/cleanup-food-index.mjs --dry-run   # 변경 미리보기
 *   node scripts/cleanup-food-index.mjs              # 실제 적용
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeStopName } from '../api/_ai_core/sanitizeName.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FOOD_INDEX_PATH = join(__dirname, '..', 'api', '_food_index.json');

const dryRun = process.argv.includes('--dry-run');
console.log(`🍽️  CocoTrip — food_index 다국어 정리 ${dryRun ? '(DRY RUN)' : '(in-place)'}`);

const data = JSON.parse(readFileSync(FOOD_INDEX_PATH, 'utf-8'));
console.log(`   Total restaurants: ${data.length}`);

let nameChanges = 0;
let enChanges = 0;
const samples = [];

for (const r of data) {
  const origName = r.name || '';
  const origEn = r.nameEn || '';
  const newName = sanitizeStopName(origName, 'ko');
  const newEn = sanitizeStopName(origEn, 'en');
  if (newName !== origName) {
    nameChanges++;
    if (samples.length < 10) samples.push({ field: 'name', from: origName, to: newName });
    r.name = newName;
  }
  if (newEn !== origEn) {
    enChanges++;
    if (samples.length < 20) samples.push({ field: 'nameEn', from: origEn, to: newEn });
    r.nameEn = newEn;
  }
}

console.log(`\n   name field cleaned:    ${nameChanges} restaurants`);
console.log(`   nameEn field cleaned:  ${enChanges} restaurants`);
console.log('\n   Sample changes:');
for (const s of samples) {
  console.log(`   [${s.field}]`);
  console.log(`     - ${s.from}`);
  console.log(`     + ${s.to}`);
}

if (!dryRun && (nameChanges || enChanges)) {
  writeFileSync(FOOD_INDEX_PATH, JSON.stringify(data, null, 0), 'utf-8');
  console.log(`\n   ✅ Written to ${FOOD_INDEX_PATH}`);
} else if (dryRun) {
  console.log(`\n   (DRY RUN) — re-run without --dry-run to apply.`);
}
