/**
 * build-food-index.js
 * 
 * food_data/restaurants_*.json → api/_food_index.json 변환
 * 필터: rating >= 4.5 && reviewCount >= 50
 * 중복 제거: googleMapsUrl 기준
 * 
 * Usage: node scripts/build-food-index.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');
const OUTPUT_PATH = join(ROOT, 'api', '_food_index.json');

const MIN_RATING = 4.5;
const MIN_REVIEWS = 50;

// Fields to keep (minimize size)
const KEEP_FIELDS = [
  'name', 'nameEn', 'address', 'lat', 'lng',
  'rating', 'reviewCount', 'cuisine', 'cuisineKo',
  'priceLevel', 'priceLabel', 'priceLabelKo', 'priceRange',
  'tag', 'placeId', 'googleMapsUrl',
  'city', 'dong', 'dongEn', 'district',
];

function loadJson(filePath) {
  if (!existsSync(filePath)) {
    console.warn(`  ⚠️ File not found: ${filePath}`);
    return [];
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`  📂 ${filePath.split(/[\\/]/).pop()}: ${data.length} items loaded`);
    return data;
  } catch (err) {
    console.error(`  ❌ Failed to parse ${filePath}:`, err.message);
    return [];
  }
}

function pickFields(item) {
  const result = {};
  for (const key of KEEP_FIELDS) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
      result[key] = item[key];
    }
  }
  return result;
}

function main() {
  console.log('🍽️  CocoTrip — Building Food Index');
  console.log(`   Filter: rating ≥ ${MIN_RATING}, reviews ≥ ${MIN_REVIEWS}\n`);

  // Load all three files
  const general = loadJson(join(FOOD_DATA_DIR, 'restaurants_general.json'));
  const halal   = loadJson(join(FOOD_DATA_DIR, 'restaurants_halal.json'));
  const vegan   = loadJson(join(FOOD_DATA_DIR, 'restaurants_vegan.json'));

  // Combine all
  const all = [...general, ...halal, ...vegan];
  console.log(`\n  📊 Total raw items: ${all.length}`);

  // Filter by rating & reviews
  const filtered = all.filter(r => {
    const rating = Number(r.rating) || 0;
    const reviews = Number(r.reviewCount) || 0;
    return rating >= MIN_RATING && reviews >= MIN_REVIEWS;
  });
  console.log(`  ✅ After rating/review filter: ${filtered.length}`);

  // Deduplicate by placeId (Google Maps unique ID)
  const seen = new Set();
  const deduped = [];
  for (const item of filtered) {
    const key = item.placeId || item.googleMapsUrl || `${item.name}|${item.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(pickFields(item));
  }
  console.log(`  🔄 After dedup: ${deduped.length}`);

  // Sort by rating desc, then reviewCount desc
  deduped.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return (b.reviewCount || 0) - (a.reviewCount || 0);
  });

  // Stats by tag
  const tagCounts = {};
  const cityCounts = {};
  for (const r of deduped) {
    tagCounts[r.tag || 'unknown'] = (tagCounts[r.tag || 'unknown'] || 0) + 1;
    cityCounts[r.city || 'unknown'] = (cityCounts[r.city || 'unknown'] || 0) + 1;
  }
  console.log('\n  📊 By tag:', JSON.stringify(tagCounts));
  console.log('  📊 By city:', JSON.stringify(cityCounts));

  // Write output
  const output = JSON.stringify(deduped, null, 0); // minified
  writeFileSync(OUTPUT_PATH, output, 'utf-8');

  const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(2);
  console.log(`\n  💾 Output: ${OUTPUT_PATH}`);
  console.log(`  📦 Size: ${sizeMB} MB (${deduped.length} restaurants)`);
  console.log('\n✅ Food index built successfully!');
}

main();
