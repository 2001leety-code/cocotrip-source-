/**
 * Unit test for api/_ai_core/qualityMetrics.js
 * Run: node scripts/test-quality-metrics.mjs
 *
 * Self-contained — no network, no Firebase. Asserts all 9 indicators detect
 * known violations on a hand-crafted fixture, and asserts a clean plan
 * scores 100.
 */
import { computeQualityScore, computeWeightedScore, METRIC_WEIGHTS } from '../api/_ai_core/qualityMetrics.js';

let pass = 0; let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ok — ${msg}`); }
  else { fail++; console.error(`  FAIL — ${msg}`); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// ── 1. Weights sum to 100 ──────────────────────────────────────────────────
console.log('\n[1] METRIC_WEIGHTS sum');
const sum = Object.values(METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
assertEq(sum, 100, 'sum of all weights == 100');

// ── 2. Clean itinerary scores 100 ──────────────────────────────────────────
console.log('\n[2] Perfect plan scores 100');
const cleanItin = {
  arrival_guide: { route_to_hotel: { est_min: 60 } },
  days: [
    {
      stops: [
        {
          name: '서울N타워', display_name: 'N Seoul Tower',
          lat: 37.5512, lng: 126.9882,
          category: 'sight', address: '서울특별시 용산구 남산공원길 105',
          tip: '한국 대표 전망대',
        },
        {
          name: '광장시장', display_name: '광장시장',
          lat: 37.5701, lng: 126.9999,
          category: 'food', address: '서울특별시 종로구 창경궁로 88',
          tip: '전통시장 먹거리',
          transit_from_prev: { est_min: 45, est_fare_krw: 1400 },
        },
      ],
    },
  ],
};
const foodIdx = [{ name: '광장시장', nameEn: 'Gwangjang Market' }];
const cleanResult = computeQualityScore(cleanItin, [], 'seoul', foodIdx, { lang: 'ko' });
console.log(`    score=${cleanResult.score}, metrics summary:`,
  Object.fromEntries(Object.entries(cleanResult.metrics).map(([k, v]) => [k, `${v.count}/${v.total}`])));
assertEq(cleanResult.score, 100, 'clean itinerary score == 100');
assertEq(cleanResult.metrics.unverified_restaurant.count, 0, 'unverified=0');
assertEq(cleanResult.metrics.bad_address_prefix.count, 0, 'bad_address=0');
assert(typeof cleanResult.computedAt === 'string' && cleanResult.computedAt.includes('T'),
  'computedAt is ISO string');

// ── 3. All 9 indicators detect violations ──────────────────────────────────
console.log('\n[3] Violation fixture trips all 9 indicators');
const dirtyItin = {
  arrival_guide: { /* no route_to_hotel — route_failure */ },
  days: [
    {
      stops: [
        // Stop A: missing display_name + coords (field_completeness)
        // bad address prefix (대한민국 -)
        // tip in English while user lang=ko (language_mismatch)
        // Pork stop while user is Halal (dietary_violation)
        // Not in food_index (unverified_restaurant)
        {
          name: '돼지국밥집', /* no display_name, no lat/lng */
          category: 'food', address: '대한민국 부산광역시 부산진구',
          tip: 'Best pork soup', // English, conflict with halal+ko
          start_time: '09:00', stay_min: 60, end_time: '10:00',
        },
        // Stop B: duplicate of A
        {
          name: '돼지국밥집', display_name: '돼지국밥집',
          lat: 35.15, lng: 129.05,
          category: 'food', address: '부산광역시 부산진구 중앙대로 700',
          tip: '맛있어요',
          start_time: '10:30', stay_min: 60, end_time: '11:30',
          // No transit_from_prev → route_failure
        },
        // Stop C: tight schedule + KR-prefixed address
        // 🔴 2026-08-03: tight 는 "이동시간 < 30분" 이 아니라 **여유 부족**이다.
        //   여유 = 다음 시작 − 이전 종료 − 이동 = 11:35 − 11:30 − 12분 = −7분
        //   → 손님이 11:35 에 도착할 수 없다. (옛 정의로 고치면 이 fixture 가 다시
        //     0/0 이 되어 조용히 통과한다 — 시각을 지우지 말 것.)
        {
          name: '해운대', display_name: '해운대',
          lat: 35.16, lng: 129.16,
          category: 'sight', address: 'KR 부산광역시 해운대구',
          tip: '바다',
          start_time: '11:35', stay_min: 60, end_time: '12:35',
          transit_from_prev: { est_min: 12 },
        },
        // Stop D: loose schedule (이동 120분 > 90). 여유는 충분해야 tight 와 섞이지 않는다:
        //   14:45 − 12:35 − 120분 = +10분
        {
          name: '광안리', display_name: '광안리',
          lat: 35.15, lng: 129.12,
          category: 'sight', address: '부산광역시 수영구 광안해변로',
          tip: '야경',
          start_time: '14:45', stay_min: 60, end_time: '15:45',
          transit_from_prev: { est_min: 120 },
        },
      ],
    },
  ],
};
const dirtyResult = computeQualityScore(dirtyItin, ['Halal'], 'busan', [], { lang: 'ko' });
console.log(`    score=${dirtyResult.score}, metrics:`,
  Object.fromEntries(Object.entries(dirtyResult.metrics).map(([k, v]) => [k, `${v.count}/${v.total}`])));

assert(dirtyResult.metrics.unverified_restaurant.count >= 1, 'unverified_restaurant > 0');
assert(dirtyResult.metrics.language_mismatch.count >= 1, 'language_mismatch > 0');
assert(dirtyResult.metrics.bad_address_prefix.count >= 2, 'bad_address_prefix >= 2 (대한민국 + KR)');
assert(dirtyResult.metrics.duplicate_stops.count >= 1, 'duplicate_stops > 0');
assert(dirtyResult.metrics.tight_schedule.count >= 1, 'tight_schedule > 0');
assert(dirtyResult.metrics.loose_schedule.count >= 1, 'loose_schedule > 0');
assert(dirtyResult.metrics.route_failure.count >= 1, 'route_failure > 0 (no route_to_hotel)');
assert(dirtyResult.metrics.field_completeness.count >= 1, 'field_completeness > 0');
assert(dirtyResult.metrics.dietary_violation.count >= 1, 'dietary_violation > 0 (halal vs pork)');
assert(dirtyResult.score < 100, `score reduced (got ${dirtyResult.score})`);
assert(dirtyResult.score >= 0,  'score >= 0');

// ── 4. computeWeightedScore handles zero-total denominators ────────────────
console.log('\n[4] Zero-total metrics do not divide-by-zero');
const emptyMetrics = {
  unverified_restaurant: { total: 0, count: 0 },
  language_mismatch:     { total: 0, count: 0 },
  bad_address_prefix:    { total: 0, count: 0 },
  duplicate_stops:       { total: 0, count: 0 },
  tight_schedule:        { total: 0, count: 0 },
  loose_schedule:        { total: 0, count: 0 },
  route_failure:         { total: 0, count: 0 },
  field_completeness:    { total: 0, count: 0 },
  dietary_violation:     { total: 0, count: 0 },
};
assertEq(computeWeightedScore(emptyMetrics), 100, 'all-zero metrics score == 100');

// ── 5. Score floor at 0 (never negative) ───────────────────────────────────
console.log('\n[5] Worst-case fixture clamps score at >= 0');
const worstMetrics = {};
for (const k of Object.keys(METRIC_WEIGHTS)) {
  worstMetrics[k] = { total: 1, count: 1 }; // 100% violation rate
}
assert(computeWeightedScore(worstMetrics) >= 0, 'worst-case score >= 0');
assertEq(computeWeightedScore(worstMetrics), 0, 'worst-case score == 0');

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`TEST RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
