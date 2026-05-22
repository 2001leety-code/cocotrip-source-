/**
 * 다구간 × 일수 × 터미널 종합 시뮬레이션 매트릭스 (2026-05-22)
 *
 * 체크 항목:
 *   B-19 : 터미널 일관성 (T1 선택 → 플랜 전체 T1, T2 교차 없음)
 *   B-20 : 공항→호텔 경로 설명 존재 (transport_to_hotel instruction 비어있지 않음)
 *   B-2  : 다구간 도시별 stop 분배 (각 도시 ≥1 stop)
 *   B-13 : lodging name/addr 이 그 day.city 와 매칭 (다른 도시 이름 언급 없음)
 *   B-DUR: 생성된 day 수 = 요청 일수
 *
 * Usage:
 *   node scripts/validate-simulation-matrix.mjs
 *   CONCURRENCY=3 node scripts/validate-simulation-matrix.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseEnv(p) {
  try {
    return Object.fromEntries(
      readFileSync(p, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
    );
  } catch { return {}; }
}
const envL = parseEnv(join(root, '.env.local'));
const envM = parseEnv(join(root, '.env'));
const E = k => process.env[k] || envL[k] || envM[k];

const BASE_URL   = E('BASE_URL') || 'https://cocotripkr.com';
const apiKey     = E('FIREBASE_WEB_API_KEY') || E('VITE_FIREBASE_API_KEY');
const email      = E('HEALTH_CHECK_EMAIL');
const password   = E('HEALTH_CHECK_PASSWORD');
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);

if (!apiKey || !email || !password) {
  console.error('❌ FIREBASE_WEB_API_KEY + HEALTH_CHECK_EMAIL + HEALTH_CHECK_PASSWORD 필요');
  process.exit(1);
}

// ─── 시나리오 매트릭스 ───────────────────────────────────────────────────────
const ZONE_MAP = {
  seoul: 'myeongdong', busan: 'haeundae', jeju: 'jungmun',
  gyeongju: 'bomun', jeonju: 'hanok-village', gangneung: 'gangneung-beach',
};
const AIRPORT_MAP = {
  seoul: 'ICN_T1', busan: 'PUS', jeju: 'CJU',
  gyeongju: 'ICN_T1', jeonju: 'ICN_T1', gangneung: 'ICN_T1',
};

const SCENARIOS = [
  // 3일
  { name: '3d · 서울+부산 · T1',  regions:['seoul','busan'],           days:3,  terminal:'ICN_T1' },
  { name: '3d · 서울+부산 · T2',  regions:['seoul','busan'],           days:3,  terminal:'ICN_T2' },
  // 5일
  { name: '5d · 서울+부산 · T1',  regions:['seoul','busan'],           days:5,  terminal:'ICN_T1' },
  { name: '5d · 서울+제주 · T1',  regions:['seoul','jeju'],            days:5,  terminal:'ICN_T1' },
  { name: '5d · 부산+경주 · T1',  regions:['busan','gyeongju'],        days:5,  terminal:'ICN_T1' },
  // 7일
  { name: '7d · 서울+부산+제주 · T1', regions:['seoul','busan','jeju'], days:7, terminal:'ICN_T1' },
  { name: '7d · 서울+경주+부산 · T1', regions:['seoul','gyeongju','busan'], days:7, terminal:'ICN_T1' },
  // 10일
  { name: '10d · 서울+부산+제주+경주 · T1', regions:['seoul','busan','jeju','gyeongju'], days:10, terminal:'ICN_T1' },
  { name: '10d · 서울+전주+부산+제주 · T1', regions:['seoul','jeonju','busan','jeju'],  days:10, terminal:'ICN_T1' },
];

// ─── 터미널 키워드 ────────────────────────────────────────────────────────────
const T_META = {
  ICN_T1: { code:'ICN T1', self:['T1','1터미널','제1여객터미널','Terminal 1'], other:['T2','2터미널','제2여객터미널','Terminal 2'] },
  ICN_T2: { code:'ICN T2', self:['T2','2터미널','제2여객터미널','Terminal 2'], other:['T1','1터미널','제1여객터미널','Terminal 1'] },
  PUS:    { code:'PUS',    self:['PUS','김해','Gimhae'],                       other:[] },
  CJU:    { code:'CJU',    self:['CJU','제주','Jeju'],                         other:[] },
};

const CITY_KOR = { seoul:'서울', busan:'부산', jeju:'제주', gyeongju:'경주', jeonju:'전주', gangneung:'강릉' };

// ─── Firebase Auth ─────────────────────────────────────────────────────────
console.log('━'.repeat(54));
console.log('🔬 다구간 종합 시뮬레이션 매트릭스');
console.log(`   시나리오 ${SCENARIOS.length}개 / 동시실행 ${CONCURRENCY}개 / Target: ${BASE_URL}`);
console.log('━'.repeat(54) + '\n');

const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, password, returnSecureToken: true }) }
);
const auth = await authRes.json();
if (!auth.idToken) { console.error('❌ Auth 실패'); process.exit(1); }
console.log(`✅ Auth OK (uid=${auth.localId})\n`);

// ─── 단일 시나리오 실행 ───────────────────────────────────────────────────────
async function runScenario(sc, idx) {
  const tmeta  = T_META[sc.terminal] || T_META['ICN_T1'];
  const zones  = Object.fromEntries(sc.regions.map(r => [r, ZONE_MAP[r] || '']));
  const arrivalAirport = sc.terminal;
  const t0 = Date.now();

  let planRes, plan, elapsed;
  try {
    planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${auth.idToken}` },
      body: JSON.stringify({
        paypalOrderId:     `ADMIN-BYPASS-MATRIX-${idx}-${Date.now()}`,
        uid:               auth.localId,
        guestName:         `MatrixTest-${idx}`,
        pax:               2,
        durationDays:      sc.days,
        startDate:         '2026-07-15',
        area:              sc.regions[0],
        regions:           sc.regions,
        recommendedZones:  zones,
        dietPrefs:         ['Meat'],
        priceRange:        'Moderate',
        language:          'ko',
        styles:            ['Food', 'Culture', 'Photo'],
        arrival_airport:   arrivalAirport,
        departure_airport: arrivalAirport,
        arrivalTerminal:   arrivalAirport.replace(/ICN_/, ''),
        arrivalTime:       '14:00',
        departureTime:     '11:00',
        luggage:           { small:1, medium:1, large:0 },
      }),
      signal: AbortSignal.timeout(300000),
    });
    elapsed = Date.now() - t0;
    plan = await planRes.json();
  } catch (e) {
    elapsed = Date.now() - t0;
    return { sc, elapsed, ok:false, error: e.message, assertions:[] };
  }

  if (planRes.status !== 200) {
    return { sc, elapsed, ok:false, error:`HTTP ${planRes.status}`, assertions:[] };
  }

  const data = plan.data || plan;
  const itin = data.itinerary || {};
  const days  = itin.days || [];
  const assertions = [];

  // B-DUR: day 수 일치
  assertions.push({
    id:'B-DUR', pass: days.length === sc.days,
    note: `${days.length}/${sc.days}일`,
  });

  // B-19: 터미널 일관성 (ICN만)
  if (sc.terminal.startsWith('ICN')) {
    const arrAp = (itin.arrival_guide || {}).airport || '';
    const depAp = (data.departure_guide || itin.departure_guide || {}).airport || '';
    const hasSelf  = s => tmeta.self.some(k => s.includes(k));
    const hasOther = s => tmeta.other.some(k => s.includes(k));
    assertions.push({
      id:'B-19a', pass: hasSelf(arrAp) && !hasOther(arrAp),
      note: `arrival_guide.airport="${arrAp}"`,
    });
    assertions.push({
      id:'B-19b', pass: hasSelf(depAp) && !hasOther(depAp),
      note: `departure_guide.airport="${depAp}"`,
    });
  }

  // B-20: 공항→호텔 경로 설명 (transport_to_hotel instruction 비어있지 않음)
  const arrSteps  = (itin.arrival_guide || {}).steps || [];
  const toHotel   = (arrSteps.find(s => s.transport_to_hotel) || {}).transport_to_hotel || {};
  const arexInstr = (toHotel.arex_express || {}).instruction || '';
  const busInstr  = (toHotel.limousine_bus || {}).instruction || '';
  const taxiInstr = (toHotel.taxi || {}).instruction || '';
  const hasAnyInstr = arexInstr || busInstr || taxiInstr;
  assertions.push({
    id:'B-20', pass: !!hasAnyInstr,
    note: hasAnyInstr
      ? `AREX="${arexInstr.slice(0,40)}"`
      : '⚠️ transport_to_hotel instruction 전부 빈 문자열',
  });

  // B-2: 다구간 도시별 stop 분배
  if (sc.regions.length >= 2) {
    const cityHits = Object.fromEntries(sc.regions.map(r => [r, 0]));
    for (const d of days) {
      const cityKey = (d.city || '').toLowerCase();
      if (cityHits[cityKey] !== undefined) cityHits[cityKey]++;
    }
    const missing = sc.regions.filter(r => cityHits[r] === 0);
    assertions.push({
      id:'B-2', pass: missing.length === 0,
      note: missing.length === 0
        ? sc.regions.map(r => `${r}:${cityHits[r]}d`).join(' ')
        : `도시 누락: ${missing.join(',')}`,
    });
  }

  // B-13: lodging name/addr 도시 교차 없음
  if (sc.regions.length >= 2) {
    let pass = 0, total = 0;
    const fails = [];
    for (const d of days) {
      const stops = d.stops || [];
      if (!stops[0] || stops[0].category !== 'lodging') continue;
      total++;
      const dayCity = (d.city || '').toLowerCase();
      const hay = `${stops[0].name||''} ${stops[0].address||''}`.toLowerCase();
      const other = sc.regions.filter(r => r !== dayCity);
      const crossCity = other.some(r => {
        const kor = CITY_KOR[r] || '';
        return hay.includes(r) || (kor && hay.includes(kor));
      });
      if (!crossCity) pass++;
      else fails.push(`D${d.day}(${d.city}):"${stops[0].name}"`);
    }
    assertions.push({
      id:'B-13', pass: total === 0 || pass === total,
      note: total === 0 ? 'lodging stop 없음' : fails.length ? fails.join(' ') : `${pass}/${total} OK`,
    });
  }

  return { sc, elapsed, ok:true, assertions };
}

// ─── 동시 실행 (concurrency pool) ────────────────────────────────────────────
async function runPool(scenarios, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < scenarios.length) {
      const i = idx++;
      const sc = scenarios[i];
      process.stdout.write(`▶ [${i+1}/${scenarios.length}] ${sc.name} 시작...\n`);
      const r = await runScenario(sc, i+1);
      const sec = (r.elapsed/1000).toFixed(1);
      if (!r.ok) {
        console.log(`  ❌ FAIL — ${r.error} (${sec}s)\n`);
      } else {
        const allPass = r.assertions.every(a => a.pass);
        console.log(`  ${allPass?'✅':'⚠️'} 완료 ${sec}s | ${r.assertions.map(a=>`${a.id}:${a.pass?'✓':'✗'}`).join(' ')}`);
        r.assertions.filter(a => !a.pass).forEach(a => console.log(`     ↳ ${a.id}: ${a.note}`));
        console.log('');
      }
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return results;
}

const results = await runPool(SCENARIOS, CONCURRENCY);

// ─── 종합 테이블 ──────────────────────────────────────────────────────────────
console.log('\n' + '━'.repeat(54));
console.log('📊 종합 결과\n');

const assertIds = ['B-DUR','B-19a','B-19b','B-20','B-2','B-13'];
const header = ['시나리오','시간(s)', ...assertIds].map((h,i) => i===0 ? h.padEnd(34) : h.padEnd(8)).join('');
console.log(header);
console.log('─'.repeat(header.length));

let totalFail = 0;
for (const r of results) {
  const sec = (r.elapsed/1000).toFixed(1);
  if (!r.ok) {
    console.log(`${r.sc.name.padEnd(34)}${sec.padEnd(8)}ERR: ${r.error}`);
    totalFail++;
    continue;
  }
  const cells = assertIds.map(id => {
    const a = r.assertions.find(x => x.id === id);
    if (!a) return '–'.padEnd(8);
    return (a.pass ? '✅' : '❌').padEnd(8);
  });
  const row = `${r.sc.name.padEnd(34)}${sec.padEnd(8)}${cells.join('')}`;
  console.log(row);
  if (r.assertions.some(a => !a.pass)) totalFail++;
}

console.log('─'.repeat(header.length));
const okRuns = results.filter(r => r.ok);
const times  = okRuns.map(r => r.elapsed/1000);
console.log(`\n⏱  평균 ${(times.reduce((a,b)=>a+b,0)/times.length||0).toFixed(1)}s  최소 ${Math.min(...times).toFixed(1)}s  최대 ${Math.max(...times).toFixed(1)}s`);
console.log(totalFail === 0 ? '\n✅ 전 시나리오 통과' : `\n❌ ${totalFail}개 시나리오 이슈 발견`);
process.exit(totalFail > 0 ? 1 : 0);
