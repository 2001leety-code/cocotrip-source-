#!/usr/bin/env node
/**
 * enrich-busan.mjs
 *
 * busan_*.json 파일의 rating=0 항목을 Google Places API로 보강.
 * 평점 기준 적용: Google rating ≥ 4.6, reviewCount ≥ 50
 * 외국인 친화 메타 추가: hasEnglishMenu, wheelchairAccessible, priceLevel
 *
 * 멱등: placeId가 이미 있고 rating > 0인 항목은 스킵.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... node scripts/enrich-busan.mjs
 *   GOOGLE_PLACES_API_KEY=... node scripts/enrich-busan.mjs --dry          # 첫 5개만
 *   GOOGLE_PLACES_API_KEY=... node scripts/enrich-busan.mjs --cat=cafe     # 단일 카테고리
 *   GOOGLE_PLACES_API_KEY=... node scripts/enrich-busan.mjs --keep-all     # 평점 미달도 보존
 *
 * 완료 후: node scripts/build-food-index.js
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// .env 로더
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadDotEnv(join(ROOT, '.env'));

const API_KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
if (!API_KEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY missing (.env or export)');
  process.exit(1);
}

const FOOD_DATA_DIR = join(ROOT, 'food_data');

// ── 평점 기준 (Phase 6 상향: 4.6) ────────────────────────────────────────
const MIN_RATING  = 4.6;
const MIN_REVIEWS = 50;

// ── 카테고리 → 파일 매핑 ───────────────────────────────────────────────────
const BUSAN_FILES = {
  seafood:    'busan_seafood.json',
  cafe:       'busan_cafe.json',
  restaurant: 'busan_restaurant.json',
  attraction: 'busan_attraction.json',
};

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY      = args.includes('--dry');
const KEEP_ALL = args.includes('--keep-all'); // 평점 미달 항목도 파일에 보존
const catFilter = (args.find(a => a.startsWith('--cat=')) || '').replace('--cat=', '') || null;

// ── Google Places: Find Place From Text ─────────────────────────────────────
const FIND_PLACE_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
// Place Details (wheelchair_accessible_entrance, editorial_summary 등)
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPlace({ name, lat, lng }) {
  const input = `${name} 부산`;
  const params = new URLSearchParams({
    input,
    inputtype: 'textquery',
    fields: 'place_id,name,rating,user_ratings_total,formatted_address,price_level',
    language: 'ko',
    key: API_KEY,
  });
  if (lat && lng) {
    // 500m 반경 bias — 좌표가 정확하지 않을 수 있어 bias(강제 아님) 사용
    params.set('locationbias', `circle:800@${lat},${lng}`);
  }
  const url = `${FIND_PLACE_URL}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'OK' && data.candidates?.[0]) return data.candidates[0];
  if (data.status === 'ZERO_RESULTS') return null;
  if (['OVER_QUERY_LIMIT', 'RESOURCE_EXHAUSTED'].includes(data.status)) {
    throw new Error(`Quota: ${data.status}`);
  }
  if (data.status !== 'OK') {
    console.warn(`  ⚠ ${data.status} for "${name}"${data.error_message ? ' — ' + data.error_message : ''}`);
  }
  return null;
}

/**
 * Place Details: 외국인 친화 필드 추가 조회
 * wheelchair_accessible_entrance, editorial_summary (영어 메뉴 여부 추정용)
 */
