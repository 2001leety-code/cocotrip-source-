#!/usr/bin/env node
/**
 * CocoTrip — Busan Data Collection Script (Naver Local Search API)
 *
 * Collects Busan restaurant & attraction data for Phase 6 DB expansion.
 * Categories:
 *   seafood   — 횟집/해산물 (자갈치, 해운대, 광안리)   target: 80
 *   cafe      — 카페 (감천, 부산타워, 광안리뷰, 해운대) target: 150
 *   restaurant — 음식점 (밀면, 돼지국밥, 향토음식)     target: 150
 *   attraction — 관광 명소                             target: 50
 *
 * Usage:
 *   node scripts/collect-busan.mjs seafood
 *   node scripts/collect-busan.mjs cafe
 *   node scripts/collect-busan.mjs restaurant
 *   node scripts/collect-busan.mjs attraction
 *   node scripts/collect-busan.mjs all
 *
 * Rate limit: Naver 25,000 req/day total
 * Output:
 *   food_data/busan_seafood.json
 *   food_data/busan_cafe.json
 *   food_data/busan_restaurant.json
 *   food_data/busan_attraction.json
 *
 * Requires: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET env vars (.env or exported)
 * Next step: node scripts/enrich-busan.mjs  (Google Places 평점 보강)
 *            node scripts/build-food-index.js (index 재빌드)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── .env 로더 (dotenv 의존성 없이) ──────────────────────────────────────────
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

// ── Config ──────────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID     = (process.env.NAVER_CLIENT_ID     || '').trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || '').trim();

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  console.error('❌ NAVER_CLIENT_ID and NAVER_CLIENT_SECRET required');
  console.error('   Set in .env or export before running');
  process.exit(1);
}

// food_data 디렉토리: 기존 스크립트와 동일 경로 (루트/../../food_data 대신 루트/food_data로 변경)
// → 프로젝트 루트 아래 food_data/ 폴더를 사용
const FOOD_DATA_DIR = join(ROOT, 'food_data');
if (!existsSync(FOOD_DATA_DIR)) {
  mkdirSync(FOOD_DATA_DIR, { recursive: true });
  console.log(`📁 Created: ${FOOD_DATA_DIR}`);
}

const DELAY_MS   = 220;   // 약 4.5 req/s (Naver 한도 여유)
const BATCH_LIMIT = 8000; // 전체 API 호출 상한 (4 카테고리 × ~2000)

// ── 카테고리별 검색 쿼리 정의 ────────────────────────────────────────────────
/**
 * Naver Local Search API max 5 results per query.
 * Pagination > 1 은 중복이 많아 단일 호출 × 다양한 쿼리 전략 사용.
 */
