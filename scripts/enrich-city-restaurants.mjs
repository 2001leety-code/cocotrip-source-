/**
 * enrich-city-restaurants.mjs
 *
 * food_data/restaurants_{jeju,gyeongju,jeonju}_collected.json 의 rating=0
 * 항목을 Google Places (legacy Find Place From Text) 로 보강한다.
 *
 * 입력 항목에 lat/lng/name/address 가 있으므로 locationbias 로 정확도 ↑.
 * 응답에서 place_id, rating, user_ratings_total 을 추출해 in-place 갱신.
 *
 * 멱등: placeId 가 이미 있는 항목은 스킵.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... node scripts/enrich-city-restaurants.mjs \
 *     --allow-paid-google-places --max-paid-requests=20 --city=jeju
 *   # --dry도 API는 호출하므로 위 유료 호출 승인·상한이 반드시 필요하다.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createPaidRequestGate, parsePaidGooglePlacesConsent } from './_paid-google-places-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 유료 API는 실수로 실행할 수 없게 명시 승인 + 절대 요청 상한을 먼저 검사한다.
// 이 검사는 .env를 읽기 전이므로 승인 없는 실행은 키에도 접근하지 않는다.
const args = process.argv.slice(2);
let paidConsent;
try {
  paidConsent = parsePaidGooglePlacesConsent(args);
} catch (error) {
  console.error(`⛔ ${error.message}`);
  process.exit(2);
}
const paidRequestGate = createPaidRequestGate(paidConsent.maxRequests);
const DRY = args.includes('--dry');
const cityFilter = (args.find(a => a.startsWith('--city=')) || '').split('=')[1];

// Minimal .env loader (avoid adding dotenv dependency)
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

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY missing (.env)');
  process.exit(1);
}

const FOOD_DATA_DIR = join(ROOT, '..', '..', 'food_data');
const CITIES = ['jeju', 'gyeongju', 'jeonju'];

const FIND_PLACE_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPlace({ name, city, lat, lng }) {
  const input = `${name} ${city}`;
  const params = new URLSearchParams({
    input,
    inputtype: 'textquery',
    fields: 'place_id,name,rating,user_ratings_total,formatted_address',
    language: 'ko',
    key: API_KEY,
  });
  if (lat && lng) {
    params.set('locationbias', `circle:500@${lat},${lng}`);
  }
  const url = `${FIND_PLACE_URL}?${params.toString()}`;
  paidRequestGate.reserve();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'OK' && data.candidates?.[0]) {
    return data.candidates[0];
  }
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'RESOURCE_EXHAUSTED') {
    throw new Error(`Quota: ${data.status}`);
  }
  if (data.status !== 'OK') {
    console.warn(`  ⚠ ${data.status} for "${name}"${data.error_message ? ' — ' + data.error_message : ''}`);
    return null;
  }
  return null;
}

async function enrichCity(city) {
  const file = join(FOOD_DATA_DIR, `restaurants_${city}_collected.json`);
  if (!existsSync(file)) {
    console.warn(`  ⚠ ${file} not found — skip`);
    return { city, total: 0, enriched: 0, miss: 0, skipped: 0 };
  }

  const data = JSON.parse(readFileSync(file, 'utf-8'));
  const backup = file.replace('.json', '.backup.json');
  if (!existsSync(backup) && !DRY) {
    copyFileSync(file, backup);
    console.log(`  💾 backup → ${backup.split(/[\\/]/).pop()}`);
  }

  let enriched = 0, miss = 0, skipped = 0;
  const total = DRY ? Math.min(5, data.length) : data.length;
  console.log(`\n🍽️  ${city} (${total} entries)`);

  for (let i = 0; i < total; i++) {
    const item = data[i];
    if (item.placeId && item.rating > 0) {
      skipped++;
      continue;
    }
    try {
      const found = await findPlace({
        name: item.name,
        city,
        lat: item.lat,
        lng: item.lng,
      });
      if (found) {
        item.placeId = found.place_id;
        item.rating = found.rating || 0;
        item.reviewCount = found.user_ratings_total || 0;
        if (found.formatted_address) item.address = found.formatted_address;
        item.googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${found.place_id}`;
        enriched++;
        if ((i + 1) % 20 === 0 || i + 1 === total) {
          console.log(`  ${i + 1}/${total} — ✅ ${item.name} (${item.rating}★ × ${item.reviewCount})`);
        }
      } else {
        miss++;
      }
    } catch (err) {
      console.error(`  ${i + 1}/${total} — ✗ ${item.name}: ${err.message}`);
      if (String(err.message || '').startsWith('PAID_REQUEST_CAP_REACHED')) throw err;
      if (err.message.startsWith('Quota')) throw err;
    }
    await sleep(100);  // 10 req/s
  }

  if (!DRY) {
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  💾 saved → ${file.split(/[\\/]/).pop()}`);
  } else {
    console.log(`  (dry run — not saved)`);
  }

  return { city, total, enriched, miss, skipped };
}

async function main() {
  console.log('🌐 Google Places enrichment — jeju/gyeongju/jeonju');
  console.log(`   PAID REQUEST HARD CAP: ${paidConsent.maxRequests}`);
  if (DRY) console.log('   (DRY mode — first 5 per city; API calls are still billable)');

  const cities = cityFilter ? [cityFilter] : CITIES;
  const results = [];
  for (const city of cities) {
    if (!CITIES.includes(city)) {
      console.warn(`  ⚠ unknown city: ${city}`);
      continue;
    }
    const r = await enrichCity(city);
    results.push(r);
  }

  console.log('\n📊 Summary');
  let totEnriched = 0, totMiss = 0, totSkipped = 0;
  for (const r of results) {
    console.log(`  ${r.city.padEnd(10)} total=${r.total} enriched=${r.enriched} miss=${r.miss} skipped=${r.skipped}`);
    totEnriched += r.enriched;
    totMiss += r.miss;
    totSkipped += r.skipped;
  }
  console.log(`  ${'TOTAL'.padEnd(10)} enriched=${totEnriched} miss=${totMiss} skipped=${totSkipped}`);
  console.log('\n✅ Done. Next: node scripts/build-food-index.js');
}

main().catch(err => {
  console.error('💥', err);
  process.exit(1);
});
