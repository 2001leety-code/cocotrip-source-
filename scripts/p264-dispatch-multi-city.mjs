/**
 * p264-dispatch-multi-city.mjs — 다도시 plan dispatch (서울+부산 3박).
 *
 * P256 fix 의 dayPlan.source_block_id per-day fallback 검증 위함.
 * P258 단도시 dispatch 와 동일 admin SDK pattern.
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

const { initializeApp, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
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

const auth = getAuth();
const db = getFirestore();
const ADMIN_EMAIL = '2001leety@gmail.com';
const WEB_API_KEY = (process.env.VITE_FIREBASE_API_KEY || '').trim();
const PROD_URL = 'https://cocotripkr.com';

console.log('=== P264 — multi-city plan dispatch (서울+부산 3박) ===\n');

const userRecord = await auth.getUserByEmail(ADMIN_EMAIL);
const uid = userRecord.uid;
const customToken = await auth.createCustomToken(uid);
const signInRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  }
);
const idToken = (await signInRes.json()).idToken;
console.log('[1/4] idToken 발급 ✓');

const ts = Date.now();
const planBody = {
  paypalOrderId: `ADMIN-BYPASS-p264-multicity-${ts}`,
  uid,
  email: ADMIN_EMAIL,
  area: 'seoul', // 첫 도시
  regions: ['seoul', 'busan'], // 다도시 핵심 필드
  arrival_city: 'seoul',
  departure_city: 'busan',
  duration: 'multi_day',
  durationDays: 3,
  pax: 2,
  arrival_airport: 'ICN',
  departure_airport: 'PUS', // 김해국제공항
  hotel_address: '',
  arrivalTime: '14:00',
  startDate: '2026-06-15',
  language: 'ko',
  styles: ['Foodie'],
  dietPrefs: [],
  vehicle: 'public',
  specialRequest: 'P264 multi-city cache hit test',
  mobility: 'normal',
  guestName: 'P264Test',
};

console.log('[2/4] POST /api/ai-planner-full (regions=[seoul,busan], 3-day)...');
const planRes = await fetch(`${PROD_URL}/api/ai-planner-full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  },
  body: JSON.stringify(planBody),
});
const planData = await planRes.json();
const planId = planData.data?.planId || planData.planId;
console.log(`     planId=${planId}`);
console.log(`     status=${planData.data?.status || planData.status}`);
console.log(`     blocksUsed=${JSON.stringify(planData.data?._debug?.blocksUsed || null)}`);
console.log(`     plannerMode=${planData.data?._debug?.plannerMode || '?'}`);

// polling
console.log('\n[3/4] Polling Firestore for status=ready (180s budget)...');
const start = Date.now();
let finalPlan = null;
let lastStatus = null;
for (let i = 0; i < 36; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const snap = await db.collection('plans').doc(planId).get();
  if (!snap.exists) continue;
  const d = snap.data();
  if (d.status !== lastStatus) {
    console.log(`     [${i + 1}] status=${d.status}, days=${(d.itinerary?.days || []).length} (${Math.round((Date.now() - start) / 1000)}s)`);
    lastStatus = d.status;
  }
  if (d.status === 'ready') {
    finalPlan = d;
    break;
  }
  if (d.status === 'error' || d.status === 'failed') {
    console.error('plan FAILED:', d.error || d.errorMessage);
    process.exit(1);
  }
}
if (!finalPlan) {
  console.error('timed out');
  process.exit(2);
}

// measurement
console.log('\n[4/4] per-day cache hit analysis');
console.log('─────────────────────────────────────────');
const iti = finalPlan.itinerary || {};
const days = iti.days || [];
let tT = 0, tC = 0, tO = 0;
for (const day of days) {
  const stops = day.stops || day.places || [];
  const sbid = day.source_block_id || '(none)';
  const city = day.city || day.region || '?';
  let c = 0, o = 0, dt = 0;
  const sources = [];
  for (const s of stops) {
    const t = s.transit_from_prev;
    if (!t) continue;
    dt++;
    if (t._fromCache === true) {
      c++;
      sources.push(`HIT(${t._cacheSource || '?'})`);
    } else {
      o++;
      sources.push(t.source || '?');
    }
  }
  tT += dt;
  tC += c;
  tO += o;
  console.log(`  Day ${day.day} [${city}]: block="${sbid}"`);
  console.log(`    transit=${dt}, HIT=${c}, miss=${o}`);
  console.log(`    sources: [${sources.join(', ')}]`);
}
console.log('─────────────────────────────────────────');
console.log(`  planId:        ${planId}`);
console.log(`  status:        ${finalPlan.status}`);
console.log(`  plannerMode:   ${finalPlan.plannerMode || '?'}`);
console.log(`  blocksUsed:    ${JSON.stringify(finalPlan.blocksUsed || null)}`);
console.log(`  regions:       ${JSON.stringify(finalPlan.input?.regions || null)}`);
console.log(`  total transit: ${tT}`);
console.log(`  cache HITS:    ${tC} (${tT ? Math.round(tC / tT * 100) : 0}%)`);
console.log(`  ODsay calls:   ${tO}`);
console.log('─────────────────────────────────────────');

if (tC > 0) {
  console.log('\n✅ P256 multi-city per-day fallback VALIDATED');
} else {
  console.log('\n⚠️  multi-city plan cache hit 0 — dayPlan.source_block_id fallback 점검 필요');
}

process.exit(0);
