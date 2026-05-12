// CocoTrip prod 회귀 검증 슈트 — 받아적기 15 항목 자동화 (L2)
// validate-prod-baseline.mjs 의 확장. PR 머지 전 'ready-for-regression' 라벨로 trigger.
//
// Auth: Firebase REST signInWithPassword (admin 계정)
// Plan: POST /api/ai-planner-full with ADMIN-BYPASS- prefix paypalOrderId (실 결제 X)
// Verify: 받아적기 B-2/B-3/B-6a/B-7/B-8/B-9/B-10~15 + B-16/B-17/B-18 15 항목 assertion
//   - B-16: PDF 사전조건 (title/departure/arrival/planId)
//   - B-17: 가격 합리성 (daily_budget 합산 vs total_cost ≤ 20% diff)
//   - B-18: 다양성 지표 (unique stop name ≥ 70%, local_tag ≥ 30%)
//
// Exit code:
//   0 — 모두 PASS
//   1 — 1건 이상 FAIL
//
// 환경변수 (GitHub Secrets 또는 .env.local):
//   FIREBASE_WEB_API_KEY      — Firebase Web API key (VITE_FIREBASE_API_KEY 와 동일)
//   HEALTH_CHECK_EMAIL        — admin 계정 이메일 (TEST- prefix 바이패스 권한)
//   HEALTH_CHECK_PASSWORD     — admin 계정 비밀번호
//   BASE_URL (선택)           — 기본 https://cocotripkr.com

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// .env / .env.local fallback (로컬 실행 편의)
function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    );
  } catch { return {}; }
}

const envMain = parseEnv(join(root, '.env'));
const envLocal = parseEnv(join(root, '.env.local'));

// process.env 우선 (CI), 없으면 .env.local 사용 (로컬)
const apiKey =
  process.env.FIREBASE_WEB_API_KEY ||
  envMain.VITE_FIREBASE_API_KEY ||
  envLocal.VITE_FIREBASE_API_KEY;
const email = process.env.HEALTH_CHECK_EMAIL || envLocal.HEALTH_CHECK_EMAIL;
const password = process.env.HEALTH_CHECK_PASSWORD || envLocal.HEALTH_CHECK_PASSWORD;
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';

if (!apiKey || !email || !password) {
  console.error('❌ Missing credentials. Set FIREBASE_WEB_API_KEY, HEALTH_CHECK_EMAIL, HEALTH_CHECK_PASSWORD');
  console.error('   (CI: GitHub Secrets / Local: .env.local)');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔍 CocoTrip 회귀 검증 슈트 (받아적기 15항목 / L2)');
console.log(`   Target: ${BASE_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Step 1: Firebase Auth ────────────────────────────────
console.log('[1/3] Firebase Auth signInWithPassword...');
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }
);
const auth = await authRes.json();
if (!auth.idToken) {
  console.error('❌ Auth failed:', JSON.stringify(auth).slice(0, 400));
  process.exit(1);
}
console.log(`✅ idToken 발급 (uid=${auth.localId})\n`);

// ─── Step 2: 5일 다도시 plan 생성 ───────────────────────────
console.log('[2/3] POST /api/ai-planner-full — 서울+부산 5일 plan 생성...');
const planStart = Date.now();
const planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.idToken}`,
  },
  body: JSON.stringify({
    paypalOrderId: 'ADMIN-BYPASS-REGRESSION-' + Date.now(),
    guestName: 'RegressionSuite',
    pax: 2,
    durationDays: 5,
    startDate: '2026-06-15',
    area: 'seoul',
    regions: ['seoul', 'busan'],
    recommendedZones: { seoul: 'myeongdong', busan: 'haeundae' },
    dietPrefs: ['Meat'],
    priceRange: 'Moderate',
    language: 'ko',
    styles: ['Food', 'Photo'],
    arrivalAirport: 'ICN',
    arrivalTerminal: 'T1',
    arrivalTime: '14:00',
    departureTime: '10:00',
    luggage: { small: 1, medium: 2, large: 0 },
  }),
  signal: AbortSignal.timeout(300000),
});
const planMs = Date.now() - planStart;
console.log(`   status: ${planRes.status} (${(planMs / 1000).toFixed(1)}s)`);

const planBody = await planRes.json();
if (planRes.status !== 200) {
  console.error('❌ Plan creation failed:', JSON.stringify(planBody, null, 2).slice(0, 1500));
  process.exit(1);
}
console.log('✅ Plan 생성 성공\n');

