/**
 * p261-fill-coords.mjs — zone_courses Firestore stops.lat=0 좌표 보강 (P195 Phase 1 prerequisite).
 *
 * Usage: node scripts/p261-fill-coords.mjs [--cities seoul,busan,jeju] [--dry-run]
 *
 * 배경 (2026-05-28):
 *   P259 머지 후 cache hit 27% 도달. P260 dry-run 결과 mock→real 변환 불가 — root cause:
 *   stops.lat/lng=0 (39 stops) + ODsay 도보권 미반환 (22 transit). 좌표 보강 prerequisite.
 *
 * Strategy:
 *   1. Firestore zone_courses 조회 (city prefix filter)
 *   2. stops.lat=0 추출 + address/name 으로 Naver Geocoding 시도
 *   3. Naver fail 시 Google Places textsearch fallback
 *   4. dry-run = console 만 / apply = Firestore docs update
 *
 * 다음 step (apply 후):
 *   - JSON SSOT 도 update (별도 PR) — 다음 seed run 회귀 방지
 *   - seed-zone-courses-firestore.mjs 재실행 → ODsay fetch trigger (mock→real)
 *
 * 비용: Naver Geocoding 무료 quota / Google Places ~$0.017/call × 40 = ~$0.7 (Google fallback 시)
 */
import { readFileSync } from 'fs';

for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, '\n');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

const args = process.argv.slice(2);
let cities = ['seoul', 'busan', 'jeju'];
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cities' && args[i + 1]) {
    cities = args[++i].split(',').map((c) => c.trim().toLowerCase());
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

// NCP_CLIENT_ID (seed script naming) 또는 NAVER_CLIENT_ID (RouteAgent naming, 같은 NCP API 키) 사용.
// 운영자 env 에는 NAVER_CLIENT_ID 만 있고 NCP_CLIENT_ID 별도 alias 없음.
const ncpId = (process.env.NCP_CLIENT_ID || process.env.NAVER_CLIENT_ID || '').trim();
const ncpSecret = (process.env.NCP_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET || '').trim();
const googleKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();

if (!ncpId || !ncpSecret) {
  console.error('NCP_CLIENT_ID/NAVER_CLIENT_ID + SECRET missing — Naver Geocoding 불가');
  process.exit(1);
}
console.log('Google Places fallback:', googleKey ? 'available' : 'DISABLED');

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let privateKey = rawKey;
if (pemMatch) {
  const b64 = pemMatch[1].replace(/\s+/g, '');
  const lines = b64.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
}
initializeApp({
  credential: cert({
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
    clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey,
  }),
});
const db = getFirestore();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function naverGeocode(query) {
  if (!query) return null;
  try {
    const url = `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': ncpId, 'X-NCP-APIGW-API-KEY': ncpSecret },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.addresses && data.addresses.length > 0) {
      return {
        lat: parseFloat(data.addresses[0].y),
        lng: parseFloat(data.addresses[0].x),
        source: 'naver_geocode',
        matched: data.addresses[0].roadAddress || data.addresses[0].jibunAddress || query,
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function googlePlacesSearch(query) {
  if (!googleKey || !query) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=kr&language=ko&key=${googleKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const loc = data.results[0].geometry?.location;
      if (loc) {
        return {
          lat: loc.lat,
          lng: loc.lng,
          source: 'google_places',
          matched: data.results[0].name + ' / ' + (data.results[0].formatted_address || ''),
        };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function geocodeStop(stop) {
  // Strategy: address → name+region → name 으로 fallback
  const queries = [
    stop.address,
    stop.name && stop.address ? `${stop.name} ${stop.address}` : null,
    stop.name,
  ].filter(Boolean);

  for (const q of queries) {
    await sleep(200);
    const naver = await naverGeocode(q);
    if (naver) return naver;
  }

  if (googleKey) {
    for (const q of queries) {
      await sleep(200);
      const google = await googlePlacesSearch(q);
      if (google) return google;
    }
  }

  return null;
}

console.log(`=== P261 좌표 보강 ===`);
console.log(`cities: ${cities.join(',')}, dryRun: ${dryRun}\n`);

const snap = await db.collection('zone_courses').get();
const targetDocs = [];
snap.forEach((doc) => {
  const city = cities.find((c) => doc.id.toLowerCase().startsWith(c.toLowerCase() + '_'));
  if (city) targetDocs.push({ id: doc.id, data: doc.data(), city });
});

console.log(`target zones: ${targetDocs.length}\n`);

let totalMissing = 0;
let totalFilled = 0;
let totalStillMissing = 0;
let totalDocsUpdated = 0;

for (const { id, data } of targetDocs) {
  const stops = data.stops || [];
  const missingStops = stops
    .map((s, i) => ({ ...s, _idx: i }))
    .filter((s) => !s.lat || s.lat === 0 || !s.lng || s.lng === 0);
  if (missingStops.length === 0) continue;
  totalMissing += missingStops.length;

  console.log(`--- ${id} (${missingStops.length} stops missing) ---`);

  let filled = 0;
  const newStops = [...stops];
  for (const stop of missingStops) {
    const result = await geocodeStop(stop);
    if (result) {
      newStops[stop._idx] = {
        ...newStops[stop._idx],
        lat: result.lat,
        lng: result.lng,
        _geocode_source: result.source,
      };
      filled++;
      console.log(`  ✓ order=${stop.order} "${stop.name || stop.address || '?'}" → (${result.lat.toFixed(4)},${result.lng.toFixed(4)}) [${result.source}]`);
    } else {
      console.log(`  ✗ order=${stop.order} "${stop.name || stop.address || '?'}" — geocode FAIL`);
    }
  }

  totalFilled += filled;
  totalStillMissing += (missingStops.length - filled);

  if (!dryRun && filled > 0) {
    await db.collection('zone_courses').doc(id).update({
      stops: newStops,
      last_p261_update: new Date().toISOString(),
    });
    totalDocsUpdated++;
    console.log(`  → Firestore updated (${filled} stops filled)`);
  }
}

console.log('\n=== Result ===');
console.log(`  zones processed:         ${targetDocs.length}`);
console.log(`  docs updated:            ${totalDocsUpdated}`);
console.log(`  total missing (before):  ${totalMissing}`);
console.log(`  filled by geocoding:     ${totalFilled} (${totalMissing ? Math.round((totalFilled / totalMissing) * 100) : 0}%)`);
console.log(`  still missing (fail):    ${totalStillMissing}`);

process.exit(0);
