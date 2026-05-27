/**
 * P252 — P245/P246/P248/P251 4 검증 plan 생성 (운영자 명시 검증 진행).
 *
 * 1. P245: arrival=14:00 + tourStartTime=09:00 → Day1 stops[0] ≥ 15:00
 * 2. P246: styles=[Dmz], area=seoul → Day1 모두 서울/경기
 * 3. P248: styles=[Haenyeo], area=seoul → alert (Jeju-only)
 * 4. P251: 일반 plan → cache hit 측정용
 */
import { readFileSync } from 'fs';

function parseEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g, '')]; })
    );
  } catch { return {}; }
}
const env = { ...parseEnvFile('.env'), ...parseEnvFile('.env.local') };
const apiKey = env.VITE_FIREBASE_API_KEY;
const pw = env.HEALTH_CHECK_PASSWORD;
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'planning-with-ai-a0801';
const BASE_URL = 'https://cocotripkr.com';

const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '2001leety@gmail.com', password: pw, returnSecureToken: true }) }
);
const auth = await authRes.json();
if (!auth.idToken) { console.error('Auth fail'); process.exit(1); }
console.log(`Auth OK uid=${auth.localId}\n`);

async function createPlan(label, payload) {
  const orderId = `ADMIN-BYPASS-P252-${label.slice(0,8)}-${Date.now()}`;
  console.log(`\n=== ${label} ===\norderId: ${orderId}`);
  const start = Date.now();
  try {
    const r = await fetch(`${BASE_URL}/api/ai-planner-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` },
      body: JSON.stringify({ paypalOrderId: orderId, uid: auth.localId, ...payload }),
      signal: AbortSignal.timeout(600000),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const body = await r.json().catch(() => null);
    const planId = body?.data?.planId;
    console.log(`HTTP ${r.status} / ${elapsed}s / planId: ${planId}`);
    return { label, planId, status: r.status, sec: parseFloat(elapsed) };
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    return { label, planId: null, error: e.message };
  }
}

const baseInput = {
  guestName: 'P252verify', pax: 2, adults: 2, children: 0,
  startDate: '2026-06-25', language: 'ko', mobility: 'ok', priceRange: 'Moderate',
  arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', departureTime: '11:00',
  luggage: { small: 1, medium: 1, large: 0 },
};

const results = [];

// 1. P245 — arrival 14:00 + tourStartTime 09:00
// P254 fix: arrival_time(snake_case) → arrivalTime(camelCase) — backend body.arrivalTime 읽음
results.push(await createPlan('P245-arrival14', {
  ...baseInput,
  area: 'seoul', regions: ['seoul'], durationDays: 3,
  arrivalTime: '14:00', tourStartTime: '09:00',
  styles: ['Food', 'Photo'], dietPrefs: ['Meat'],
}));

// 2. P246 — DMZ + seoul
results.push(await createPlan('P246-DMZ-seoul', {
  ...baseInput,
  area: 'seoul', regions: ['seoul'], durationDays: 3,
  arrivalTime: '14:00', tourStartTime: '09:00',
  styles: ['Dmz', 'Food'], dietPrefs: ['Meat'],
}));

// 3. P248 — Haenyeo + seoul (Jeju-only style → alert 예상)
results.push(await createPlan('P248-Haenyeo-seoul', {
  ...baseInput,
  area: 'seoul', regions: ['seoul'], durationDays: 3,
  arrivalTime: '14:00', tourStartTime: '09:00',
  styles: ['Haenyeo', 'Food'], dietPrefs: ['Meat'],
}));

// 4. P251 — 일반 plan (cache hit 측정용)
results.push(await createPlan('P251-cache', {
  ...baseInput,
  area: 'seoul', regions: ['seoul'], durationDays: 2,
  arrivalTime: '14:00', tourStartTime: '09:00',
  styles: ['Food'], dietPrefs: ['Meat'],
}));

console.log('\n\n=== 종합 ===');
console.log('| label | planId | HTTP | sec |');
console.log('|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.label} | ${(r.planId || '').slice(0,8) || 'FAIL'} | ${r.status || '-'} | ${r.sec || '-'} |`);
}
console.log('\n다음: Firestore inspect (별도 script)');
console.log('Plan IDs:', JSON.stringify(results.map(r => r.planId).filter(Boolean)));