// ─── Step 3: 받아적기 15항목 검증 ──────────────────────────
console.log('[3/3] 받아적기 15항목 assertion 실행\n');

const data = planBody.data || {};
const itin = data.itinerary || {};
const days = itin.days || [];
const recObj = itin.recommended_restaurants || {};
const allRecs = Object.values(recObj).flat();
const fullText = JSON.stringify(planBody);

const results = [];

// ─── B-2: 다도시 stops 분배 ──────────────────────────────
const cityCounts = { seoul: 0, busan: 0, jeju: 0, other: 0 };
for (const d of days) {
  for (const s of d.stops || []) {
    const addr = s.address || '';
    if (addr.includes('서울')) cityCounts.seoul++;
    else if (addr.includes('부산')) cityCounts.busan++;
    else if (addr.includes('제주')) cityCounts.jeju++;
    else cityCounts.other++;
  }
}
results.push({
  id: 'B-2',
  label: '다도시 stops 분배 (서울 + 부산 모두 > 0)',
  actual: `서울=${cityCounts.seoul}, 부산=${cityCounts.busan}, 기타=${cityCounts.other}`,
  pass: cityCounts.seoul > 0 && cityCounts.busan > 0,
});

// ─── B-3: 추천 식당 region 균등 ───────────────────────────
const recByRegion = { seoul: 0, busan: 0, other: 0 };
for (const r of allRecs) {
  if (r.region === 'seoul') recByRegion.seoul++;
  else if (r.region === 'busan') recByRegion.busan++;
  else recByRegion.other++;
}
// 균등 — 서울+부산 각자 1+, |seoul-busan| <= max(seoul,busan) (즉 한쪽 0 금지)
const balanceOk =
  recByRegion.seoul >= 1 &&
  recByRegion.busan >= 1 &&
  Math.abs(recByRegion.seoul - recByRegion.busan) <= Math.max(recByRegion.seoul, recByRegion.busan);
results.push({
  id: 'B-3',
  label: '추천 식당 region 균등 (seoul 1+ AND busan 1+)',
  actual: `총 ${allRecs.length}개 (seoul=${recByRegion.seoul}, busan=${recByRegion.busan}, other=${recByRegion.other})`,
  pass: balanceOk,
});

// ─── B-6a: Day 5 출력 (days.length === 5) ───────────────────
results.push({
  id: 'B-6a',
  label: 'Day 5 출력 (days.length === 5)',
  actual: `days.length=${days.length}`,
  pass: days.length === 5,
});

// ─── B-7: transit_from_prev 채움률 >= 80% ─────────────────
// 첫 stop 제외, 모든 stop 의 transit_from_prev 또는 transit 필드 존재 비율
let transitFound = 0;
let totalStopsForTransit = 0;
for (const day of days) {
  const stops = day.stops || [];
  for (let i = 1; i < stops.length; i++) {
    totalStopsForTransit++;
    const t = stops[i].transit_from_prev || stops[i].transit;
    if (t && (typeof t === 'object' ? Object.keys(t).length > 0 : true)) {
      transitFound++;
    }
  }
}
const transitRate = totalStopsForTransit > 0 ? transitFound / totalStopsForTransit : 0;
results.push({
  id: 'B-7',
  label: 'transit_from_prev 채움률 >= 80%',
  actual: `${transitFound}/${totalStopsForTransit} (${(transitRate * 100).toFixed(0)}%)`,
  pass: totalStopsForTransit > 0 && transitRate >= 0.8,
  note: transitRate < 0.8 && transitRate >= 0.3
    ? 'ℹ️ 부분 채움 — RouteAgent 활성화 필요. 시범 단계는 경고만'
    : undefined,
});

// ─── B-8: response 봉고 0건 ─────────────────────────────
const bongoMatches = (fullText.match(/봉고/g) || []).length;
results.push({
  id: 'B-8',
  label: 'response 봉고 0건 (Staria 통일)',
  actual: `봉고 match=${bongoMatches}`,
  pass: bongoMatches === 0,
});

