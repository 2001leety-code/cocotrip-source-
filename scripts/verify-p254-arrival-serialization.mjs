/**
 * P254 검증 — arrival_time serialization fix
 *
 * 시나리오: arrival=14:00 + tourStartTime=09:00
 * 기대 결과 (P245 룰): max(09:00, 14:00+60min) = max(09:00, 15:00) = 15:00
 *   → Day1[0].start_time >= 15:00 (이전: 09:00 = P245 룰 미작동)
 *
 * P254 root cause: verify script 이 arrival_time(snake_case) 로 전달 →
 *   requestShaper 가 body.arrivalTime(camelCase) 만 읽어 arrivalTime='' →
 *   blockMode arrivalTime 빈 문자열 → P245 max() 룰 스킵 → dayStart=09:00 고정
 *
 * Fix: requestShaper 에 snake_case fallback 추가 + verify script camelCase 수정
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
const BASE_URL = env.P254_BASE_URL || 'https://cocotripkr.com';

const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '2001leety@gmail.com', password: pw, returnSecureToken: true }) }
);
const auth = await authRes.json();
if (!auth.idToken) { console.error('Auth fail:', auth); process.exit(1); }
console.log(`Auth OK uid=${auth.localId}`);
console.log(`Target: ${BASE_URL}\n`);

async function createPlan(label, payload) {
  const orderId = `ADMIN-BYPASS-P254-${label.slice(0,8)}-${Date.now()}`;
  console.log(`=== ${label} ===\norderId: ${orderId}`);
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

function valOf(f) {
  if (!f) return null;
  if ('nullValue' in f) return null;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.arrayValue) return (f.arrayValue.values || []).map(v => valOf(v));
  if (f.mapValue) {
    const out = {};
    for (const [k, v] of Object.entries(f.mapValue.fields || {})) out[k] = valOf(v);
    return out;
  }
  return f;
}

// P254 시나리오 1: camelCase (올바른 방식)
const r1 = await createPlan('P254-camelCase-arrival14', {
  guestName: 'P254verify', pax: 2, adults: 2, children: 0,
  startDate: '2026-06-25', language: 'ko', mobility: 'ok', priceRange: 'Moderate',
  arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1',
  departureTime: '20:00',
  luggage: { small: 1, medium: 1, large: 0 },
  area: 'seoul', regions: ['seoul'], durationDays: 2,
  arrivalTime: '14:00',   // camelCase — P254 fix 후 정상 동작
  tourStartTime: '09:00',
  styles: ['Food'], dietPrefs: ['Meat'],
});

// P254 시나리오 2: snake_case (requestShaper P254 fallback 검증)
const r2 = await createPlan('P254-snakeCase-arrival14', {
  guestName: 'P254verify', pax: 2, adults: 2, children: 0,
  startDate: '2026-06-25', language: 'ko', mobility: 'ok', priceRange: 'Moderate',
  arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1',
  departureTime: '20:00',
  luggage: { small: 1, medium: 1, large: 0 },
  area: 'seoul', regions: ['seoul'], durationDays: 2,
  arrival_time: '14:00',  // snake_case — P254 fallback 로 처리
  tourStartTime: '09:00',
  styles: ['Food'], dietPrefs: ['Meat'],
});

console.log('\n=== Firestore inspect ===');
const token = auth.idToken;

async function inspectPlan(r) {
  if (!r.planId) { console.log(`${r.label}: planId 없음 (FAIL)`); return; }
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/planning-with-ai-a0801/databases/(default)/documents/plans/${r.planId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) { console.log(`${r.label}: HTTP ${res.status}`); return; }
  const d = await res.json();
  const f = d.fields || {};
  const input = valOf(f.input) || {};
  const itin = valOf(f.itinerary) || {};
  const days = itin.days || [];
  const day1Stops = days[0]?.stops || [];
  const day1First = day1Stops[0];

  console.log(`\n[${r.label}] planId=${r.planId.slice(0,8)}`);
  console.log(`  Firestore input.arrival_time = ${JSON.stringify(input.arrival_time)}`);
  console.log(`  Firestore input.tour_start_time = ${JSON.stringify(input.tour_start_time)}`);
  console.log(`  Day1[0].start_time = ${day1First?.start_time || '-'}`);
  console.log(`  Day1[0].name = ${(day1First?.display_name || day1First?.name || '-').slice(0,30)}`);

  // P245 룰 검증: arrival=14:00 + tourStart=09:00 → max(09:00, 15:00) = 15:00
  // Day1[0] start_time >= 15:00 이어야 함
  const firstTime = day1First?.start_time;
  if (firstTime) {
    const [h, m] = firstTime.split(':').map(Number);
    const minutesSinceMidnight = h * 60 + m;
    const pass = minutesSinceMidnight >= 15 * 60; // >= 15:00
    const status = pass ? 'PASS (>= 15:00)' : `FAIL (${firstTime} < 15:00, P245 룰 미작동)`;
    console.log(`  P245 룰 검증: ${status}`);
  }

  // arrival_time stored check
  if (input.arrival_time === '14:00') {
    console.log(`  arrival_time 저장: PASS (14:00 정상 저장)`);
  } else if (input.arrival_time === null) {
    console.log(`  arrival_time 저장: FAIL (null — serialization bug)`);
  } else {
    console.log(`  arrival_time 저장: UNEXPECTED (${input.arrival_time})`);
  }
}

await inspectPlan(r1);
await inspectPlan(r2);

console.log('\n=== 종합 ===');
console.log('| label | planId | HTTP | sec |');
console.log('|---|---|---|---|');
for (const r of [r1, r2]) {
  console.log(`| ${r.label} | ${(r.planId || '').slice(0,8) || 'FAIL'} | ${r.status || '-'} | ${r.sec || '-'} |`);
}
