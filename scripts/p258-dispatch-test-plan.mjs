/**
 * p258-dispatch-test-plan.mjs
 *
 * P256 머지 후 cache hit rate 측정 위한 prod test plan dispatch.
 * Flow:
 *   1. firebase-admin SDK init (env 3개 파일 로딩)
 *   2. getUserByEmail('2001leety@gmail.com') → uid
 *   3. createCustomToken(uid)
 *   4. signInWithCustomToken REST → idToken
 *   5. POST https://cocotripkr.com/api/ai-planner-full + ADMIN-BYPASS- paypalOrderId
 *   6. response 의 planId 출력
 *   7. 60s wait + status 폴링
 *   8. p256-inspect-cache.mjs 로직으로 cache hit 측정
 */
import { readFileSync } from 'fs';

// env 로딩 (3개 파일 union)
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

// firebase-admin init
const { initializeApp, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');

const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/^["']|["']$/g, '')
  .replace(/\\n/g, '\n')
  .trim();
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

if (!WEB_API_KEY) {
  console.error('VITE_FIREBASE_API_KEY missing');
  process.exit(1);
}

console.log('=== P258 — prod test plan dispatch for P256 cache hit measurement ===\n');

// 1. uid lookup
console.log('[1/7] Lookup admin user by email...');
const userRecord = await auth.getUserByEmail(ADMIN_EMAIL);
const uid = userRecord.uid;
console.log(`     uid=${uid.slice(0, 8)}...`);

// 2. createCustomToken
console.log('[2/7] Create Firebase custom token...');
const customToken = await auth.createCustomToken(uid);
console.log(`     customToken length=${customToken.length}`);

// 3. signInWithCustomToken REST exchange → idToken
console.log('[3/7] Exchange custom token → idToken (Identity Toolkit REST)...');
const signInRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  }
);
if (!signInRes.ok) {
  console.error(`     signIn failed: ${signInRes.status}`, await signInRes.text());
  process.exit(2);
}
const signInData = await signInRes.json();
const idToken = signInData.idToken;
console.log(`     idToken length=${idToken.length}, expiresIn=${signInData.expiresIn}s`);

// 4. POST ai-planner-full
console.log('[4/7] POST /api/ai-planner-full (Seoul 2-day, ADMIN-BYPASS)...');
const ts = Date.now();
const planBody = {
  paypalOrderId: `ADMIN-BYPASS-p258-cache-test-${ts}`,
  uid,
  email: ADMIN_EMAIL,
  area: 'seoul',
  duration: 'multi_day',
  durationDays: 2,
  pax: 2,
  arrival_airport: 'ICN',
  departure_airport: 'ICN',
  hotel_address: '',
  arrival_city: 'seoul',
  arrivalTime: '14:00',
  startDate: '2026-06-15',
  language: 'ko',
  styles: ['Foodie'],
  dietPrefs: [],
  regions: [],
  vehicle: 'public',
  specialRequest: 'P258 cache hit test',
  mobility: 'normal',
  guestName: 'P258Test',
};
const planRes = await fetch(`${PROD_URL}/api/ai-planner-full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  },
  body: JSON.stringify(planBody),
});
const planResText = await planRes.text();
console.log(`     status=${planRes.status}`);
let planData;
try {
  planData = JSON.parse(planResText);
} catch {
  console.error('     non-JSON response:', planResText.slice(0, 500));
  process.exit(3);
}
console.log(`     planId=${planData.planId || planData.plan_id || '?'}`);
console.log(`     keys: ${Object.keys(planData).join(', ')}`);

const planId = planData.planId || planData.plan_id;
if (!planId) {
  console.error('     no planId returned');
  console.error('     response:', JSON.stringify(planData, null, 2).slice(0, 1000));
  process.exit(4);
}

// 5. polling for status=ready (90s budget)
console.log('[5/7] Poll Firestore for plan status=ready (90s budget, 5s interval)...');
const start = Date.now();
let lastStatus = null;
let finalPlan = null;
for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const snap = await db.collection('plans').doc(planId).get();
  if (!snap.exists) {
    console.log(`     [${i + 1}] doc not found yet (${Math.round((Date.now() - start) / 1000)}s)`);
    continue;
  }
  const d = snap.data();
  if (d.status !== lastStatus) {
    console.log(`     [${i + 1}] status=${d.status}, plannerMode=${d.plannerMode || '?'}, blocksUsed=${JSON.stringify(d.blocksUsed || null)} (${Math.round((Date.now() - start) / 1000)}s)`);
    lastStatus = d.status;
  }
  if (d.status === 'ready') {
    finalPlan = d;
    break;
  }
  if (d.status === 'error' || d.status === 'failed') {
    console.error('     plan generation FAILED:', d.error || d.errorMessage || 'unknown');
    process.exit(5);
  }
}
if (!finalPlan) {
  console.error('     timed out waiting for status=ready');
  process.exit(6);
}

// 6. cache hit measurement (p256-inspect-cache.mjs logic)
console.log('\n[6/7] Cache hit measurement on this new plan...');
const iti = finalPlan.itinerary || {};
const days = iti.days || [];
let totalTransit = 0;
let totalCacheHits = 0;
let totalOdsay = 0;
let totalNaverFallback = 0;
for (const day of days) {
  const stops = day.stops || day.places || [];
  const sbid = day.source_block_id || '(none)';
  let cacheHits = 0;
  let odsayCalls = 0;
  let naverFallback = 0;
  let dayTransit = 0;
  for (const s of stops) {
    const t = s.transit_from_prev;
    if (!t) continue;
    dayTransit++;
    if (t._fromCache === true) cacheHits++;
    else if (t.source === 'odsay') odsayCalls++;
    else if (t.source === 'naver_fallback') naverFallback++;
  }
  totalTransit += dayTransit;
  totalCacheHits += cacheHits;
  totalOdsay += odsayCalls;
  totalNaverFallback += naverFallback;
  console.log(`     Day ${day.day}: source_block_id="${sbid}", transit=${dayTransit}, cacheHits=${cacheHits}, odsay=${odsayCalls}, naver=${naverFallback}`);
}

console.log('\n[7/7] Result Summary');
console.log('─────────────────────────────────────────────────');
console.log(`  planId:               ${planId}`);
console.log(`  total transit:        ${totalTransit}`);
console.log(`  cache HITS:           ${totalCacheHits} (${totalTransit ? Math.round((totalCacheHits / totalTransit) * 100) : 0}%)`);
console.log(`  ODsay calls:          ${totalOdsay} (${totalTransit ? Math.round((totalOdsay / totalTransit) * 100) : 0}%)`);
console.log(`  naver_fallback:       ${totalNaverFallback}`);
console.log(`  plannerMode:          ${finalPlan.plannerMode || '?'}`);
console.log(`  blocksUsed:           ${JSON.stringify(finalPlan.blocksUsed || null)}`);
console.log(`  abReason:             ${finalPlan.abReason || '?'}`);
console.log('─────────────────────────────────────────────────');

if (totalCacheHits > 0) {
  console.log('\n✅ P256 fix VALIDATED — cache hit > 0 in prod after merge!');
} else {
  console.log('\n⚠️  Cache hit still 0 — investigate (P256 fix may not be effective in prod, or block_mode path not used)');
}

process.exit(0);