// ─── B-10: Day별 lodging bookend — stops[0].category === lodging ────
// 모든 day 의 첫 stop 이 lodging. lodging stop 없으면 fail.
let lodgingBookendPass = 0;
let lodgingBookendCheck = 0;
const dayDetails = [];
for (const d of days) {
  const stops = d.stops || [];
  if (stops.length === 0) continue;
  lodgingBookendCheck++;
  const firstCat = stops[0].category || '';
  if (firstCat === 'lodging') lodgingBookendPass++;
  dayDetails.push(`Day${d.day}:${firstCat}`);
}
results.push({
  id: 'B-10',
  label: 'Day별 lodging bookend (stops[0].category === lodging)',
  actual: `${lodgingBookendPass}/${lodgingBookendCheck} (${dayDetails.join(',')})`,
  pass: lodgingBookendCheck > 0 && lodgingBookendPass === lodgingBookendCheck,
});

// ─── B-11: ODsay source 비율 >= 50% ─────────────────────────
// transit_from_prev.mode 가 subway/bus/walk 인 비율
let odsayMatchCount = 0;
let transitWithMode = 0;
for (const day of days) {
  const stops = day.stops || [];
  for (let i = 1; i < stops.length; i++) {
    const t = stops[i].transit_from_prev || stops[i].transit;
    if (!t || typeof t !== 'object') continue;
    const mode = (t.mode || t.type || '').toLowerCase();
    if (mode) {
      transitWithMode++;
      if (['subway', 'bus', 'walk', 'transit', 'metro'].includes(mode)) {
        odsayMatchCount++;
      }
    }
  }
}
const odsayRate = transitWithMode > 0 ? odsayMatchCount / transitWithMode : 0;
results.push({
  id: 'B-11',
  label: 'ODsay source 비율 >= 50% (subway/bus/walk)',
  actual: `${odsayMatchCount}/${transitWithMode} (${(odsayRate * 100).toFixed(0)}%)`,
  pass: transitWithMode === 0 || odsayRate >= 0.5,
  note: transitWithMode === 0
    ? 'ℹ️ transit 미포함 — B-7 fail 시 함께 skip'
    : undefined,
});

// ─── B-12: Day별 stops >= 4 (1 stop Day 5 회귀 방지) ──────────
// 단, 마지막 출국일 (Day === days.length) 은 짧을 수 있으므로 >= 2 로 완화
let dayStopsPass = 0;
const dayStopsDetails = [];
for (const d of days) {
  const cnt = (d.stops || []).length;
  const isLastDay = d.day === days.length;
  const required = isLastDay ? 2 : 4;
  if (cnt >= required) dayStopsPass++;
  dayStopsDetails.push(`D${d.day}:${cnt}`);
}
results.push({
  id: 'B-12',
  label: 'Day별 stops >= 4 (마지막 day 는 >= 2 완화)',
  actual: `${dayStopsPass}/${days.length} pass (${dayStopsDetails.join(',')})`,
  pass: dayStopsPass === days.length,
});

// ─── B-13: 도시 전환 day lodging name 도시 매칭 ─────────────
// 각 day 의 첫 lodging stop name/address 가 day.city 와 일치하는지.
// day.city 가 영문일 수 있으므로 한글 매핑.
const cityToKor = {
  Seoul: '서울',
  Busan: '부산',
  Jeju: '제주',
  Gangneung: '강릉',
  Sokcho: '속초',
  Gyeongju: '경주',
  Jeonju: '전주',
};
let cityMatchPass = 0;
let cityMatchCheck = 0;
const cityMatchDetails = [];
for (const d of days) {
  const stops = d.stops || [];
  if (stops.length === 0) continue;
  if (stops[0].category !== 'lodging') continue; // B-10 가 잡음. 여기는 매칭만.
  cityMatchCheck++;
  const dayCity = d.city || '';
  const korCity = cityToKor[dayCity] || dayCity;
  const lodgingName = stops[0].name || '';
  const lodgingAddr = stops[0].address || '';
  const matches =
    lodgingName.includes(korCity) ||
    lodgingAddr.includes(korCity) ||
    lodgingName.toLowerCase().includes(dayCity.toLowerCase()) ||
    lodgingAddr.toLowerCase().includes(dayCity.toLowerCase());
  if (matches) cityMatchPass++;
  cityMatchDetails.push(`D${d.day}/${dayCity}:${matches ? '✓' : '✗'}`);
}
results.push({
  id: 'B-13',
  label: '도시 전환 day lodging name/addr 도시 매칭',
  actual: cityMatchCheck > 0
    ? `${cityMatchPass}/${cityMatchCheck} (${cityMatchDetails.join(',')})`
    : 'lodging stop 없음 (B-10 에서 fail)',
  pass: cityMatchCheck === 0 || cityMatchPass === cityMatchCheck,
});

