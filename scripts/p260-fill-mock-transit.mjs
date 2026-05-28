/**
 * p260-fill-mock-transit.mjs — zone_courses transit_matrix 의 source='mock' entries 만
 * ODsay 실측으로 변환. seed-zone-courses-firestore.mjs 의 needsTransit 한계 우회.
 *
 * Usage: node scripts/p260-fill-mock-transit.mjs [--cities seoul,busan,jeju] [--dry-run]
 *
 * 배경 (2026-05-28):
 *   - P259 검증 결과 prod cache hit = 27% (3/11 transit, plan fb33722e)
 *   - hit rate ceiling = zone_courses real:mock 비율 = 약 50% (P234 stats)
 *   - 50%+ 도달 위해 mock entries 를 ODsay 실측으로 보강 필요
 *   - seed-zone-courses-firestore.mjs:200 needsTransit 가 "전체 mock or empty" 만 fetch
 *     → real:mock 혼재 zone (서울 9 zone 중 9 zone 모두 해당) 의 mock entries 영원히 미보강
 *
 * Fix: 본 script 가 각 zone 의 mock entries 만 골라서 ODsay 호출 + transit_matrix[key] 만 update.
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

const odsayKey = (process.env.ODSAY_API_KEY || '').trim();
if (!odsayKey) {
  console.error('ODSAY_API_KEY missing');
  process.exit(1);
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

const ODSAY_BASE = 'https://api.odsay.com/v1/api';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchOdsay(sx, sy, ex, ey) {
  const url = `${ODSAY_BASE}/searchPubTransPathT?apiKey=${odsayKey}&SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&OPT=0&SearchType=0&SearchPathType=0`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`ODsay HTTP ${res.status}`);
  const data = await res.json();
  if (!data.result?.path?.[0]) return null;
  const p = data.result.path[0];
  return {
    pathType: p.pathType,
    totalTime: p.info.totalTime,
    distance: p.info.totalDistance,
    payment: p.info.payment,
  };
}

function pathTypeToMode(pt) {
  if (pt === 1) return 'subway';
  if (pt === 2) return 'bus';
  if (pt === 3) return 'subway+bus';
  return 'mixed';
}

function buildNaverRouteUrl(fromName, fromLat, fromLng, toName, toLat, toLng) {
  const f = encodeURIComponent(fromName || '');
  const t = encodeURIComponent(toName || '');
  return `https://map.naver.com/p/directions/${fromLng},${fromLat},${f},,/${toLng},${toLat},${t},,/-/transit`;
}

console.log(`=== P260 mock → real transit 보강 ===`);
console.log(`cities: ${cities.join(',')}, dryRun: ${dryRun}\n`);

// 1. zone_courses 컬렉션 조회 (city prefix 필터)
const snap = await db.collection('zone_courses').get();
const targetDocs = [];
snap.forEach((doc) => {
  const city = cities.find((c) => doc.id.toLowerCase().startsWith(c.toUpperCase() + '_') || doc.id.toLowerCase().startsWith(c.toLowerCase() + '_'));
  if (city) targetDocs.push({ id: doc.id, data: doc.data(), city });
});

console.log(`target zones: ${targetDocs.length}`);

let totalMockBefore = 0;
let totalRealBefore = 0;
let totalConverted = 0;
let totalFailedOdsay = 0;
let totalSkippedNoCoord = 0;
let totalDocs = 0;

const today = new Date().toISOString().slice(0, 10);

for (const { id, data, city } of targetDocs) {
  const tm = data.transit_matrix || {};
  const mockKeys = Object.keys(tm).filter((k) => tm[k]?.source === 'mock');
  const realKeys = Object.keys(tm).filter((k) => tm[k]?.source === 'odsay_api');
  totalMockBefore += mockKeys.length;
  totalRealBefore += realKeys.length;
  if (mockKeys.length === 0) continue;

  const stops = (data.stops || []).reduce((acc, s) => {
    acc[s.order] = s;
    return acc;
  }, {});

  let converted = 0;
  let failedOdsay = 0;
  let skippedNoCoord = 0;
  const newTM = { ...tm };

  for (const key of mockKeys) {
    const [fromOrder, toOrder] = key.split('->').map((n) => parseInt(n, 10));
    const a = stops[fromOrder];
    const b = stops[toOrder];
    if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng || a.lat === 0 || b.lat === 0) {
      skippedNoCoord++;
      continue;
    }
    try {
      await sleep(200); // rate limit
      const od = await searchOdsay(a.lng, a.lat, b.lng, b.lat);
      if (od) {
        const fromName = a.name || a.address;
        const toName = b.name || b.address;
        const entry = {
          from_order: fromOrder,
          to_order: toOrder,
          mode: pathTypeToMode(od.pathType),
          duration_min: od.totalTime,
          distance_m: od.distance,
          cost_krw: od.payment,
          naver_route_url: buildNaverRouteUrl(fromName, a.lat, a.lng, toName, b.lat, b.lng),
          source: 'odsay_api',
          fetched_at: today,
        };
        entry.base = {
          mode: entry.mode,
          duration_min: entry.duration_min,
          distance_m: entry.distance_m,
          cost_krw: entry.cost_krw,
        };
        newTM[key] = entry;
        converted++;
      } else {
        failedOdsay++;
      }
    } catch (e) {
      failedOdsay++;
    }
  }

  totalConverted += converted;
  totalFailedOdsay += failedOdsay;
  totalSkippedNoCoord += skippedNoCoord;
  console.log(
    `  ${id.padEnd(40)} mock=${mockKeys.length} → real=${converted} (failed=${failedOdsay}, noCoord=${skippedNoCoord})`
  );

  if (!dryRun && converted > 0) {
    await db.collection('zone_courses').doc(id).update({
      transit_matrix: newTM,
      last_p260_update: new Date().toISOString(),
    });
    totalDocs++;
  }
}

console.log('\n=== Result ===');
console.log(`  zones processed:         ${targetDocs.length}`);
console.log(`  zones updated:           ${totalDocs}`);
console.log(`  total mock (before):     ${totalMockBefore}`);
console.log(`  total real (before):     ${totalRealBefore}`);
console.log(`  mock → real converted:   ${totalConverted}`);
console.log(`  ODsay failed:            ${totalFailedOdsay}`);
console.log(`  skipped (no coord):      ${totalSkippedNoCoord}`);
console.log(
  `  new prefill ratio:       ${totalRealBefore + totalConverted} real / ${totalRealBefore + totalMockBefore} total = ${Math.round(((totalRealBefore + totalConverted) / (totalRealBefore + totalMockBefore)) * 100)}%`
);

process.exit(0);
