#!/usr/bin/env node
/**
 * CocoTrip — Restaurant Collection Script (Naver Local Search API)
 *
 * Collects restaurant data for cities missing from _food_index.json:
 * Jeju (150 target), Gyeongju (100), Jeonju (100)
 *
 * Usage:
 *   node scripts/collect-restaurants.mjs jeju
 *   node scripts/collect-restaurants.mjs gyeongju
 *   node scripts/collect-restaurants.mjs jeonju
 *   node scripts/collect-restaurants.mjs all
 *
 * Rate limit: 5,000 requests/city/day (Naver 25,000/day total)
 *
 * Output: food_data/restaurants_{city}_collected.json
 * Then run: node scripts/build-food-index.js to rebuild _food_index.json
 *
 * Requires: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET env vars
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');

// ── Config ──────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  console.error('❌ NAVER_CLIENT_ID and NAVER_CLIENT_SECRET required');
  console.error('   Set them in .env or export them before running');
  process.exit(1);
}

const BATCH_LIMIT = 5000; // per city per day
const DELAY_MS = 200;     // between API calls (5 req/sec)

// ── City configurations ─────────────────────────────────────────────────
const CITY_CONFIG = {
  jeju: {
    target: 150,
    city: 'jeju',
    searchQueries: [
      // 한식 (50)
      { q: '제주시 한식 맛집', tag: 'general', category: 'hansik', target: 15 },
      { q: '서귀포시 한식 맛집', tag: 'general', category: 'hansik', target: 15 },
      { q: '제주 흑돼지 맛집', tag: 'general', category: 'hansik', target: 10 },
      { q: '제주 해녀의집', tag: 'general', category: 'hansik', target: 10 },
      // 해산물 (50)
      { q: '제주 회 맛집', tag: 'general', category: 'seafood', target: 15 },
      { q: '제주 해산물 맛집', tag: 'general', category: 'seafood', target: 15 },
      { q: '서귀포 해산물 맛집', tag: 'general', category: 'seafood', target: 10 },
      { q: '제주 전복죽 맛집', tag: 'general', category: 'seafood', target: 10 },
      // 카페 (30)
      { q: '제주 카페 인기', tag: 'general', category: 'cafe', target: 15 },
      { q: '서귀포 카페 맛집', tag: 'general', category: 'cafe', target: 15 },
      // 비건 (20+)
      { q: '제주 비건 식당', tag: 'vegan', category: 'vegan', target: 10 },
      { q: '제주 채식 식당', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 비건 카페', tag: 'vegan', category: 'vegan', target: 5 },
      { q: '제주 샐러드 식당', tag: 'vegan', category: 'vegan', target: 5 },
    ],
  },
  gyeongju: {
    target: 100,
    city: 'gyeongju',
    searchQueries: [
      { q: '경주 한식 맛집', tag: 'general', category: 'hansik', target: 20 },
      { q: '경주 맛집 인기', tag: 'general', category: 'general', target: 20 },
      { q: '경주 카페 인기', tag: 'general', category: 'cafe', target: 15 },
      { q: '경주 해산물 맛집', tag: 'general', category: 'seafood', target: 10 },
      { q: '경주 전통음식', tag: 'general', category: 'hansik', target: 10 },
      { q: '경주 황남빵 콩국수', tag: 'general', category: 'hansik', target: 10 },
      { q: '경주 불국사 근처 맛집', tag: 'general', category: 'general', target: 15 },
    ],
  },
  jeonju: {
    target: 100,
    city: 'jeonju',
    searchQueries: [
      { q: '전주 한옥마을 맛집', tag: 'general', category: 'hansik', target: 20 },
      { q: '전주 비빔밥 맛집', tag: 'general', category: 'hansik', target: 15 },
      { q: '전주 맛집 인기', tag: 'general', category: 'general', target: 20 },
      { q: '전주 카페 인기', tag: 'general', category: 'cafe', target: 15 },
      { q: '전주 한정식 맛집', tag: 'general', category: 'hansik', target: 15 },
      { q: '전주 콩나물국밥', tag: 'general', category: 'hansik', target: 15 },
    ],
  },
};

// ── Naver Local Search API ──────────────────────────────────────────────
async function naverLocalSearch(query, start = 1, display = 5) {
  const url = new URL('https://openapi.naver.com/v1/search/local.json');
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(display));
  url.searchParams.set('start', String(start));
  url.searchParams.set('sort', 'comment'); // sort by review count

  const res = await fetch(url.toString(), {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID.trim(),
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET.trim(),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Naver API ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Parse Naver result → our restaurant format ──────────────────────────
function parseNaverResult(item, city, tag, category) {
  // Strip HTML tags from title
  const name = (item.title || '').replace(/<[^>]*>/g, '').trim();
  if (!name) return null;

  // Address
  const address = item.roadAddress || item.address || '';
  if (!address) return null;

  // Validate address starts with Korean city name
  const validPrefixes = ['서울', '부산', '제주', '인천', '경기', '강원', '충청',
    '전라', '경상', '울산', '대구', '대전', '광주', '세종', '전북', '경북'];
  const startsWithCity = validPrefixes.some(p => address.startsWith(p));
  if (!startsWithCity) return null;

  // Coordinates (Naver uses katec → convert)
  const mapx = parseInt(item.mapx, 10);
  const mapy = parseInt(item.mapy, 10);
  let lat = null, lng = null;
  if (mapx && mapy) {
    // Naver Local API returns coordinates in KATECH format (단위: 1/10000000초)
    // Simple approximation for Korea region
    lng = mapx / 10000000;
    lat = mapy / 10000000;
  }

  // Category from Naver
  const naverCategory = item.category || '';

  return {
    name,
    nameEn: '', // Will need manual translation or separate API
    address,
    lat,
    lng,
    rating: 0, // Naver doesn't provide rating in search API
    reviewCount: 0,
    cuisine: naverCategory,
    cuisineKo: naverCategory,
    tag,
    category: category || 'general',
    city,
    dong: extractDong(address),
    source: 'naver_local',
    collectedAt: new Date().toISOString(),
    naverLink: item.link || '',
  };
}

function extractDong(address) {
  // Extract dong/ri from Korean address
  const match = address.match(/([가-힣]+[동리읍면])\b/);
  return match ? match[1] : '';
}

// ── Rate-limited batch search ───────────────────────────────────────────
async function collectForCity(cityKey) {
  const config = CITY_CONFIG[cityKey];
  if (!config) {
    console.error(`❌ Unknown city: ${cityKey}. Available: ${Object.keys(CITY_CONFIG).join(', ')}`);
    return [];
  }

  console.log(`\n🏙️  Collecting restaurants for: ${cityKey.toUpperCase()}`);
  console.log(`   Target: ${config.target} restaurants`);
  console.log(`   Queries: ${config.searchQueries.length}`);

  const allResults = [];
  const seenNames = new Set();
  let apiCalls = 0;

  for (const sq of config.searchQueries) {
    if (apiCalls >= BATCH_LIMIT) {
      console.warn(`⚠️ Batch limit reached (${BATCH_LIMIT}). Resume tomorrow.`);
      break;
    }

    console.log(`\n  🔍 "${sq.q}" (target: ${sq.target}, tag: ${sq.tag})`);
    let collected = 0;

    for (let start = 1; start <= 100 && collected < sq.target; start += 5) {
      try {
        const data = await naverLocalSearch(sq.q, start, 5);
        apiCalls++;

        if (!data.items || data.items.length === 0) break;

        for (const item of data.items) {
          const parsed = parseNaverResult(item, config.city, sq.tag, sq.category);
          if (!parsed) continue;

          // Dedup by name
          const key = parsed.name.replace(/\s+/g, '');
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          allResults.push(parsed);
          collected++;
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, DELAY_MS));

        if (data.items.length < 5) break; // No more results

      } catch (err) {
        console.error(`  ❌ API error: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000)); // Back off on error
      }
    }

    console.log(`     → collected: ${collected}`);
  }

  console.log(`\n  📊 Total collected for ${cityKey}: ${allResults.length} (API calls: ${apiCalls})`);
  return allResults;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const targetCity = process.argv[2] || 'all';
  const cities = targetCity === 'all'
    ? Object.keys(CITY_CONFIG)
    : [targetCity];

  for (const city of cities) {
    if (!CITY_CONFIG[city]) {
      console.error(`❌ Unknown city: ${city}`);
      continue;
    }

    const results = await collectForCity(city);

    if (results.length === 0) {
      console.log(`⚠️ No results for ${city}. Check API keys.`);
      continue;
    }

    // Save to file
    const outPath = join(FOOD_DATA_DIR, `restaurants_${city}_collected.json`);
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`💾 Saved: ${outPath} (${results.length} restaurants)`);

    // Stats
    const tagCounts = {};
    const catCounts = {};
    for (const r of results) {
      tagCounts[r.tag] = (tagCounts[r.tag] || 0) + 1;
      catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    }
    console.log(`  📊 By tag: ${JSON.stringify(tagCounts)}`);
    console.log(`  📊 By category: ${JSON.stringify(catCounts)}`);
  }

  console.log('\n✅ Collection complete!');
  console.log('Next step: Merge into food_data/restaurants_general.json and run:');
  console.log('  node scripts/build-food-index.js');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
