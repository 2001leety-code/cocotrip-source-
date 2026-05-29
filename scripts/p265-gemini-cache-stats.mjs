/**
 * p265-gemini-cache-stats.mjs — 5/25 P195 instrumentation 머지 후 누적 plans 의
 * Gemini implicit cache hit rate 분포 측정. Phase 1 의사결정 baseline.
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1]; let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1).replace(/\\n/g,'\n');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
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
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey }) });
const db = getFirestore();

const P195_MERGE_MS = new Date('2026-05-25T00:00:00Z').getTime();
const snap = await db.collection('plans').where('createdAtMs','>=',P195_MERGE_MS).orderBy('createdAtMs','desc').limit(100).get();

console.log('=== P265: Gemini implicit cache hit rate (5/25 P195 머지 이후) ===');
console.log('total plans queried:', snap.size);

const buckets = { '0%': 0, '<10%': 0, '10-30%': 0, '30-50%': 0, '50-70%': 0, '70-90%': 0, '>=90%': 0 };
const allRates = [];
let withMetrics = 0;
let withoutMetrics = 0;
let cachedTotal = 0;
let totalTotal = 0;

snap.forEach((doc) => {
  const d = doc.data();
  const debug = d._debug || d.debug || {};
  const cachedIn = debug.cachedInputTokens;
  const totalIn = debug.totalInputTokens;
  let rate = null;
  if (typeof debug.cacheHitRate === 'number') rate = debug.cacheHitRate;
  else if (typeof cachedIn === 'number' && typeof totalIn === 'number' && totalIn > 0) {
    rate = cachedIn / totalIn;
  }
  if (rate !== null) {
    withMetrics++;
    allRates.push(rate);
    if (typeof cachedIn === 'number' && typeof totalIn === 'number') {
      cachedTotal += cachedIn;
      totalTotal += totalIn;
    }
    const pct = rate * 100;
    if (pct === 0) buckets['0%']++;
    else if (pct < 10) buckets['<10%']++;
    else if (pct < 30) buckets['10-30%']++;
    else if (pct < 50) buckets['30-50%']++;
    else if (pct < 70) buckets['50-70%']++;
    else if (pct < 90) buckets['70-90%']++;
    else buckets['>=90%']++;
  } else {
    withoutMetrics++;
  }
});

console.log('plans with cache metrics:', withMetrics);
console.log('plans without cache metrics:', withoutMetrics);

if (allRates.length > 0) {
  const mean = allRates.reduce((a,b)=>a+b,0)/allRates.length;
  const sorted = [...allRates].sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  console.log('mean hit rate:   ', (mean*100).toFixed(1)+'%');
  console.log('median hit rate: ', (median*100).toFixed(1)+'%');
  if (totalTotal > 0) {
    console.log('weighted avg:    ', ((cachedTotal/totalTotal)*100).toFixed(1)+'% (sum cached / sum total)');
    console.log('total cached tokens:', cachedTotal);
    console.log('total input tokens: ', totalTotal);
  }
  console.log('distribution:');
  for (const [k,v] of Object.entries(buckets)) {
    const pct = (v/allRates.length*100).toFixed(0);
    const bar = '█'.repeat(Math.round(v/allRates.length*30));
    console.log('  '+k.padEnd(8)+': '+String(v).padStart(3)+' plans ('+pct.padStart(3)+'%) '+bar);
  }
  console.log();
  console.log('=== P195 Phase 1 의사결정 ===');
  const meanPct = mean * 100;
  if (meanPct >= 70) console.log('✅ 평균 ≥70% — P195 explicit caching 보류 (implicit 충분)');
  else if (meanPct >= 30) console.log('🟡 평균 30~70% — 1주 더 자연 누적 모니터링 후 재결정');
  else console.log('🔴 평균 <30% — P195 explicit caching 진행 권고 (Gemini explicit cached_content API)');
}

process.exit(0);