const CATEGORY_CONFIG = {

  // ────────────────────────────────────────────────────────────────────────
  seafood: {
    outputFile: 'busan_seafood.json',
    tag: 'general',
    category: 'seafood',
    target: 80,
    searchQueries: [
      // 자갈치
      { q: '부산 자갈치 횟집', area: 'jagalchi' },
      { q: '자갈치 시장 회', area: 'jagalchi' },
      { q: '자갈치 해산물', area: 'jagalchi' },
      { q: '자갈치 조개구이', area: 'jagalchi' },
      { q: '남포동 횟집', area: 'jagalchi' },
      { q: '남포동 해산물', area: 'jagalchi' },
      { q: '영도 횟집', area: 'jagalchi' },
      // 해운대
      { q: '해운대 횟집', area: 'haeundae' },
      { q: '해운대 해산물 맛집', area: 'haeundae' },
      { q: '해운대 회 맛집', area: 'haeundae' },
      { q: '해운대 조개구이', area: 'haeundae' },
      { q: '해운대 대게', area: 'haeundae' },
      { q: '해운대 랍스터', area: 'haeundae' },
      { q: '마린시티 횟집', area: 'haeundae' },
      { q: '해운대 수산시장', area: 'haeundae' },
      // 광안리
      { q: '광안리 횟집', area: 'gwangalli' },
      { q: '광안리 해산물', area: 'gwangalli' },
      { q: '수영구 횟집', area: 'gwangalli' },
      { q: '광안리 조개구이 맛집', area: 'gwangalli' },
      // 기타 부산 해산물
      { q: '부산 해산물 맛집', area: 'busan' },
      { q: '부산 회 맛집 추천', area: 'busan' },
      { q: '부산 조개구이 맛집', area: 'busan' },
      { q: '부산 대게 맛집', area: 'busan' },
      { q: '부산 랍스터 레스토랑', area: 'busan' },
      { q: '부산 물회 맛집', area: 'busan' },
      { q: '부산 해물탕 맛집', area: 'busan' },
      { q: '기장 횟집', area: 'gijang' },
      { q: '기장 해산물', area: 'gijang' },
      { q: '기장 대게 맛집', area: 'gijang' },
      { q: '송정 횟집', area: 'gijang' },
      { q: '동래 해산물', area: 'dongrae' },
      { q: '부산 게장 맛집', area: 'busan' },
      { q: '부산 생선구이 맛집', area: 'busan' },
      { q: '부산 해물파전 맛집', area: 'busan' },
      { q: '감천 해산물', area: 'gamcheon' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  cafe: {
    outputFile: 'busan_cafe.json',
    tag: 'general',
    category: 'cafe',
    target: 150,
    searchQueries: [
      // 감천문화마을
      { q: '감천문화마을 카페', area: 'gamcheon' },
      { q: '감천 카페 맛집', area: 'gamcheon' },
      { q: '감천 인스타 카페', area: 'gamcheon' },
      // 해운대
      { q: '해운대 카페 추천', area: 'haeundae' },
      { q: '해운대 오션뷰 카페', area: 'haeundae' },
      { q: '해운대 뷰 카페', area: 'haeundae' },
      { q: '해운대 루프탑 카페', area: 'haeundae' },
      { q: '해운대 브런치 카페', area: 'haeundae' },
      { q: '해운대 베이커리 카페', area: 'haeundae' },
      { q: '마린시티 카페', area: 'haeundae' },
      { q: '달맞이길 카페', area: 'haeundae' },
      { q: '달맞이 카페 맛집', area: 'haeundae' },
      { q: '해운대 디저트 카페', area: 'haeundae' },
      // 광안리
      { q: '광안리 뷰 카페', area: 'gwangalli' },
      { q: '광안리 카페 맛집', area: 'gwangalli' },
      { q: '광안리 오션뷰 카페', area: 'gwangalli' },
      { q: '광안대교뷰 카페', area: 'gwangalli' },
      { q: '수영구 카페 추천', area: 'gwangalli' },
      { q: '광안리 루프탑 카페', area: 'gwangalli' },
      { q: '광안리 브런치 카페', area: 'gwangalli' },
      // 남포/BIFF/서면
      { q: '남포동 카페', area: 'nampo' },
      { q: 'BIFF광장 카페', area: 'nampo' },
      { q: '서면 카페 맛집', area: 'seomyeon' },
      { q: '서면 감성 카페', area: 'seomyeon' },
      { q: '전포 카페 거리', area: 'seomyeon' },
      { q: '전포동 카페', area: 'seomyeon' },
      // 부산타워/용두산
      { q: '부산타워 근처 카페', area: 'nampo' },
      { q: '용두산 공원 카페', area: 'nampo' },
      // 기타 지역
      { q: '송도 카페 뷰', area: 'songdo' },
      { q: '암남공원 카페', area: 'songdo' },
      { q: '흰여울 카페', area: 'songdo' },
      { q: '흰여울문화마을 카페', area: 'songdo' },
      { q: '태종대 카페', area: 'taejongdae' },
      { q: '기장 카페 추천', area: 'gijang' },
      { q: '기장 오션뷰 카페', area: 'gijang' },
      { q: '동래 카페 맛집', area: 'dongrae' },
      { q: '부산 부암동 카페', area: 'busan' },
      // 인기 카테고리
      { q: '부산 루프탑 카페', area: 'busan' },
      { q: '부산 오션뷰 카페', area: 'busan' },
      { q: '부산 인스타 카페', area: 'busan' },
      { q: '부산 감성 카페', area: 'busan' },
      { q: '부산 베이커리 카페', area: 'busan' },
      { q: '부산 스페셜티 커피', area: 'busan' },
      { q: '부산 로스터리 카페', area: 'busan' },
      { q: '부산 디저트 카페', area: 'busan' },
      { q: '부산 와플 카페', area: 'busan' },
      { q: '부산 크로플 맛집', area: 'busan' },
      { q: '부산 제과점 빵집', area: 'busan' },
      { q: '부산 티 카페', area: 'busan' },
      { q: '부산 카페 야경', area: 'busan' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  restaurant: {
    outputFile: 'busan_restaurant.json',
    tag: 'general',
    category: 'restaurant',
    target: 150,
    searchQueries: [
      // 부산 시그니처 음식
      { q: '부산 밀면 맛집', area: 'busan' },
      { q: '밀면 원조 부산', area: 'busan' },
      { q: '부산 돼지국밥 맛집', area: 'busan' },
      { q: '부산 돼지국밥 추천', area: 'busan' },
      { q: '부산 어묵 맛집', area: 'busan' },
      { q: '부산 어묵탕 맛집', area: 'busan' },
      { q: '부산 만두 맛집', area: 'busan' },
      { q: '부산 씨앗호떡', area: 'busan' },
      { q: '국제시장 먹거리', area: 'busan' },
      { q: '깡통야시장 맛집', area: 'busan' },
      // 해운대
      { q: '해운대 맛집 추천', area: 'haeundae' },
      { q: '해운대 한식 맛집', area: 'haeundae' },
      { q: '해운대 고기집', area: 'haeundae' },
      { q: '해운대 국밥 맛집', area: 'haeundae' },
      { q: '해운대 냉면 맛집', area: 'haeundae' },
      { q: '해운대 파스타 맛집', area: 'haeundae' },
      { q: '해운대 스테이크', area: 'haeundae' },
      // 광안리
      { q: '광안리 맛집 추천', area: 'gwangalli' },
      { q: '광안리 한식당', area: 'gwangalli' },
      { q: '광안리 고기구이', area: 'gwangalli' },
      { q: '광안리 이탈리안', area: 'gwangalli' },
      // 서면/부전
      { q: '서면 맛집 추천', area: 'seomyeon' },
      { q: '서면 삼겹살 맛집', area: 'seomyeon' },
      { q: '서면 한식 맛집', area: 'seomyeon' },
      { q: '부전시장 맛집', area: 'seomyeon' },
      // 남포/BIFF/중구
      { q: '남포동 맛집 추천', area: 'nampo' },
      { q: 'BIFF광장 맛집', area: 'nampo' },
      { q: '부산 중구 맛집', area: 'nampo' },
      { q: '자갈치 맛집', area: 'jagalchi' },
      // 동래/온천장
      { q: '동래 파전 맛집', area: 'dongrae' },
      { q: '동래 한식 맛집', area: 'dongrae' },
      { q: '온천장 맛집', area: 'dongrae' },
      { q: '부산 족발 맛집', area: 'busan' },
      { q: '부산 곱창 맛집', area: 'busan' },
      { q: '부산 삼겹살 맛집', area: 'busan' },
      { q: '부산 초밥 맛집', area: 'busan' },
      { q: '부산 라멘 맛집', area: 'busan' },
      // 향토
      { q: '부산 향토 음식', area: 'busan' },
      { q: '부산 한정식 맛집', area: 'busan' },
      { q: '부산 국밥 추천', area: 'busan' },
      { q: '부산 해장국 맛집', area: 'busan' },
      { q: '부산 갈비탕 맛집', area: 'busan' },
      { q: '부산 찜닭 맛집', area: 'busan' },
      { q: '부산 회덮밥 맛집', area: 'busan' },
      { q: '부산 뷔페 맛집', area: 'busan' },
      { q: '부산 퓨전 레스토랑', area: 'busan' },
      { q: '부산 중식 맛집', area: 'busan' },
      { q: '부산 양식 맛집', area: 'busan' },
      { q: '기장 맛집 추천', area: 'gijang' },
      { q: '기장 멸치쌈밥', area: 'gijang' },
      { q: '부산 비건 식당', area: 'busan' },
      { q: '부산 채식 맛집', area: 'busan' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  attraction: {
    outputFile: 'busan_attraction.json',
    tag: 'general',
    category: 'attraction',
    target: 50,
    searchQueries: [
      // 해변/바다
      { q: '해운대 해수욕장', area: 'haeundae' },
      { q: '광안리 해수욕장', area: 'gwangalli' },
      { q: '송도해수욕장 부산', area: 'songdo' },
      { q: '다대포 해수욕장', area: 'dadaepo' },
      { q: '일광해수욕장', area: 'gijang' },
      // 문화/역사
      { q: '감천문화마을', area: 'gamcheon' },
      { q: '자갈치시장', area: 'jagalchi' },
      { q: '국제시장 부산', area: 'nampo' },
      { q: 'BIFF광장 부산', area: 'nampo' },
      { q: '용두산공원 부산타워', area: 'nampo' },
      { q: '영도대교 부산', area: 'nampo' },
      { q: '흰여울문화마을', area: 'songdo' },
      // 자연/공원
      { q: '태종대 부산', area: 'taejongdae' },
      { q: '이기대 해안산책로', area: 'gwangalli' },
      { q: '아홉산숲 기장', area: 'gijang' },
      { q: '부산 황령산', area: 'busan' },
      { q: '금정산 범어사', area: 'busan' },
      // 레저
      { q: '송도해상케이블카', area: 'songdo' },
      { q: '해운대 스카이캡슐', area: 'haeundae' },
      { q: '다대포 꿈의낙조분수', area: 'dadaepo' },
      // 야경/랜드마크
      { q: '광안대교 야경', area: 'gwangalli' },
      { q: '부산 야경 명소', area: 'busan' },
      { q: '해운대 엘시티 전망대', area: 'haeundae' },
      // 쇼핑
      { q: '부산 신세계 센텀시티', area: 'centumcity' },
      { q: '해운대 더베이101', area: 'haeundae' },
      // 사찰
      { q: '해동용궁사', area: 'gijang' },
      { q: '범어사 부산', area: 'busan' },
      { q: '서동 고분군', area: 'busan' },
      // F1963 / 복합문화
      { q: 'F1963 수영구', area: 'gwangalli' },
      { q: '부산현대미술관', area: 'dadaepo' },
      { q: '부산영화촬영스튜디오', area: 'busan' },
    ],
  },
};

// ── Naver Local Search API ───────────────────────────────────────────────────
async function naverLocalSearch(query, start = 1, display = 5) {
  const url = new URL('https://openapi.naver.com/v1/search/local.json');
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(display));
  url.searchParams.set('start', String(start));
  url.searchParams.set('sort', 'comment');

  const res = await fetch(url.toString(), {
    headers: {
      'X-Naver-Client-Id':     NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Naver API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── parse Naver result → unified schema ─────────────────────────────────────
function parseNaverResult(item, categoryKey, tag, category, area) {
  const name = (item.title || '').replace(/<[^>]*>/g, '').trim();
  if (!name) return null;

  const address = item.roadAddress || item.address || '';
  if (!address) return null;

  // 부산 주소만 수락
  const busanPrefixes = [
    '부산광역시', '부산시', '부산',
    // 기장군은 경남으로 표기되기도 함
    '경상남도 기장',
  ];
  const isBusan = busanPrefixes.some(p => address.startsWith(p));
  if (!isBusan) return null;

  // 좌표 (Naver KATECH 단위)
  const mapx = parseInt(item.mapx, 10);
  const mapy = parseInt(item.mapy, 10);
  let lat = null, lng = null;
  if (mapx && mapy) {
    lng = mapx / 10000000;
    lat = mapy / 10000000;
  }

  const naverCategory = item.category || '';

  return {
    name,
    nameEn: '',
    address,
    lat,
    lng,
    rating: 0,         // Google Places 보강 전 0
    reviewCount: 0,
    cuisine: naverCategory,
    cuisineKo: naverCategory,
    priceLevel: null,
    tag,
    category,
    city: 'busan',
    dong: extractDong(address),
    area,              // 수집 구역 메타 (해운대, 광안리 등)
    // 외국인 친화 메타 — Google Places 보강 후 채워짐
    hasEnglishMenu: null,
    wheelchairAccessible: null,
    source: 'naver_local',
    collectedAt: new Date().toISOString(),
    naverLink: item.link || '',
  };
}

function extractDong(address) {
  const match = address.match(/([가-힣]+[동리읍면])\b/);
  return match ? match[1] : '';
}

// ── 카테고리 수집 ──────────────────────────────────────────────────────────
async function collectCategory(categoryKey) {
  const config = CATEGORY_CONFIG[categoryKey];
  if (!config) {
    console.error(`❌ Unknown category: ${categoryKey}. Available: ${Object.keys(CATEGORY_CONFIG).join(', ')}`);
    return [];
  }

  console.log(`\n📦 Collecting: ${categoryKey.toUpperCase()}`);
  console.log(`   Target : ${config.target}`);
  console.log(`   Queries: ${config.searchQueries.length}`);

  const allResults = [];
  const seenNames  = new Set();
  let apiCalls = 0;

  for (const sq of config.searchQueries) {
    if (apiCalls >= BATCH_LIMIT) {
      console.warn(`⚠️  Batch limit reached (${BATCH_LIMIT}). Resume later.`);
      break;
    }

    try {
      const data = await naverLocalSearch(sq.q, 1, 5);
      apiCalls++;

      if (data.items && data.items.length > 0) {
        let added = 0;
        for (const item of data.items) {
          const parsed = parseNaverResult(
            item, categoryKey, config.tag, config.category, sq.area,
          );
          if (!parsed) continue;

          const key = parsed.name.replace(/\s+/g, '');
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          allResults.push(parsed);
          added++;
        }
        if (added > 0) {
          process.stdout.write(`  [${apiCalls}] "${sq.q}" → +${added} (total: ${allResults.length})\n`);
        }
      }

      await new Promise(r => setTimeout(r, DELAY_MS));

    } catch (err) {
      console.error(`  ❌ "${sq.q}": ${err.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n  📊 ${categoryKey}: ${allResults.length} items (${apiCalls} API calls)`);
  return allResults;
}

// ── 저장 ────────────────────────────────────────────────────────────────────
function saveResults(categoryKey, results) {
  const config = CATEGORY_CONFIG[categoryKey];
  const outPath = join(FOOD_DATA_DIR, config.outputFile);
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`💾 Saved: ${outPath} (${results.length} items)`);

  // 구역별 통계
  const areaCounts = {};
  for (const r of results) {
    areaCounts[r.area || 'unknown'] = (areaCounts[r.area || 'unknown'] || 0) + 1;
  }
  console.log('   By area:', JSON.stringify(areaCounts));
  return outPath;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const targetCategory = process.argv[2] || 'all';
  const categories = targetCategory === 'all'
    ? Object.keys(CATEGORY_CONFIG)
    : [targetCategory];

  console.log('🌊 CocoTrip — Busan Data Collection');
  console.log(`   Categories: ${categories.join(', ')}`);
  console.log(`   Output dir: ${FOOD_DATA_DIR}`);
  console.log(`   Rating filter applied AFTER Google Places enrichment\n`);

  const saved = [];

  for (const cat of categories) {
    if (!CATEGORY_CONFIG[cat]) {
      console.error(`❌ Unknown category: ${cat}`);
      continue;
    }

    const results = await collectCategory(cat);
    if (results.length === 0) {
      console.log(`⚠️  No results for ${cat}. Check API keys.`);
      continue;
    }

    const path = saveResults(cat, results);
    saved.push({ cat, count: results.length, path });
  }

  console.log('\n========================================');
  console.log('✅ Collection complete!');
  console.log('\nFiles saved:');
  for (const s of saved) {
    console.log(`  ${s.cat.padEnd(12)} → ${s.count} items  [${s.path}]`);
  }
  console.log('\nNext steps:');
  console.log('  1. node scripts/enrich-busan.mjs          # Google Places 평점 보강 (4.6+ 필터)');
  console.log('  2. node scripts/build-food-index.js       # _food_index.json 재빌드');
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