async function getPlaceDetails(placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'wheelchair_accessible_entrance,editorial_summary,serves_vegetarian_food,delivery,opening_hours',
    language: 'en',
    key: API_KEY,
  });
  const url = `${PLACE_DETAILS_URL}?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'OK') return data.result || null;
    return null;
  } catch {
    return null;
  }
}

// ── 영어 메뉴 여부 추정 ──────────────────────────────────────────────────────
// Google Places에는 직접적인 "영어 메뉴" 속성이 없음.
// editorial_summary(영어)가 존재하거나 외국인 리뷰가 많으면 hasEnglishMenu=true 추정.
function estimateEnglishMenu(details, placeCandidate) {
  if (!details) return null; // 알 수 없음
  // editorial_summary가 영어로 존재하면 외국인 접근성 있음
  const summary = details.editorial_summary?.text || '';
  if (summary && /[a-zA-Z]/.test(summary)) return true;
  return null; // 추정 불가 → null (unknown)
}

// ── 카테고리 보강 ────────────────────────────────────────────────────────────
async function enrichCategory(cat) {
  const fileName = BUSAN_FILES[cat];
  const file = join(FOOD_DATA_DIR, fileName);

  if (!existsSync(file)) {
    console.warn(`  ⚠ ${file} not found — run collect-busan.mjs first`);
    return { cat, total: 0, enriched: 0, miss: 0, skipped: 0, filtered: 0 };
  }

  const data = JSON.parse(readFileSync(file, 'utf-8'));

  // 백업 (최초 1회)
  const backup = file.replace('.json', '.backup.json');
  if (!existsSync(backup) && !DRY) {
    copyFileSync(file, backup);
    console.log(`  💾 backup → ${backup.split(/[\\/]/).pop()}`);
  }

  let enriched = 0, miss = 0, skipped = 0, filtered = 0;
  const total = DRY ? Math.min(5, data.length) : data.length;
  console.log(`\n🏙️  ${cat} (${total} entries)`);

  for (let i = 0; i < total; i++) {
    const item = data[i];

    // 이미 보강된 항목 스킵
    if (item.placeId && item.rating > 0) {
      skipped++;
      continue;
    }

    try {
      // 1. Find Place — 평점/placeId 조회
      const found = await findPlace({ name: item.name, lat: item.lat, lng: item.lng });
      await sleep(110); // Find Place 후 쉬기 (10 req/s 한도)

      if (found) {
        item.placeId       = found.place_id;
        item.rating        = found.rating || 0;
        item.reviewCount   = found.user_ratings_total || 0;
        item.priceLevel    = found.price_level ?? null; // 1~4 (Google)
        if (found.formatted_address) item.address = found.formatted_address;
        item.googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${found.place_id}`;

        // 2. Place Details — 외국인 친화 메타 (쿼터 절약: enriched 항목만)
        if (item.rating >= MIN_RATING && item.reviewCount >= MIN_REVIEWS) {
          const details = await getPlaceDetails(found.place_id);
          await sleep(110);
          item.hasEnglishMenu      = estimateEnglishMenu(details, found);
          item.wheelchairAccessible = details?.wheelchair_accessible_entrance ?? null;
        }

        enriched++;
        if ((i + 1) % 25 === 0 || i + 1 === total) {
          console.log(
            `  [${i + 1}/${total}] ✅ ${item.name} ` +
            `(${item.rating}★ × ${item.reviewCount} / priceLevel: ${item.priceLevel ?? '?'})`,
          );
        }
      } else {
        miss++;
      }
    } catch (err) {
      console.error(`  [${i + 1}/${total}] ✗ ${item.name}: ${err.message}`);
      if (err.message.startsWith('Quota')) throw err; // 쿼터 초과 시 즉시 중단
    }
  }

  // ── 평점 기준 필터링 ────────────────────────────────────────────────────
  const passedItems = data.filter(item => {
    // Naver 수집이지만 Google 보강 없는 항목 → KEEP_ALL 모드에서만 보존
    if (!item.placeId) return KEEP_ALL;
    // 평점 기준
    return item.rating >= MIN_RATING && item.reviewCount >= MIN_REVIEWS;
  });
  filtered = data.length - passedItems.length;

  if (!DRY) {
    writeFileSync(file, JSON.stringify(passedItems, null, 2), 'utf-8');
    console.log(
      `  💾 saved → ${fileName} ` +
      `(${passedItems.length} passed, ${filtered} removed by rating filter)`,
    );
  } else {
    console.log(`  (dry run — not saved. Would keep ${passedItems.length}/${data.length})`);
  }

  return { cat, total, enriched, miss, skipped, filtered };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌐 Google Places enrichment — Busan categories');
  console.log(`   MIN_RATING: ${MIN_RATING}  MIN_REVIEWS: ${MIN_REVIEWS}`);
  if (DRY)      console.log('   (DRY mode — first 5 per category, not saved)');
  if (KEEP_ALL) console.log('   (KEEP_ALL — rating filter skipped)');

  const categories = catFilter
    ? [catFilter]
    : Object.keys(BUSAN_FILES);

  const results = [];
  for (const cat of categories) {
    if (!BUSAN_FILES[cat]) {
      console.warn(`  ⚠ unknown category: ${cat}`);
      continue;
    }
    const r = await enrichCategory(cat);
    results.push(r);
  }

  console.log('\n📊 Summary');
  console.log('─'.repeat(70));
  let totEnriched = 0, totMiss = 0, totSkipped = 0, totFiltered = 0;
  for (const r of results) {
    console.log(
      `  ${r.cat.padEnd(12)} total=${r.total} enriched=${r.enriched} ` +
      `miss=${r.miss} skipped=${r.skipped} filtered(rating<${MIN_RATING})=${r.filtered}`,
    );
    totEnriched  += r.enriched;
    totMiss      += r.miss;
    totSkipped   += r.skipped;
    totFiltered  += r.filtered;
  }
  console.log('─'.repeat(70));
  console.log(
    `  ${'TOTAL'.padEnd(12)} enriched=${totEnriched} miss=${totMiss} ` +
    `skipped=${totSkipped} filtered=${totFiltered}`,
  );
  console.log('\n✅ Done. Next: node scripts/build-food-index.js');
}

main().catch(err => {
  console.error('💥', err);
  process.exit(1);
});
