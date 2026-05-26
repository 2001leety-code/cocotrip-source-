/**
 * inspect-plans.mjs — generic Firestore plan inspector
 *
 * 사용법:
 *   node scripts/inspect-plans.mjs                          # 기본 P205 5 sample plan
 *   node scripts/inspect-plans.mjs <planId1> <planId2> ...  # 임의 plan ID 지정
 *
 * 출력 field:
 *   - tour_title / days / total_stops
 *   - arrival.airport / departure.airport
 *   - status (streaming / ready / error)
 *   - _streaming_in_progress (boolean) — skeleton stuck 판별
 *   - minimal_fallback (P181)
 *   - lodging cross-city (P114/P202)
 *
 * P206 (measure status=ready polling) 와 시너지 — 둘 다 status 활용.
 * P210-B: sample 5 (eaccffbd, days=0 hang) 즉시 판별 가능.
 *
 * deep-search: reports/visual-2026-05-26/deepsearch-p210.md
 */

// ---------------------------------------------------------------------------
// 1. env 로드
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs';

function parseEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        })
    );
  } catch { return {}; }
}
const env = { ...parseEnvFile('.env'), ...parseEnvFile('.env.local') };
const apiKey = env.VITE_FIREBASE_API_KEY;
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'planning-with-ai-a0801';
const email = env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';
const password = env.HEALTH_CHECK_PASSWORD;

if (!apiKey || !password) {
  console.error('Missing env: VITE_FIREBASE_API_KEY or HEALTH_CHECK_PASSWORD');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. CLI args → plan IDs
// ---------------------------------------------------------------------------
/** @type {Array<{ id: string, label: string }>} */
const DEFAULT_P205_PLANS = [
  { id: '14742210-a228-46bd-9893-227e72223682', label: 'P205 sample 1' },
  { id: '68eda959-0a66-4d6e-bbc5-a5dcb74230d0', label: 'P205 sample 2' },
  { id: '192c5b69-2fc3-4dbf-8199-d6acd829c7af', label: 'P205 sample 3' },
  { id: 'e5b6a8c3-c4b7-4618-a05a-ce35ca3e63b5', label: 'P205 sample 4' },
  { id: 'eaccffbd-b7fd-411b-9e34-6f835c71d56d', label: 'P205 sample 5' },
];

const cliArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const plans = cliArgs.length > 0
  ? cliArgs.map((id, i) => ({ id, label: `CLI plan ${i + 1}` }))
  : DEFAULT_P205_PLANS;

// ---------------------------------------------------------------------------
// 3. Auth
// ---------------------------------------------------------------------------
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
  console.error('Auth fail:', JSON.stringify(auth).slice(0, 200));
  process.exit(1);
}
console.log(`Auth OK (uid=${auth.localId})\n`);

// ---------------------------------------------------------------------------
// 4. helper: parse Firestore REST response field
// ---------------------------------------------------------------------------
/**
 * Firestore REST 응답의 fields 객체에서 status / _streaming_in_progress 추출.
 * @param {object} fields - doc.fields
 * @returns {{ status: string, streamingInProgress: boolean | undefined }}
 */
export function extractStatusFields(fields) {
  const status = fields.status?.stringValue || '(없음)';
  const rawSip = fields._streaming_in_progress;
  const streamingInProgress = rawSip !== undefined
    ? (rawSip.booleanValue !== undefined ? rawSip.booleanValue : (rawSip.stringValue === 'true' ? true : false))
    : undefined;
  return { status, streamingInProgress };
}

// ---------------------------------------------------------------------------
// 5. 순회 조회
// ---------------------------------------------------------------------------
let summary = {
  totalPlans: 0,
  totalAccessible: 0,
  departureNullCount: 0,
  arrivalNullCount: 0,
  minimalFallbackCount: 0,
  crossCityCount: 0,
  lowStopCount: 0,
  // P210-B 추가
  streamingCount: 0,
  readyCount: 0,
  stuckSkeletonCount: 0,
};

