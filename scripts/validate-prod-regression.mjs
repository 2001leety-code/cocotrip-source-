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
//
// 시나리오 매트릭스 (L2, 2026-05-12 추가):
//   SCENARIO_NAME             — 시나리오 식별자 (출력 prefix). 기본 'default'
//   SCENARIO_REGIONS          — comma split. 예 'seoul,busan'. 기본 'seoul,busan'
//   SCENARIO_DURATION         — 정수. 기본 5
//   SCENARIO_LANG             — ko/en/ja/zh. 기본 'ko'
//   SCENARIO_DIETARY          — comma split (빈 값 OK). 예 'Halal,Vegan'. 기본 'Meat'
//   SCENARIO_ARRIVAL_AIRPORT  — ICN/GMP/PUS/CJU. 기본 'ICN'
// 기본값은 daily-health / pr-regression 호환 위해 기존 hardcoded 값 유지.

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

// ─── 시나리오 매트릭스 매개변수 (env override, 기본값은 기존 hardcoded 유지) ───
const SCENARIO_NAME = process.env.SCENARIO_NAME || 'default';
const SCENARIO_REGIONS = (process.env.SCENARIO_REGIONS || 'seoul,busan')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SCENARIO_DURATION = parseInt(process.env.SCENARIO_DURATION || '5', 10);
const SCENARIO_LANG = process.env.SCENARIO_LANG || 'ko';
const SCENARIO_DIETARY = (process.env.SCENARIO_DIETARY ?? 'Meat')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SCENARIO_ARRIVAL_AIRPORT = process.env.SCENARIO_ARRIVAL_AIRPORT || 'ICN';

// 시나리오에 따라 1번째 region 기준으로 area + recommendedZones + arrivalTerminal 자동 산출
const ZONE_BY_REGION = {
  seoul: 'myeongdong',
  busan: 'haeundae',
  jeju: 'jungmun',
  gangneung: 'gangneung-beach',
  sokcho: 'sokcho-beach',
  gyeongju: 'bomun',
  jeonju: 'hanok-village',
};
const TERMINAL_BY_AIRPORT = {
  ICN: 'T1',
  GMP: 'T1',
  PUS: 'T1',
  CJU: 'T1',
};
const SCENARIO_AREA = SCENARIO_REGIONS[0] || 'seoul';
const SCENARIO_RECOMMENDED_ZONES = Object.fromEntries(
  SCENARIO_REGIONS.map((r) => [r, ZONE_BY_REGION[r] || ''])
    .filter(([, v]) => v)
);
const SCENARIO_ARRIVAL_TERMINAL = TERMINAL_BY_AIRPORT[SCENARIO_ARRIVAL_AIRPORT] || 'T1';