// ─── B-14: 모든 stop start_time < 24:00 (HH:MM < 24:00) ─────
let invalidTime = 0;
const invalidTimeDetails = [];
for (const day of days) {
  for (const s of day.stops || []) {
    const t = s.start_time || '';
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) {
      invalidTime++;
      invalidTimeDetails.push(`D${day.day}/${s.order || '?'}:[${t}]`);
      continue;
    }
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h >= 24 || mm >= 60) {
      invalidTime++;
      invalidTimeDetails.push(`D${day.day}/${s.order || '?'}:[${t}]`);
    }
  }
}
results.push({
  id: 'B-14',
  label: '모든 stop start_time < 24:00',
  actual: invalidTime === 0
    ? 'all valid'
    : `invalid=${invalidTime} (${invalidTimeDetails.slice(0, 5).join(',')})`,
  pass: invalidTime === 0,
});

// ─── B-9: intercity_transit (다도시 전환 day) ──────────────
// regions: ['seoul','busan'] 다도시 plan 이라 어느 1 day 에 intercity_transit 객체 존재 (KTX 등)
let intercityFound = false;
let intercityMode = '';
for (const d of days) {
  if (d.intercity_transit && typeof d.intercity_transit === 'object') {
    intercityFound = true;
    intercityMode = d.intercity_transit.mode || '?';
    break;
  }
}
results.push({
  id: 'B-9',
  label: '다도시 intercity_transit 존재 (KTX 등)',
  actual: intercityFound ? `mode=${intercityMode}` : 'intercity_transit 없음',
  pass: intercityFound,
});

// ─── B-15: 출국일 공항 stop 또는 transit 존재 ───────────────
// 마지막 day 의 stops 중 category=='airport' 또는 name/address 에 공항/airport/ICN/GMP/PUS
const lastDay = days[days.length - 1];
const lastStops = (lastDay && lastDay.stops) || [];
const airportTokens = ['공항', 'airport', 'ICN', 'GMP', 'PUS', '인천', '김포', '김해'];
const hasAirportStop = lastStops.some((s) => {
  const name = (s.name || '') + (s.display_name || '') + (s.address || '');
  return s.category === 'airport' || airportTokens.some((t) => name.includes(t));
});
// 또는 day.last_to_lodging / day.return_to_airport 등 메타 필드
const hasAirportMeta =
  (lastDay && (lastDay.return_to_airport || lastDay.airport_transfer)) ||
  (lastStops[lastStops.length - 1] &&
    (lastStops[lastStops.length - 1].transit_to_airport ||
      lastStops[lastStops.length - 1].next_destination === 'airport'));
results.push({
  id: 'B-15',
  label: '출국일 공항 stop 또는 transit 존재',
  actual: `airport stop=${hasAirportStop}, meta=${!!hasAirportMeta}`,
  pass: hasAirportStop || !!hasAirportMeta,
});

// ─── B-16: PDF 생성 사전조건 (title/departure/arrival/planId) ────
// PDF 는 client-side 렌더링이라 서버 응답만으로 직접 검증 불가. 그러나 PDF 표지/마지막
// 페이지 필수 필드 누락 시 100% 클라이언트 렌더 깨짐. 백엔드 측 사전조건만 검증.
const planId = data.planId || data.id || '';
const tourTitle = data.tour_title || itin.tour_title || '';
const departureGuide = data.departure_guide || itin.departure_guide || '';
const arrivalGuideObj = data.arrival_guide || itin.arrival_guide || {};
const arrivalAirportField =
  arrivalGuideObj.airport || data.arrival_airport || itin.arrival_airport || '';
const requestedAirport = 'ICN'; // Step 2 request body 와 일치
const arrivalOk =
  !!arrivalAirportField &&
  String(arrivalAirportField).toUpperCase().includes(requestedAirport);
const b16Pass = !!planId && !!tourTitle && !!departureGuide && arrivalOk;
results.push({
  id: 'B-16',
  label: 'PDF 생성 사전조건 (title/departure/arrival/planId)',
  actual: `title=${tourTitle ? 'Y' : 'N'}, departure=${departureGuide ? 'Y' : 'N'}, arrival=${arrivalOk ? 'Y' : 'N'}, planId=${planId ? 'Y' : 'N'}`,
  pass: b16Pass,
});

// ─── B-17: 가격 합리성 (daily_budget 합산 ≈ total_cost) ─────
// daily_budget_summary 누락 시 skip (legacy plan 호환). 둘 다 0 이면 fail.
const dailyBudget =
  data.daily_budget_summary ||
  itin.daily_budget_summary ||
  [];
