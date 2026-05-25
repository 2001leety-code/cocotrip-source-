/**
 * build-food-index.js
 * 
 * food_data/restaurants_*.json → api/_food_index.json 변환
 * 필터: rating >= 4.5 && reviewCount >= 50
 * 중복 제거: googleMapsUrl 기준
 * 
 * Usage: node scripts/build-food-index.js
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeStopName } from '../api/_ai_core/sanitizeName.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');
const OUTPUT_PATH = join(ROOT, 'api', '_food_index.json');

const MIN_RATING = 4.5;
const MIN_RATING_NEW_CITIES = 4.0; // Lower threshold for new cities (less data available)
const MIN_RATING_BUSAN = 4.6;      // Phase 6: Busan uses higher threshold (4.6)
const MIN_REVIEWS = 50;
const MIN_REVIEWS_NEW_CITIES = 10; // Lower for new cities
const NEW_CITIES = ['jeju', 'gyeongju', 'jeonju'];

// Fields to keep (minimize size)
const KEEP_FIELDS = [
  'name', 'nameEn', 'address', 'lat', 'lng',
  'rating', 'reviewCount', 'cuisine', 'cuisineKo',
  'priceLevel', 'priceLabel', 'priceLabelKo', 'priceRange',
  'tag', 'placeId', 'googleMapsUrl',
  'city', 'dong', 'dongEn', 'district',
  'source', 'naverLink', // for Naver-collected data traceability
  // Phase 6 (Busan) — foreigner-friendly meta
  'hasEnglishMenu', 'wheelchairAccessible',
  'area', // collection zone meta (e.g. haeundae, gwangalli)
  // P189 (2026-05-25) SAFETY-CRITICAL: allergens schema
  // false = 알레르기 메뉴 없음 또는 정보 미확인 (default)
  // true  = 해당 알레르기 유발 메뉴 있음 → 해당 알레르기 손님 제외
  'allergens',
];

// P189 (2026-05-25): allergens default — 모든 row 에 allergens 필드 보장.
// source 데이터에 allergens 있으면 보존, 없으면 false default 채우기.
// true 값은 식당 allergen 정보 실측 후 DB 수집 담당자가 retrofit.
const ALLERGENS_DEFAULT = { nuts: false, shellfish: false, gluten: false, dairy: false };

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
  // P189 (2026-05-25) SAFETY-CRITICAL: allergens 필드 보장
  // source 데이터에 allergens 있으면 보존 (각 key 존재 시 override 아닌 merge),
  // 없으면 false default 전체 채우기.
  if (!result.allergens || typeof result.allergens !== 'object') {
    result.allergens = { ...ALLERGENS_DEFAULT };
  } else {
    // 일부 key 누락 시 false default 보충 (partial allergens 허용)
    for (const [k, v] of Object.entries(ALLERGENS_DEFAULT)) {
      if (result.allergens[k] === undefined) {
        result.allergens[k] = v;
      }
    }
  }
  return result;
}

// ── 주소 정규화 ─────────────────────────────────────────────────────
// Google Maps에서 수집된 주소는 역순(건물→동→구→시→대한민국)인 경우가 많음.
// 한국 표준: "시도명 + 시군구 + 도로명 + 건물번호" 형식으로 정규화.
const KOREAN_CITY_PREFIXES = /^(서울특별시|부산광역시|제주특별자치도|인천광역시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|울산광역시|대구광역시|대전광역시|광주광역시|세종특별자치시)/;

function normalizeKoreanAddress(addr) {
  if (!addr || typeof addr !== 'string') return addr;

  // Remove leading/trailing "대한민국" or "South Korea"
  let cleaned = addr.replace(/^\s*(대한민국|South Korea)\s+/i, '').replace(/\s*(대한민국|South Korea)\s*$/i, '').trim();

  // Already starts with a Korean city → probably correct
  if (KOREAN_CITY_PREFIXES.test(cleaned)) return cleaned;

  // Detect reverse-order pattern: ends with city name
  // e.g. "노블스카이, 9층, 9-32 광안해변로370번길 수영구 부산광역시"
  const parts = cleaned.split(/\s+/);
  
  // Find the city name in the parts (from the end)
  let cityIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (KOREAN_CITY_PREFIXES.test(parts[i])) {
      cityIdx = i;
      break;
    }
  }

  if (cityIdx >= 0) {
    // Reverse: city + gu + road + building details
    const cityAndGu = parts.slice(cityIdx).join(' ');
    const beforeCity = parts.slice(0, cityIdx);
    
    // Separate gu/district from road parts
    // Find -gu/-dong parts near the city
    let guParts = [];
    let roadParts = [];
    for (let i = beforeCity.length - 1; i >= 0; i--) {
      const p = beforeCity[i].replace(/,$/,'');
      if (/[구군읍면동리]$/.test(p) && guParts.length < 2) {
        guParts.unshift(p);
      } else {
        roadParts = beforeCity.slice(0, i + 1).map(s => s.replace(/,$/,'').trim()).filter(Boolean);
        break;
      }
    }
    
    // Reconstruct: 시 + 구 + 도로/건물
    const normalized = [cityAndGu, ...guParts, ...roadParts].join(' ');
    return normalized;
  }

  // No city found — return cleaned version
  return cleaned;
}

function main() {
  console.log('🍽️  CocoTrip — Building Food Index');
  console.log(`   Filter: rating ≥ ${MIN_RATING}, reviews ≥ ${MIN_REVIEWS}\n`);

  // Load all three base files
  const general = loadJson(join(FOOD_DATA_DIR, 'restaurants_general.json'));
  const halal   = loadJson(join(FOOD_DATA_DIR, 'restaurants_halal.json'));
  const vegan   = loadJson(join(FOOD_DATA_DIR, 'restaurants_vegan.json'));

  // Load all city-collected files dynamically (from collect-restaurants.mjs)
  // Pattern: restaurants_{city}_collected.json — auto-discovers new cities
  const collectedFiles = existsSync(FOOD_DATA_DIR)
    ? readdirSync(FOOD_DATA_DIR).filter(f => /^restaurants_.+_collected\.json$/.test(f))
    : [];
  const cityCollected = collectedFiles.flatMap(f => loadJson(join(FOOD_DATA_DIR, f)));
  if (collectedFiles.length) {
    console.log(`  🏙️  Collected city files: ${collectedFiles.map(f => f.replace(/^restaurants_|_collected\.json$/g, '')).join(', ')}`);
  }

  // 2026-05-21 신규 AI-curated batch (제주/경주/전주 halal/vegan/dong 확충).
  // 운영자 검증 후속 필수 — record 의 `notes` 필드 + `source=ai_curated_2026_05_21` 로 식별.
  // 신뢰도: 식당명·dong 은 well-known, lat/lng 는 area centroid 근사값.
  const jejuCurated     = loadJson(join(FOOD_DATA_DIR, 'restaurants_jeju_2026-05-21.json'));
  const gyeongjuCurated = loadJson(join(FOOD_DATA_DIR, 'restaurants_gyeongju_2026-05-21.json'));
  const jeonjuCurated   = loadJson(join(FOOD_DATA_DIR, 'restaurants_jeonju_2026-05-21.json'));

  // NOTE: Busan Phase 6 dedicated JSON files were removed (5/25 sweep —
  // all 4 files confirmed missing). Re-add in a dedicated PR once the
  // actual files are collected (collect-busan.mjs + enrich-busan.mjs).

  // Combine all
  const all = [
    ...general, ...halal, ...vegan,
    ...cityCollected,
    ...jejuCurated, ...gyeongjuCurated, ...jeonjuCurated,
  ];
  console.log(`\n  📊 Total raw items: ${all.length}`);

  // Filter by rating & reviews (different thresholds per city/source)
  const filtered = all.filter(r => {
    const rating  = Number(r.rating) || 0;
    const reviews = Number(r.reviewCount) || 0;
    const city    = (r.city || '').toLowerCase();
    const isNewCity       = NEW_CITIES.includes(city);
    const isNaverCollected = r.source === 'naver_local';
    const isBusan         = city === 'busan';

    // Busan Phase 6: enrich-busan.mjs already filters at 4.6.
    // Secondary guard here for any items that slipped through.
    if (isBusan) {
      // Naver-only (no Google enrichment yet) → include with relaxed filter
      if (isNaverCollected && !r.placeId) return true;
      return rating >= MIN_RATING_BUSAN && reviews >= MIN_REVIEWS;
    }

    // Naver Local API (non-Busan) doesn't provide ratings — include all
    if (isNaverCollected) return true;

    // Different thresholds for established vs new cities
    if (isNewCity) {
      return rating >= MIN_RATING_NEW_CITIES && reviews >= MIN_REVIEWS_NEW_CITIES;
    }
    return rating >= MIN_RATING && reviews >= MIN_REVIEWS;
  });
  console.log(`  ✅ After rating/review filter: ${filtered.length}`);

  // Normalize addresses (fix Google Maps reverse-order format)
  let addrFixed = 0;
  for (const item of filtered) {
    if (item.address) {
      const orig = item.address;
      item.address = normalizeKoreanAddress(orig);
      if (item.address !== orig) addrFixed++;
    }
  }
  console.log(`  🔧 Address normalized: ${addrFixed} items`);

  // Sanitize multilingual concat names (사용자 PDF 보고로 발견 — 542/2595 식당 영향).
  // name 필드: 한국어 토큰만, nameEn 필드: 영어 토큰만 추출.
  let nameClean = 0, enClean = 0;
  for (const item of filtered) {
    if (item.name) {
      const orig = item.name;
      item.name = sanitizeStopName(orig, 'ko');
      if (item.name !== orig) nameClean++;
    }
    if (item.nameEn) {
      const orig = item.nameEn;
      item.nameEn = sanitizeStopName(orig, 'en');
      if (item.nameEn !== orig) enClean++;
    }
  }
  console.log(`  🌐 Multilang sanitized: name=${nameClean}, nameEn=${enClean}`);

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