for (const { id, label } of plans) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/plans/${id}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.idToken}` } });
  summary.totalPlans++;

  console.log(`\n━━━ ${label} (${id.slice(0, 8)}) ━━━`);

  if (!res.ok) {
    console.log(`HTTP ${res.status} — 본인 plan 아니거나 삭제됨`);
    continue;
  }
  summary.totalAccessible++;

  const doc = await res.json();
  const fields = doc.fields || {};
  const itinerary = fields.itinerary?.mapValue?.fields || {};
  const ownerUid = fields.userId?.stringValue || fields.uid?.stringValue || '(없음)';

  // P210-B: status + _streaming_in_progress
  const { status, streamingInProgress } = extractStatusFields(fields);
  const days = (itinerary.days && itinerary.days.arrayValue && itinerary.days.arrayValue.values) || [];
  const isStuckSkeleton = (streamingInProgress === true && days.length === 0);

  if (status === 'streaming') summary.streamingCount++;
  if (status === 'ready') summary.readyCount++;
  if (isStuckSkeleton) summary.stuckSkeletonCount++;
  const tourTitle = itinerary.tour_title?.stringValue || '(없음)';
  const arrival = itinerary.arrival_guide?.mapValue?.fields || {};
  const departure = itinerary.departure_guide?.mapValue?.fields || {};
  const arrivalAirport = arrival.airport?.stringValue || '(없음)';
  const departureAirport = departure.airport?.stringValue || '(없음)';

  if (!arrival.airport?.stringValue) summary.arrivalNullCount++;
  if (!departure.airport?.stringValue) summary.departureNullCount++;

  let totalStops = 0;
  let lodgingCrossCity = [];
  let dayCities = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i].mapValue?.fields || {};
    const stops = day.stops?.arrayValue?.values || [];
    totalStops += stops.length;
    const dayCity = day.city?.stringValue || '(없음)';
    dayCities.push(`D${i + 1}:${dayCity}`);
    for (const stop of stops) {
      const s = stop.mapValue?.fields || {};
      const cat = s.category?.stringValue || '';
      if (cat === 'lodging') {
        const addr = s.address?.stringValue || '';
        const cityMap = { Seoul: '서울', Busan: '부산', Jeju: '제주', Gyeongju: '경주', Daegu: '대구' };
        const expectedKr = cityMap[dayCity];
        const otherCities = Object.entries(cityMap).filter(([k]) => k !== dayCity).map(([, v]) => v);
        const hasOtherCity = otherCities.some(c => addr.includes(c));
        if (hasOtherCity && expectedKr && !addr.includes(expectedKr)) {
          lodgingCrossCity.push(`Day${i + 1} city=${dayCity} lodging=${addr.slice(0, 50)}`);
        }
      }
    }
  }
  if (lodgingCrossCity.length > 0) summary.crossCityCount++;
  if (totalStops < 15) summary.lowStopCount++;

  const minimalFlag = itinerary.__repair_minimal_fallback?.booleanValue;
  if (minimalFlag) summary.minimalFallbackCount++;

  // 출력
  console.log(`owner uid: ${ownerUid.slice(0, 28)}${ownerUid.length > 28 ? '...' : ''}`);
  console.log(`tour_title: ${tourTitle.slice(0, 80)}`);
  console.log(`days: ${days.length} (${dayCities.join(', ') || '없음'}) / total stops: ${totalStops}`);
  console.log(`arrival.airport: ${arrivalAirport} / departure.airport: ${departureAirport}`);
  // P210-B 핵심 출력
  const sipLabel = streamingInProgress === undefined ? '(없음)' : String(streamingInProgress);
  const stuckLabel = isStuckSkeleton ? ' ⚠️ SKELETON STUCK' : '';
  console.log(`status: ${status} / _streaming_in_progress: ${sipLabel}${stuckLabel}`);
  console.log(`minimal_fallback: ${minimalFlag ? 'TRUE (P181 ⚠️)' : 'false'}`);
  console.log(`lodging cross-city: ${lodgingCrossCity.length > 0 ? lodgingCrossCity.join(' | ') : '0'}`);
}

// ---------------------------------------------------------------------------
// 6. 종합 통계
// ---------------------------------------------------------------------------
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('## 종합');
console.log(`- 접근 가능: ${summary.totalAccessible}/${summary.totalPlans}`);
console.log(`- arrival.airport null: ${summary.arrivalNullCount}/${summary.totalAccessible}`);
console.log(`- departure.airport null: ${summary.departureNullCount}/${summary.totalAccessible}`);
console.log(`- minimal_fallback TRUE: ${summary.minimalFallbackCount}/${summary.totalAccessible} (P181/P204)`);
console.log(`- lodging cross-city: ${summary.crossCityCount}/${summary.totalAccessible} (P114/P202)`);
console.log(`- total stops < 15: ${summary.lowStopCount}/${summary.totalAccessible}`);
// P210-B 추가 통계
console.log(`- 상태 streaming 진행 중: ${summary.streamingCount}/${summary.totalAccessible}`);
console.log(`- 상태 ready: ${summary.readyCount}/${summary.totalAccessible}`);
console.log(`- skeleton stuck (streaming + days=0): ${summary.stuckSkeletonCount}/${summary.totalAccessible}`);