const totalCost =
  Number(data.total_cost_krw) ||
  Number(itin.base_price_krw) ||
  Number(data.total_cost) ||
  0;
let b17Result;
if (!Array.isArray(dailyBudget) || dailyBudget.length === 0) {
  b17Result = {
    id: 'B-17',
    label: '가격 합리성 (daily_budget 합산 ≈ total_cost, diff ≤ 20%)',
    actual: 'daily_budget_summary 누락',
    pass: true,
    note: 'daily_budget_summary 누락 — skip',
  };
} else {
  const sum = dailyBudget.reduce(
    (acc, d) => acc + (Number(d.total_krw) || Number(d.total) || Number(d.amount_krw) || 0),
    0,
  );
  if (sum === 0 && totalCost === 0) {
    b17Result = {
      id: 'B-17',
      label: '가격 합리성 (daily_budget 합산 ≈ total_cost, diff ≤ 20%)',
      actual: 'budget 데이터 누락',
      pass: false,
    };
  } else {
    const denom = Math.max(sum, totalCost);
    const diffPct = denom > 0 ? Math.abs(sum - totalCost) / denom : 1;
    b17Result = {
      id: 'B-17',
      label: '가격 합리성 (daily_budget 합산 ≈ total_cost, diff ≤ 20%)',
      actual: `sum=${sum.toLocaleString()}, total=${totalCost.toLocaleString()}, diff=${(diffPct * 100).toFixed(1)}%`,
      pass: diffPct <= 0.2,
    };
  }
}
results.push(b17Result);

// ─── B-18: 다양성 지표 (unique stop name ≥ 70%, local_tag ≥ 30%) ──
const allNames = [];
let localTagCount = 0;
const validLocalTags = ['Local Pick', 'Hidden Gem', 'Bakery Pilgrimage', 'Blue Ribbon'];
for (const d of days) {
  for (const s of d.stops || []) {
    const nm = (s.name || s.display_name || '').trim();
    if (nm) allNames.push(nm);
    const tag = (s.local_tag || '').trim();
    if (tag && validLocalTags.includes(tag)) localTagCount++;
  }
}
const totalNames = allNames.length;
const uniqueNames = new Set(allNames).size;
const uniqueRatio = totalNames > 0 ? uniqueNames / totalNames : 0;
const localTagRatio = totalNames > 0 ? localTagCount / totalNames : 0;
const b18Pass = uniqueRatio >= 0.7 && localTagRatio >= 0.3;
results.push({
  id: 'B-18',
  label: '다양성 지표 (unique stop name ≥ 70%, local_tag ≥ 30%)',
  actual: `unique=${uniqueNames}/${totalNames} (${(uniqueRatio * 100).toFixed(0)}%), local_tag=${localTagCount}/${totalNames} (${(localTagRatio * 100).toFixed(0)}%)`,
  pass: b18Pass,
});

// ─── Summary ──────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 받아적기 15항목 검증 결과');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} [${r.id}] ${r.label}`);
  console.log(`      → ${r.actual}`);
  if (r.note) console.log(`      ${r.note}`);
  if (r.pass) passCount++;
}
console.log(`\n  종합: ${passCount}/${results.length} pass`);

// Plan metadata for further inspection
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 plan metadata');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  planId: ${data.planId || data.id || 'unknown'}`);
console.log(`  planUrl: ${BASE_URL}/my-plans/${data.planId || data.id || ''}`);
console.log(`  days: ${days.length}`);
console.log(`  total stops: ${days.reduce((s, d) => s + (d.stops?.length || 0), 0)}`);
console.log(`  total cost: ${data.total_cost_krw || itin.base_price_krw || 'n/a'}`);
console.log(`  generation time: ${(planMs / 1000).toFixed(1)}s`);

// GitHub Actions markdown summary (CI 친화)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    '# CocoTrip 회귀 검증 결과 (L2 — 15항목)',
    '',
    `**Target:** ${BASE_URL}`,
    `**총합:** ${passCount}/${results.length} pass`,
    `**Plan time:** ${(planMs / 1000).toFixed(1)}s`,
    '',
    '| ID | 항목 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.label} | ${r.pass ? '✅' : '❌'} | ${r.actual.replace(/\|/g, '\\|')} |`),
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(passCount === results.length ? 0 : 1);
