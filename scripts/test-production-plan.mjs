// Exercise the full production /api/ai-planner-full pipeline via the ADMIN-BYPASS-
// order id, then query Firestore to confirm the newly-created plan
// has ODsay enrichment (steps_detail, exits, station info).
//
// 2026-07-20 수리. 그 전까지 두 가지 이유로 동작하지 않았다:
//   1. Authorization 헤더 없음 → PR #247 (audit P0-#2) 이후 401 AUTH_REQUIRED 로 즉사.
//   2. startDate 가 '2026-05-15' 하드코딩 → 서버 날짜검증 PLANNER_DATE_TOO_SOON 으로 400.
// 구 TEST- bypass 경로도 2026-07-20 폐지돼 ADMIN-BYPASS- 로 이주했다.
import {
  loadDotEnv,
  getIdToken,
  futureDate,
  adminBypassOrderId,
  postPlanner,
} from './_lib/planner-smoke.mjs';

loadDotEnv();

const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';
const START_DATE = futureDate(14);

const body = {
  paypalOrderId: adminBypassOrderId('SMOKE'),
  guestName: 'SmokeTest',
  email: process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com',
  startDate: START_DATE,
  endDate: futureDate(15),
  destination: 'Seoul',
  area: 'seoul_city',
  preferences: 'culture, kpop, shopping',
  styles: ['culture', 'kpop', 'shopping'],
  durationDays: 2,
  pax: 2,
  language: 'en',
  arrival_airport: 'ICN',
  departure_airport: 'ICN',
  hotel_address: 'Myeongdong',
  mobility: 'ok',
  dietPrefs: [],
  allergies: [],
  priceRange: 'Any',
  // Force wide-area tour so Gemini picks subway
  special_request: 'Use Seoul subway for all transit. Visit Gangnam, Hongdae, and Dongdaemun on different days.',
};

console.log(`→ POST ${BASE_URL}/api/ai-planner-full`);
console.log('  admin bypass order:', body.paypalOrderId, '| startDate:', START_DATE);
const start = Date.now();

const idToken = await getIdToken();

let json;
try {
  json = await postPlanner(BASE_URL, body, idToken);
} catch (err) {
  console.log(`  ❌ ${err.message}`);
  if (err.body) console.log('  body:', JSON.stringify(err.body, null, 2).slice(0, 500));
  process.exit(1);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`  HTTP 200 in ${elapsed}s`);

const planId = json?.data?.planId;
console.log(`  ✅ Plan created: ${planId}`);
console.log(`  URL: https://cocotripkr.com${json?.data?.planUrl || `/my-plans/${planId}`}`);

// Query Firestore to inspect the transit structure
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let privateKey = rawKey;
if (pemMatch) {
  const base64Clean = pemMatch[1].replace(/\s+/g, '');
  const lines = base64Clean.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
}
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey }) });
const db = getFirestore();
const snap = await db.collection('plans').doc(planId).get();
const plan = snap.data();

const sourceCounts = {};
const methodCounts = {};
let stepsDetailPresent = 0, stationInfoPresent = 0, exitsPresent = 0;
const sampleSubway = [];

for (const day of (plan?.itinerary?.days || [])) {
  for (const stop of (day.stops || [])) {
    const t = stop.transit_from_prev;
    if (!t) continue;
    sourceCounts[t.source || 'none'] = (sourceCounts[t.source || 'none'] || 0) + 1;
    methodCounts[t.method || 'none'] = (methodCounts[t.method || 'none'] || 0) + 1;
    if (t.steps_detail?.length) stepsDetailPresent++;
    for (const s of (t.steps_detail || [])) {
      if (s.mode === 'subway') {
        if (s.fromExit || s.toExit) exitsPresent++;
        if (s.fromStationInfo || s.toStationInfo) stationInfoPresent++;
        if (sampleSubway.length < 1) sampleSubway.push(s);
      }
    }
  }
}

console.log('\n=== Verification ===');
console.log('SOURCE counts:', sourceCounts);
console.log('METHOD counts:', methodCounts);
console.log('steps_detail populated on segments:', stepsDetailPresent);
console.log('subway steps with exit numbers:', exitsPresent);
console.log('subway steps with stationInfo enrichment:', stationInfoPresent);
if (sampleSubway[0]) {
  const s = sampleSubway[0];
  console.log('\nSample subway step:');
  console.log('  line:', s.line, '→', s.lineKo, '/', s.lineEn);
  console.log('  from:', s.from, `(${s.fromRoman || '—'})`, 'Exit', s.fromExit);
  console.log('  to:', s.to, `(${s.toRoman || '—'})`, 'Exit', s.toExit);
  console.log('  way:', s.way, `(${s.wayRoman || '—'})`, '| interval:', s.intervalMin, 'min');
  if (s.fromStationInfo?.transferLines?.length) console.log('  transfers from:', s.fromStationInfo.transferLines.map(l => l.lineEn).join(', '));
  if (s.toStationInfo?.hasWheelchairLift) console.log('  to station: wheelchair lift available');
  if (s.toStationInfo?.lostCenterPhone) console.log('  to station lost&found:', s.toStationInfo.lostCenterPhone);
  if (s.fromTimetable) {
    const tt = s.fromTimetable;
    console.log('  fromTimetable up:', tt.up ? `first ${tt.up.first} / last ${tt.up.last} (to ${tt.up.lastDest})` : 'none');
    console.log('  fromTimetable down:', tt.down ? `first ${tt.down.first} / last ${tt.down.last} (to ${tt.down.lastDest})` : 'none');
  }
}
process.exit(0);
