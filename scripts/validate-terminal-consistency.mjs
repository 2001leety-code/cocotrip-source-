/**
 * T1/T2 터미널 일관성 자동 검증 (B-19, 2026-05-22)
 *
 * 사용자가 T1 선택 → 플랜 전체가 T1 기준 경로 설명 여부 검증.
 * 사용자가 T2 선택 → 플랜 전체가 T2 기준 경로 설명 여부 검증.
 *
 * Usage:
 *   TERMINAL=ICN_T1 node scripts/validate-terminal-consistency.mjs
 *   TERMINAL=ICN_T2 node scripts/validate-terminal-consistency.mjs
 *
 * Env:
 *   TERMINAL              — ICN_T1 | ICN_T2 (기본 ICN_T1)
 *   RUNS                  — 반복 횟수 (기본 3)
 *   BASE_URL              — 기본 https://cocotripkr.com
 *   FIREBASE_WEB_API_KEY
 *   HEALTH_CHECK_EMAIL
 *   HEALTH_CHECK_PASSWORD
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
    );
  } catch { return {}; }
}
const envLocal = parseEnv(join(root, '.env.local'));
const envMain  = parseEnv(join(root, '.env'));
const E = k => process.env[k] || envLocal[k] || envMain[k];

const TERMINAL  = process.env.TERMINAL || 'ICN_T1';   // ICN_T1 | ICN_T2
const RUNS      = parseInt(process.env.RUNS || '3', 10);
const BASE_URL  = E('BASE_URL') || 'https://cocotripkr.com';
const apiKey    = E('FIREBASE_WEB_API_KEY') || E('VITE_FIREBASE_API_KEY');
const email     = E('HEALTH_CHECK_EMAIL');
const password  = E('HEALTH_CHECK_PASSWORD');

// ─── 터미널별 기준 키워드 ───────────────────────────────────────────────────
const TERMINAL_META = {
  ICN_T1: {
    code: 'ICN T1',
    self:  ['T1', '1터미널', '제1여객터미널', 'Terminal 1', 'terminal 1'],
    other: ['T2', '2터미널', '제2여객터미널', 'Terminal 2', 'terminal 2'],
  },
  ICN_T2: {
    code: 'ICN T2',
    self:  ['T2', '2터미널', '제2여객터미널', 'Terminal 2', 'terminal 2'],
    other: ['T1', '1터미널', '제1여객터미널', 'Terminal 1', 'terminal 1'],
  },
};

const meta = TERMINAL_META[TERMINAL];
if (!meta) { console.error(`❌ 알 수 없는 TERMINAL: ${TERMINAL}`); process.exit(1); }

if (!apiKey || !email || !password) {
  console.error('❌ FIREBASE_WEB_API_KEY + HEALTH_CHECK_EMAIL + HEALTH_CHECK_PASSWORD 필요');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🔍 터미널 일관성 검증 (B-19) — TERMINAL=${TERMINAL} × ${RUNS}회`);
console.log(`   Target: ${BASE_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Firebase Auth ─────────────────────────────────────────────────────────
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, password, returnSecureToken: true }) }
);
const auth = await authRes.json();
if (!auth.idToken) { console.error('❌ Auth 실패:', JSON.stringify(auth).slice(0,300)); process.exit(1); }
console.log(`✅ Auth OK (uid=${auth.localId})\n`);

// ─── helpers ───────────────────────────────────────────────────────────────
function containsSelf(text)  { return meta.self.some(k => text.includes(k)); }
function containsOther(text) { return meta.other.some(k => text.includes(k)); }

function assertTerminal(plan) {
  const data  = plan.data || plan;
  const itin  = data.itinerary || {};
  const days  = itin.days || [];

  const results = [];

  // B-19a: arrival_guide.airport
  const arrivalAirport = (itin.arrival_guide || {}).airport || '';
  const arrivalHasSelf  = containsSelf(arrivalAirport);
  const arrivalHasOther = containsOther(arrivalAirport);
  results.push({
    id: 'B-19a', label: `arrival_guide.airport = "${arrivalAirport}"`,
    pass: arrivalHasSelf && !arrivalHasOther,
    note: arrivalAirport || '(empty)',
  });

  // B-19b: departure_guide.airport
  const depGuide   = data.departure_guide || itin.departure_guide || {};
  const depAirport = depGuide.airport || '';
  const depHasSelf  = containsSelf(depAirport);
  const depHasOther = containsOther(depAirport);
  results.push({
    id: 'B-19b', label: `departure_guide.airport = "${depAirport}"`,
    pass: depHasSelf && !depHasOther,
    note: depAirport || '(empty)',
  });

  // B-19c: 마지막 day 공항 stop name/address 에서 반대 터미널 언급 없음
  const lastDay  = days[days.length - 1] || {};
  const lastStops = lastDay.stops || [];
  const airportStop = [...lastStops].reverse().find(s =>
    ['airport','travel'].includes(s.category) ||
    ['공항','airport','ICN','GMP'].some(t => (s.name||'').includes(t))
  );
  if (airportStop) {
    const stopText = `${airportStop.name||''} ${airportStop.address||''}`;
    const stopHasOther = containsOther(stopText);
    results.push({
      id: 'B-19c', label: `마지막 day 공항 stop name/addr`,
      pass: !stopHasOther,
      note: `"${airportStop.name}" / "${airportStop.address}"`,
    });
  } else {
    results.push({ id:'B-19c', label:'마지막 day 공항 stop', pass:true, note:'공항 stop 없음 (B-15가 잡음)' });
  }

  // B-19d: departure_guide.to_airport.instruction 에서 반대 터미널 언급 없음
  const toAirportInstr = ((depGuide.to_airport || {}).instruction || '');
  const instrHasOther  = containsOther(toAirportInstr);
  results.push({
    id: 'B-19d', label: 'departure_guide.to_airport.instruction 터미널 교차 없음',
    pass: !instrHasOther,
    note: toAirportInstr.slice(0, 80) || '(empty)',
  });

  return results;
}

// ─── 반복 실행 ─────────────────────────────────────────────────────────────
const runResults = [];

for (let run = 1; run <= RUNS; run++) {
  console.log(`──── Run ${run}/${RUNS} ────`);
  const t0 = Date.now();

  const planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${auth.idToken}` },
    body: JSON.stringify({
      paypalOrderId:    `ADMIN-BYPASS-TERMINAL-${TERMINAL}-${Date.now()}`,
      uid:              auth.localId,
      guestName:        'TerminalTest',
      pax:              2,
      durationDays:     3,
      startDate:        '2026-07-01',
      area:             'seoul',
      regions:          ['seoul'],
      recommendedZones: { seoul: 'myeongdong' },
      dietPrefs:        ['Meat'],
      priceRange:       'Moderate',
      language:         'ko',
      styles:           ['Food', 'Culture'],
      arrival_airport:  TERMINAL,
      departure_airport: TERMINAL,
      arrivalTerminal:  TERMINAL.replace('ICN_', ''),  // 'T1' | 'T2'
      arrivalTime:      '14:00',
      departureTime:    '11:00',
      luggage:          { small: 1, medium: 1, large: 0 },
    }),
    signal: AbortSignal.timeout(300000),
  });

  const elapsed = Date.now() - t0;
  const elapsedSec = (elapsed / 1000).toFixed(1);
  console.log(`   HTTP ${planRes.status}  ⏱ ${elapsedSec}s`);

  if (planRes.status !== 200) {
    const err = await planRes.text().catch(() => '?');
    console.log(`   ❌ Plan 생성 실패: ${err.slice(0,200)}`);
    runResults.push({ run, elapsed, ok: false, assertions: [] });
    continue;
  }

  const plan = await planRes.json();
  const assertions = assertTerminal(plan);

  for (const r of assertions) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`   ${icon} ${r.id}: ${r.label}`);
    if (!r.pass) console.log(`      → ${r.note}`);
  }
  console.log('');

  runResults.push({ run, elapsed, ok: true, assertions });
}

// ─── 요약 ──────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 결과 요약 — TERMINAL=${TERMINAL}\n`);

const okRuns    = runResults.filter(r => r.ok);
const timings   = okRuns.map(r => r.elapsed);
const avgSec    = timings.length ? (timings.reduce((a,b)=>a+b,0)/timings.length/1000).toFixed(1) : '-';
const minSec    = timings.length ? (Math.min(...timings)/1000).toFixed(1) : '-';
const maxSec    = timings.length ? (Math.max(...timings)/1000).toFixed(1) : '-';

console.log(`⏱  플랜 생성 시간 (${okRuns.length}/${RUNS} 성공)`);
console.log(`   avg=${avgSec}s  min=${minSec}s  max=${maxSec}s\n`);

// 항목별 pass rate
const assertIds = ['B-19a','B-19b','B-19c','B-19d'];
let anyFail = false;
for (const id of assertIds) {
  const relevant = okRuns.flatMap(r => r.assertions.filter(a => a.id === id));
  if (relevant.length === 0) continue;
  const passed = relevant.filter(a => a.pass).length;
  const icon   = passed === relevant.length ? '✅' : '❌';
  console.log(`${icon} ${id}: ${passed}/${relevant.length} pass`);
  if (passed < relevant.length) {
    anyFail = true;
    relevant.filter(a => !a.pass).forEach(a => console.log(`   → ${a.note}`));
  }
}

console.log('');
if (anyFail) {
  console.log('❌ 터미널 일관성 검증 실패');
  process.exit(1);
} else {
  console.log('✅ 터미널 일관성 검증 통과');
  process.exit(0);
}