if (!apiKey || !email || !password) {
  console.error('❌ Missing credentials. Set FIREBASE_WEB_API_KEY, HEALTH_CHECK_EMAIL, HEALTH_CHECK_PASSWORD');
  console.error('   (CI: GitHub Secrets / Local: .env.local)');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🔍 CocoTrip 회귀 검증 슈트 (받아적기 15항목 / L2) — [${SCENARIO_NAME}]`);
console.log(`   Target: ${BASE_URL}`);
console.log(`   Scenario: regions=[${SCENARIO_REGIONS.join(',')}] duration=${SCENARIO_DURATION}d lang=${SCENARIO_LANG} dietary=[${SCENARIO_DIETARY.join(',') || '-'}] airport=${SCENARIO_ARRIVAL_AIRPORT}`);
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

// ─── Step 2: plan 생성 (시나리오 매개변수) ──────────────────
console.log(`[2/3] POST /api/ai-planner-full — [${SCENARIO_NAME}] ${SCENARIO_REGIONS.join('+')} ${SCENARIO_DURATION}일 plan 생성...`);
const planStart = Date.now();
const planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.idToken}`,
  },
  body: JSON.stringify({
    paypalOrderId: 'ADMIN-BYPASS-REGRESSION-' + Date.now(),
    uid: auth.localId,
    guestName: 'RegressionSuite',
    pax: 2,
    durationDays: SCENARIO_DURATION,
    // Dynamic future date (today + 14d). Hardcoded '2026-06-15' became a past date,
    //   so every scenario was rejected with PLANNER_DATE_TOO_SOON (scenario-matrix red 6+ days,
    //   regression net effectively down). Date.now()+14d always lands in the future.
    startDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    area: SCENARIO_AREA,
    regions: SCENARIO_REGIONS,
    recommendedZones: SCENARIO_RECOMMENDED_ZONES,
    dietPrefs: SCENARIO_DIETARY,
    priceRange: 'Moderate',
    language: SCENARIO_LANG,
    styles: ['Food', 'Photo'],
    arrivalAirport: SCENARIO_ARRIVAL_AIRPORT,
    arrival_airport: SCENARIO_ARRIVAL_AIRPORT === 'ICN' ? 'ICN_T1' : SCENARIO_ARRIVAL_AIRPORT,
    departure_airport: SCENARIO_ARRIVAL_AIRPORT === 'ICN' ? 'ICN_T1' : SCENARIO_ARRIVAL_AIRPORT,
    arrivalTerminal: SCENARIO_ARRIVAL_TERMINAL,
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
const isMultiCity = SCENARIO_REGIONS.length >= 2;

// ─── B-2: 다도시 stops 분배 (다도시만, 시나리오 region 모두 > 0) ───
if (isMultiCity) {
  const REGION_KOR_KEYWORDS = {
    seoul: '서울',
    busan: '부산',
    jeju: '제주',
    gangneung: '강릉',
    sokcho: '속초',
    gyeongju: '경주',
    jeonju: '전주',
  };
  const cityCounts = Object.fromEntries(SCENARIO_REGIONS.map((r) => [r, 0]));
  let otherCount = 0;
  for (const d of days) {
    for (const s of d.stops || []) {
      const addr = s.address || '';
      let matched = false;
      for (const r of SCENARIO_REGIONS) {
        const kw = REGION_KOR_KEYWORDS[r] || r;
        if (addr.includes(kw)) {
          cityCounts[r]++;
          matched = true;
          break;
        }
      }
      if (!matched) otherCount++;
    }
  }
  const allRegionsCovered = SCENARIO_REGIONS.every((r) => cityCounts[r] > 0);
  const breakdown = SCENARIO_REGIONS.map((r) => `${r}=${cityCounts[r]}`).join(', ');
  results.push({
    id: 'B-2',
    label: `다도시 stops 분배 (${SCENARIO_REGIONS.join(' + ')} 모두 > 0)`,
    actual: `${breakdown}, 기타=${otherCount}`,
    pass: allRegionsCovered,
  });
} else {
  results.push({
    id: 'B-2',
    label: '다도시 stops 분배 (skip — 단일 region 시나리오)',
    actual: `regions=[${SCENARIO_REGIONS.join(',')}]`,
    pass: true,
    note: 'ℹ️ 단일 region 시나리오에서는 스킵',
  });
}

// ─── B-3: 추천 식당 region 균등 (다도시만) ──────────────────
if (isMultiCity) {
  const recByRegion = Object.fromEntries(SCENARIO_REGIONS.map((r) => [r, 0]));
  let otherRecCount = 0;
  for (const r of allRecs) {
    if (r.region && SCENARIO_REGIONS.includes(r.region)) {
      recByRegion[r.region]++;
    } else {
      otherRecCount++;
    }
  }
  // 균등 — 모든 region 1+, max-min <= max (즉 한쪽 0 금지)
  const counts = SCENARIO_REGIONS.map((r) => recByRegion[r]);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const balanceOk = minCount >= 1 && maxCount - minCount <= maxCount;
  const breakdown = SCENARIO_REGIONS.map((r) => `${r}=${recByRegion[r]}`).join(', ');
  results.push({
    id: 'B-3',
    label: `추천 식당 region 균등 (${SCENARIO_REGIONS.join(' + ')} 각자 1+)`,
    actual: `총 ${allRecs.length}개 (${breakdown}, other=${otherRecCount})`,
    pass: balanceOk,
  });
} else {
  results.push({
    id: 'B-3',
    label: '추천 식당 region 균등 (skip — 단일 region 시나리오)',
    actual: `총 ${allRecs.length}개`,
    pass: true,
    note: 'ℹ️ 단일 region 시나리오에서는 스킵',
  });
}

// ─── B-6a: Day N 출력 (days.length === SCENARIO_DURATION) ─────
results.push({
  id: 'B-6a',
  label: `Day ${SCENARIO_DURATION} 출력 (days.length === ${SCENARIO_DURATION})`,
  actual: `days.length=${days.length}`,
  pass: days.length === SCENARIO_DURATION,
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
// transit_from_prev.mode / method / source 다중 fallback 으로 ODsay 사용 비율 측정.
// 2026-05-12 자율 검증 fix (PR #369): RouteAgent 는 method 필드만 저장하고
// mode 필드는 신규 추가됐다. 회귀 슈트는 두 필드 모두 확인 + 'subway+bus' 정규화.
// source === 'odsay' 면 최종 확정 — RouteAgent 가 ODsay 응답 기반으로 작성한 객체.
let odsayMatchCount = 0;
let transitWithMode = 0;
const allowedModes = ['subway', 'bus', 'walk', 'transit', 'metro', 'subway+bus', 'bus+subway'];
for (const day of days) {
  const stops = day.stops || [];
  for (let i = 1; i < stops.length; i++) {
    const t = stops[i].transit_from_prev || stops[i].transit;
    if (!t || typeof t !== 'object') continue;
    // 다중 fallback: mode → method → type
    const modeRaw = (t.mode || t.method || t.type || '').toLowerCase();
    const source = (t.source || '').toLowerCase();
    if (modeRaw || source) {
      transitWithMode++;
      // ODsay match 조건 (어느 하나라도 만족):
      //   1) mode/method/type 이 알려진 transit enum
      //   2) source === 'odsay' (RouteAgent 직접 작성)
      if (allowedModes.includes(modeRaw) || source === 'odsay') {
        odsayMatchCount++;
      }
    }
  }
}
const odsayRate = transitWithMode > 0 ? odsayMatchCount / transitWithMode : 0;
results.push({
  id: 'B-11',
  label: 'ODsay source 비율 >= 50% (subway/bus/walk/transit)',
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

// ─── B-13: 도시 전환 day lodging name 도시 매칭 (다도시만) ─────
// P149-v2 (2026-05-22): L5 negative matching — 다른 도시 명시적 언급 시만 fail.
//   generic hotel ("비즈니스 호텔", "Paradise Hotel") 은 도시명 미포함이 정상 → PASS.
//   실제 mismatch: Seoul day 에 "해운대 호텔 부산광역시" → Busan 명시 → FAIL.
if (isMultiCity) {
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
    const dayCityLow = dayCity.toLowerCase();
    const lodgingName = stops[0].name || '';
    const lodgingAddr = stops[0].address || '';
    const hay = (lodgingName + ' ' + lodgingAddr).toLowerCase();
    // L5 negative check: 다른 도시 명시적 언급 여부.
    const otherCities = SCENARIO_REGIONS.filter(r => r.toLowerCase() !== dayCityLow);
    const hasExplicitOtherCity = otherCities.some(other => {
      const otherKor = cityToKor[other.charAt(0).toUpperCase() + other.slice(1)] || '';
      return hay.includes(other.toLowerCase()) || (otherKor && hay.includes(otherKor.toLowerCase()));
    });
    const matches = !hasExplicitOtherCity; // 다른 도시 없으면 OK
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
} else {
  results.push({
    id: 'B-13',
    label: '도시 전환 day lodging 매칭 (skip — 단일 region 시나리오)',
    actual: `regions=[${SCENARIO_REGIONS.join(',')}]`,
    pass: true,
    note: 'ℹ️ 단일 region 시나리오에서는 스킵',
  });
}

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

// ─── B-9: intercity_transit (다도시 전환 day, 다도시만) ───────
if (isMultiCity) {
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
} else {
  results.push({
    id: 'B-9',
    label: 'intercity_transit (skip — 단일 region 시나리오)',
    actual: `regions=[${SCENARIO_REGIONS.join(',')}]`,
    pass: true,
    note: 'ℹ️ 단일 region 시나리오에서는 스킵',
  });
}

// ─── B-15: 출국일 공항 stop 또는 transit 존재 ───────────────
// 마지막 day 의 stops 중 category=='airport' 또는 name/address 에 공항/airport/ICN/GMP/PUS/CJU
const lastDay = days[days.length - 1];
const lastStops = (lastDay && lastDay.stops) || [];
// 2026-07-03: 서버 B-15 가드(responseValidator.js)와 동기화 — case-insensitive 토큰
// + travel category 인정 (기존엔 'Airport' 대문자 미매칭 등 Gemini 정상 plan 위양성 가능).
const airportTokens = ['공항', 'airport', 'icn', 'gmp', 'pus', 'cju', '인천', '김포', '김해', '제주'];
const hasAirportStop = lastStops.some((s) => {
  const name = ((s.name || '') + (s.display_name || '') + (s.address || '')).toLowerCase();
  const cat = String(s.category || '').toLowerCase();
  return cat === 'airport' || (cat === 'travel' && airportTokens.some((t) => name.includes(t))) || airportTokens.some((t) => name.includes(t));
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

// ─── B-17: 가격 데이터 구조 합리성 ────────────────────────────
// 2026-05-12 오후 수정: 초안 logic 잘못 — `total_cost_krw` 는 차터 차량
// `base_price_krw` (Staria 등) 이고 `daily_budget_summary` 는 일별 잡비
// (entry fees + meals + activities + shopping). 둘은 더해야 할 항목 ≠ 같은 값.
// 새 logic: 데이터 구조 합리성 만 검증.
//   1. daily_budget_summary.length === days.length (일 수 일치)
//   2. 각 day total_krw > 0 (빈 day 없음)
//   3. base_price_krw 또는 total_cost_krw > 0 (차량비 정보 존재)
// daily_budget_summary 누락 시 skip (legacy plan 호환).
const dailyBudget =
  data.daily_budget_summary ||
  itin.daily_budget_summary ||
  [];
const basePrice =
  Number(data.total_cost_krw) ||
  Number(itin.base_price_krw) ||
  Number(data.total_cost) ||
  // block_mode: itinerary 에 base_price_krw 없음(legacy Gemini 계약 전용 필드) —
  // 서버 계산 가격 SSOT(vehicleAndPrice.calcPrice)가 항상 실리는 pricing.priceKRW 사용.
  // 2026-07-03 B-17 거짓 FAIL fix (6/22 이후 block_mode 서빙 plan 에서 base_price=0 오탐).
  Number(data.pricing?.priceKRW) ||
  0;
let b17Result;
if (!Array.isArray(dailyBudget) || dailyBudget.length === 0) {
  b17Result = {
    id: 'B-17',
    label: '가격 데이터 구조 합리성 (daily_budget length === days, total>0)',
    actual: 'daily_budget_summary 누락',
    pass: true,
    note: 'daily_budget_summary 누락 — skip (legacy 호환)',
  };
} else {
  const lengthMatch = dailyBudget.length === days.length;
  const allDaysHaveTotal = dailyBudget.every(
    (d) => (Number(d.total_krw) || Number(d.total) || Number(d.amount_krw) || 0) > 0,
  );
  const basePriceOk = basePrice > 0;
  const dailySum = dailyBudget.reduce(
    (acc, d) => acc + (Number(d.total_krw) || Number(d.total) || Number(d.amount_krw) || 0),
    0,
  );
  const issues = [];
  if (!lengthMatch) issues.push(`length=${dailyBudget.length}≠days=${days.length}`);
  if (!allDaysHaveTotal) issues.push('1+ day total=0');
  if (!basePriceOk) issues.push('base_price=0');
  b17Result = {
    id: 'B-17',
    label: '가격 데이터 구조 합리성 (daily_budget length === days, total>0)',
    actual: issues.length === 0
      ? `length=${dailyBudget.length}/${days.length}, base=${basePrice.toLocaleString()}, daily_sum=${dailySum.toLocaleString()}`
      : `issues: ${issues.join(', ')}`,
    pass: lengthMatch && allDaysHaveTotal && basePriceOk,
  };
}
results.push(b17Result);

// ─── B-18: 다양성 지표 (unique stop name ≥ 70%, local_tag ≥ 30%) ──
// 2026-07-03 fix: local_tag 검사를 responseValidator.checkSoftQualityWarnings 와 미러.
// block_mode(큐레이션 블록) stop 의 local_tag 는 zone_courses 시드 키워드라 4-value enum 과
// 어휘가 달라 결정론적 0% 거짓 FAIL 이었다 (6/29 커밋 53c7fe11 이 서버 소프트경고만 fix,
// 회귀 스크립트 미반영). source_block_id stop + lodging/travel/airport 제외, eligible<5 skip.
const allNames = [];
let localTagCount = 0;
let eligibleCount = 0;
const B18_EXCLUDED_CATEGORIES = ['lodging', 'travel', 'airport'];
const validLocalTags = ['Local Pick', 'Hidden Gem', 'Bakery Pilgrimage', 'Blue Ribbon'];
for (const d of days) {
  for (const s of d.stops || []) {
    const nm = (s.name || s.display_name || '').trim();
    if (nm) allNames.push(nm); // unique name 은 기존대로 전체 stop 대상
    const cat = String(s.category || '').toLowerCase();
    if (B18_EXCLUDED_CATEGORIES.includes(cat)) continue;
    if (s.source_block_id) continue; // 큐레이션 블록 — enum tag 없음(의도된 semantics)
    eligibleCount++;
    const tag = (s.local_tag || '').trim();
    if (tag && validLocalTags.includes(tag)) localTagCount++;
  }
}
const totalNames = allNames.length;
const uniqueNames = new Set(allNames).size;
const uniqueRatio = totalNames > 0 ? uniqueNames / totalNames : 0;
const localTagRatio = eligibleCount > 0 ? localTagCount / eligibleCount : 0;
// eligible < 5 = 사실상 pure-block plan — local_tag 검사 skip (서버 소프트경고와 동일 기준)
const b18Pass = uniqueRatio >= 0.7 && (eligibleCount < 5 || localTagRatio >= 0.3);
results.push({
  id: 'B-18',
  label: '다양성 지표 (unique stop name ≥ 70%, local_tag ≥ 30%)',
  actual: `unique=${uniqueNames}/${totalNames} (${(uniqueRatio * 100).toFixed(0)}%), local_tag=${eligibleCount < 5 ? `skip(block, eligible=${eligibleCount})` : `${localTagCount}/${eligibleCount} (${(localTagRatio * 100).toFixed(0)}%)`}`,
  pass: b18Pass,
});

// ─── Summary ──────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 받아적기 15항목 검증 결과 — [${SCENARIO_NAME}]`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} [${SCENARIO_NAME}][${r.id}] ${r.label}`);
  console.log(`      → ${r.actual}`);
  if (r.note) console.log(`      ${r.note}`);
  if (r.pass) passCount++;
}
console.log(`\n  종합: [${SCENARIO_NAME}] ${passCount}/${results.length} pass`);

// Plan metadata for further inspection
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 plan metadata');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  planId: ${data.planId || data.id || 'unknown'}`);
console.log(`  planUrl: ${BASE_URL}/my-plans/${data.planId || data.id || ''}`);
console.log(`  days: ${days.length}`);
console.log(`  total stops: ${days.reduce((s, d) => s + (d.stops?.length || 0), 0)}`);
console.log(`  total cost: ${data.total_cost_krw || itin.base_price_krw || data.pricing?.priceKRW || 'n/a'}`);
console.log(`  generation time: ${(planMs / 1000).toFixed(1)}s`);

// GitHub Actions markdown summary (CI 친화)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    `# CocoTrip 회귀 검증 결과 (L2 — 15항목) — [${SCENARIO_NAME}]`,
    '',
    `**Target:** ${BASE_URL}`,
    `**Scenario:** regions=[${SCENARIO_REGIONS.join(',')}] duration=${SCENARIO_DURATION}d lang=${SCENARIO_LANG} dietary=[${SCENARIO_DIETARY.join(',') || '-'}] airport=${SCENARIO_ARRIVAL_AIRPORT}`,
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
