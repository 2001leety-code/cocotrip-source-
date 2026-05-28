/**
 * p261-sync-json-from-firestore.mjs — Firestore zone_courses 의 P261 좌표 + P260 transit_matrix
 * 변경 결과를 JSON SSOT (src/data/zone_courses/*.json) 에 sync. 다음 seed run 회귀 차단.
 *
 * Usage: node scripts/p261-sync-json-from-firestore.mjs [--cities seoul,busan,jeju] [--dry-run]
 *
 * 동기 대상:
 *   1. stops[].lat / lng (P261 Google Places fill 결과)
 *   2. stops[].alt / lng 의 _geocode_source 마커
 *   3. transit_matrix (P260 mock→real ODsay 변환 결과)
 *
 * 미동기: last_p260_update / last_p261_update (Firestore 전용 timestamp)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

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

const ZONE_JSON_DIR = resolve('src/data/zone_courses');

console.log(`=== P261 JSON SSOT sync from Firestore ===`);
console.log(`cities: ${cities.join(',')}, dryRun: ${dryRun}\n`);

// build id → filepath map by scanning all JSONs (id field 매핑)
const fsync = await import('fs');
const allJsonFiles = fsync.readdirSync(ZONE_JSON_DIR).filter((f) => f.endsWith('.json'));
const idToPath = {};
for (const f of allJsonFiles) {
  const p = join(ZONE_JSON_DIR, f);
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (j.id) idToPath[j.id] = p;
  } catch {}
}
console.log(`indexed ${Object.keys(idToPath).length} JSON files by id\n`);

const snap = await db.collection('zone_courses').get();
let totalSynced = 0;
let totalStopsUpdated = 0;
let totalTransitUpdated = 0;
let totalSkipped = 0;
const skippedReasons = {};

for (const doc of snap.docs) {
  const id = doc.id;
  const city = cities.find((c) => id.toLowerCase().startsWith(c.toLowerCase() + '_'));
  if (!city) continue;

  const data = doc.data();
  const fsStops = data.stops || [];
  const fsTransitMatrix = data.transit_matrix || {};

  // doc.id → JSON file (idToPath map 사용 — JSON 의 id field 매핑)
  const jsonPath = idToPath[id];
  if (!jsonPath) {
    totalSkipped++;
    skippedReasons[id] = 'no JSON file with matching id';
    console.log(`  ✗ ${id} — no JSON file with matching id`);
    continue;
  }

  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const jsonStops = json.stops || [];

  let stopsUpdated = 0;
  for (let i = 0; i < jsonStops.length; i++) {
    const fsStop = fsStops[i];
    if (!fsStop) continue;
    const jsonStop = jsonStops[i];

    // 좌표 동기 (lat 0 → fs 의 값으로)
    if ((!jsonStop.lat || jsonStop.lat === 0) && fsStop.lat && fsStop.lat !== 0) {
      jsonStop.lat = fsStop.lat;
      jsonStop.lng = fsStop.lng;
      if (fsStop._geocode_source) {
        jsonStop._geocode_source = fsStop._geocode_source;
      }
      stopsUpdated++;
    }
  }

  // transit_matrix 동기 (mock → real 변환된 entries)
  const jsonTM = json.transit_matrix || {};
  let transitUpdated = 0;
  for (const key of Object.keys(fsTransitMatrix)) {
    const fsEntry = fsTransitMatrix[key];
    const jsonEntry = jsonTM[key];
    if (fsEntry?.source === 'odsay_api' && (!jsonEntry || jsonEntry.source !== 'odsay_api')) {
      jsonTM[key] = fsEntry;
      transitUpdated++;
    }
  }
  if (transitUpdated > 0) {
    json.transit_matrix = jsonTM;
  }

  if (stopsUpdated > 0 || transitUpdated > 0) {
    console.log(`  ✓ ${id} — stops=${stopsUpdated}, transit=${transitUpdated} → ${jsonPath.split(/[\\/]/).pop()}`);
    totalStopsUpdated += stopsUpdated;
    totalTransitUpdated += transitUpdated;
    totalSynced++;
    if (!dryRun) {
      writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
    }
  }
}

console.log('\n=== Result ===');
console.log(`  zones synced:           ${totalSynced}`);
console.log(`  total stops updated:    ${totalStopsUpdated}`);
console.log(`  total transit updated:  ${totalTransitUpdated}`);
console.log(`  zones skipped:          ${totalSkipped}`);
if (totalSkipped > 0) {
  for (const [id, reason] of Object.entries(skippedReasons).slice(0, 10)) {
    console.log(`    ${id}: ${reason}`);
  }
}

process.exit(0);
