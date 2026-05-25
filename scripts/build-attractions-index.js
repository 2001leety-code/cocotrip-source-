/**
 * build-attractions-index.js
 *
 * src/data/attractions/{museums,temples,night_spots}.json
 *   → api/_attractions_index.json 통합
 *
 * food index 와 독립 (별도 인덱스 파일 — _food_index.json 과 무관).
 * 3 source JSON 파일 자체는 건드리지 않고 그대로 사용.
 *
 * Usage: node scripts/build-attractions-index.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'src', 'data', 'attractions');
const OUTPUT_PATH = join(ROOT, 'api', '_attractions_index.json');

function loadJson(filePath, type) {
  if (!existsSync(filePath)) {
    console.warn(`  ⚠️  File not found: ${filePath}`);
    return [];
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`  📂 ${type}: ${data.length} rows loaded`);
    return data.map(item => ({ ...item, _source: type }));
  } catch (err) {
    console.error(`  ❌ Failed to parse ${filePath}:`, err.message);
    return [];
  }
}

function main() {
  console.log('🗺️  CocoTrip — Building Attractions Index');
  console.log(`   Sources: museums + temples + night_spots\n`);

  const museums     = loadJson(join(DATA_DIR, 'museums.json'),     'museum');
  const temples     = loadJson(join(DATA_DIR, 'temples.json'),     'temple');
  const nightSpots  = loadJson(join(DATA_DIR, 'night_spots.json'), 'night_spot');

  const all = [...museums, ...temples, ...nightSpots];

  // Deduplicate by key field (primary) or name.en (fallback)
  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    const dedupeKey = item.key || (item.name && item.name.en) || JSON.stringify(item.name);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(item);
  }

  // Stats
  const typeCounts = {};
  const cityCounts = {};
  for (const item of deduped) {
    const t = item._source || item.theme || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    const c = item.city || 'unknown';
    cityCounts[c] = (cityCounts[c] || 0) + 1;
  }

  console.log(`\n  📊 Total: ${deduped.length} rows`);
  console.log('  📊 By type:', JSON.stringify(typeCounts));
  console.log('  📊 By city:', JSON.stringify(cityCounts));

  const output = JSON.stringify(deduped, null, 0); // minified
  writeFileSync(OUTPUT_PATH, output, 'utf-8');

  const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`\n  💾 Output: ${OUTPUT_PATH}`);
  console.log(`  📦 Size: ${sizeKB} KB (${deduped.length} attractions)`);
  console.log('\n✅ Attractions index built successfully!');
}

main();
