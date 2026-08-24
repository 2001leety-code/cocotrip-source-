/**
 * Plan Quality Metrics — Tier 2-D
 *
 * 9 quality indicators measured per generated plan, then summarized into a
 * weighted 0-100 score and persisted to `plans/{id}.qualityScore`.
 *
 * Indicators:
 *   1. unverified_restaurant — food stops not matched to _food_index.json
 *   2. language_mismatch     — tip text language differs from user lang
 *   3. bad_address_prefix    — "대한민국 " / "KR " prefix still present, OR
 *                              address does not start with a Korean city/region
 *   4. duplicate_stops       — same stop name repeated across the itinerary
 *   5. tight_schedule        — schedule slack below SCHEDULE_BUFFER_MIN, i.e.
 *                              the guest cannot actually reach the next stop
 *   6. loose_schedule        — single transit leg > 90 min (day burned on travel)
 *   7. route_failure         — RouteAgent failures (route_to_hotel missing,
 *                              transit_from_prev absent for non-first stop, etc.)
 *   8. field_completeness    — required fields (name/display_name/lat/lng) missing
 *   9. dietary_violation     — stops violating user dietary restrictions
 *      (SAFETY-CRITICAL — heaviest weight; see CLAUDE.md J)
 *
 * Logic mirrors scripts/validate-planner.cjs analyzeIssues() so offline
 * validation runs and live runtime computation produce identical counts.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 2026-08-03 — 지표가 "정상 일정 구조"를 결함으로 세던 것 수정
 *
 * L3 Quality Monitor 가 24h 평균 79.8 < hard floor 80 으로 실패했다. 원인을
 * 운영 Firestore 플랜 25건 원본으로 추적한 결과, 감점 20.34 중 **16.7(82%)이
 * 오측정**이었다. 일정 자체는 7/27 이후 바뀐 게 없다(같은 count/total 인데
 * 7/28 가중치 재배분 뒤 점수만 90.7 → 79.8 로 내려갔다).
 *
 * 1) tight_schedule — "이동시간 < 30분" 을 촉박으로 셌다. 그런데 짧은 이동은
 *    잘 묶인 동선의 **목표**다(익선동 → 서순라길 도보 4분). 실측 362 구간 중
 *    78.5% 가 30분 미만 → 12.65점 감점. 반면 진짜 여유
 *    (다음 시작 − 이전 종료 − 이동)는 313/313 구간 전부 5분 이상, 음수 0건
 *    이었다. **촉박한 구간은 한 건도 없었다.**
 *    → 이동시간이 아니라 여유를 잰다. 기준은 RouteAgent 가 실제로 얹는
 *      SCHEDULE_BUFFER_MIN (constants.js 단일 원천).
 *
 * 2) duplicate_stops — 중복 117건 중 105건(90%)이 "숙소에서 출발 → 숙소로
 *    복귀". buildPrompt.js 가 **모든 day 를 lodging 으로 시작·종료하라고 강제**
 *    한다(:375, :390). 설계가 시킨 구조를 결함으로 센 것.
 *    → lodging 은 중복 집계에서 제외(분모에서도).
 *
 * 3) field_completeness — 좌표 누락 98건 **전부 lodging**, 비-lodging 은 0건.
 *    손님이 호텔을 특정하지 않으면 "명동 지역 숙소"(address="서울 명동") 같은
 *    지역 placeholder 가 들어간다. 좌표가 없는 게 정상이다.
 *    → lodging 은 좌표를 요구하지 않는다. 이름·표기명은 그대로 요구.
 *
 * 4) route_failure — 누락 49건 **전부 lodging 도착 구간**. 좌표 없는 숙소로는
 *    경로를 낼 수 없다. 단, 손님이 호텔을 특정한 경우(좌표 있음)는 경로가
 *    나와야 하므로 그건 계속 실패로 센다.
 *    → 좌표 없는 lodging 도착 구간만 분모·분자에서 제외.
 *
 * ⚠️ 가중치는 이번에 건드리지 않았다. 7/28 배분은 위 오측정률을 실제 오류율로
 *    믿고 정한 값이라 재조정 여지가 있으나, 근거가 될 "진짜 오류율"은 이 수정
 *    후 며칠 쌓여야 나온다. 데이터 없이 다시 감으로 배분하지 않는다.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { SCHEDULE_BUFFER_MIN, AIRPORT_ARRIVE_BEFORE_MIN } from './constants.js';

// ── Configuration ──────────────────────────────────────────────────────────
// Weights are applied to per-stop violation rates (or absolute counts for
// schedule). Sum of weights = 100 so a "perfect" plan scores 100, and a plan
// with ALL stops violating a single indicator drops by exactly that weight.
// 🔴 2026-07-28 재배분. 최근 30일 실측(플랜 100건)에서 평균 88.7 이 나왔는데
//   실제 오류율은 촉박 73.5% / 중복 25.4% / 필드누락 22.8% / 경로실패 13.0% 였다.
//   옛 가중치로 역산하면 4×0.735 + 5×0.254 + 14×0.228 + 12×0.130 + 18×0.094 ≈ 10.6
//   → 89.3 으로, 관측 평균과 일치한다. 즉 **점수가 오류율을 가리고 있었다.**
//   원인은 감점 상한이 아니라 배분이다: 손님이 실제로 겪는 "촉박한 일정"이
//   73.5% 나 나는데 최대 4점밖에 안 깎였다.
//   → 손님 경험을 직접 망가뜨리는 항목(촉박·경로실패·중복)을 크게 올리고,
//     내부 품질 항목(주소 접두사·표기 언어)을 낮춘다. 식이제한은 안전 항목이라 유지.
export const METRIC_WEIGHTS = {
  dietary_violation:     28,  // SAFETY-CRITICAL (J) — 건강 위험, 최상위 유지
  tight_schedule:        16,  // 4 → 16. 일정이 빡빡하면 그날 전체가 무너진다
  route_failure:         14,  // 12 → 14. 이동을 못 하면 일정 자체가 성립 안 함
  unverified_restaurant: 12,  // 18 → 12
  field_completeness:    10,  // 14 → 10
  duplicate_stops:       10,  //  5 → 10. 같은 곳 두 번 = 손님이 바로 알아챈다
  bad_address_prefix:     4,  //  8 → 4 (내부 데이터 품질)
  language_mismatch:      3,  //  6 → 3 (내부 데이터 품질)
  loose_schedule:         3,
};

/**
 * 치명 오류 지표 — 하나라도 있으면 "무사고 플랜"이 아니다.
 * 평균 점수만 보면 오류율이 묻히므로, 운영 대시보드는 이 기준의 **무사고 비율**을
 * 핵심 지표로 함께 본다.
 */
export const CRITICAL_METRICS = [
  'dietary_violation',
  'tight_schedule',
  'route_failure',
  'duplicate_stops',
];

/**
 * 이 플랜에 치명 오류가 있는가? (하나라도 count > 0 이면 true)
 * @param {object} metrics computeQualityScore().metrics
 */
export function hasCriticalIssue(metrics) {
  if (!metrics) return false;
  return CRITICAL_METRICS.some((k) => ((metrics[k] && metrics[k].count) || 0) > 0);
}

// Sanity-check at load time. Throws on accidental edit drift.
const _weightSum = Object.values(METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
if (_weightSum !== 100) {
  console.warn(`[qualityMetrics] METRIC_WEIGHTS sum = ${_weightSum} (expected 100)`);
}

// City/region prefixes accepted for Korean addresses.
const CITY_PREFIX_RE = /^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/;

// 숙소 앵커 — buildPrompt.js 가 모든 day 의 첫/마지막 stop 으로 강제하는 stop.
// 손님이 호텔을 특정하지 않으면 "명동 지역 숙소" 같은 지역 placeholder 라
// 좌표가 없는 것이 정상이다.
function isLodging(stop) {
  return stop?.category === 'lodging';
}
function hasCoords(stop) {
  return !!(stop?.lat && stop?.lng);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function flattenStops(itinerary) {
  const days = itinerary?.days || [];
  return days.flatMap((d) => (d.stops || []).map((s) => ({ stop: s, day: d })));
}

function detectTipLang(stop) {
  const tip = stop.tip || stop.tip_en || '';
  if (!tip) return 'none';
  if (/^[A-Za-z0-9\s.,!?'\-:()]+$/.test(tip)) return 'en';
  if (/[가-힣]/.test(tip)) return 'ko';
  return 'mixed';
}

function stopLabel(stop) {
  return stop.name || stop.name_ko || stop.display_name || stop.name_en || '';
}

// food_index can be an array of { name, nameEn, ... } where `name` may carry
// pipe-separated multilingual variants. Extract the canonical Korean head.
function buildFoodLookup(foodIndex) {
  const set = new Set();
  if (!Array.isArray(foodIndex)) return set;
  for (const r of foodIndex) {
    if (!r) continue;
    const head = (r.name || '').split('|')[0].trim();
    if (head) set.add(head);
    if (r.nameEn) set.add(String(r.nameEn).trim());
  }
  return set;
}

// Map user dietary preferences to per-stop violation predicate. Mirrors the
// SAFETY-CRITICAL allowlist from CLAUDE.md J. Conservative: a stop counts as a
// violation only when we have positive evidence (category=food + dietary tag
// missing or directly conflicting).
function buildDietaryChecker(dietary) {
  if (!Array.isArray(dietary) || dietary.length === 0) {
    return () => false;
  }
  const wantsHalal  = dietary.some((d) => /halal/i.test(d));
  const wantsVegan  = dietary.some((d) => /vegan/i.test(d));
  const wantsVeggie = dietary.some((d) => /vegetarian/i.test(d));

  return function checkStop(stop) {
    if (stop.category !== 'food') return false;
    const tags = []
      .concat(stop.dietary_tags || [])
      .concat(stop.dietary || [])
      .concat(stop.tags || [])
      .map((t) => String(t).toLowerCase());
    const hayLow = `${stop.name || ''} ${stop.display_name || ''} ${stop.tip || ''} ${stop.reason || ''}`.toLowerCase();

    if (wantsHalal) {
      const claimsHalal = tags.some((t) => t.includes('halal')) || /halal|할랄/i.test(hayLow);
      const conflicts   = /pork|돼지|삼겹/i.test(hayLow);
      if (!claimsHalal || conflicts) return true;
    }
    if (wantsVegan) {
      const claimsVegan = tags.some((t) => t.includes('vegan')) || /vegan|비건/i.test(hayLow);
      const conflicts   = /beef|chicken|pork|fish|seafood|소고기|돼지|닭|생선|해산물/i.test(hayLow);
      if (!claimsVegan || conflicts) return true;
    }
    if (wantsVeggie && !wantsVegan) {
      const claimsVeg = tags.some((t) => t.includes('vegetarian') || t.includes('vegan'))
        || /vegetarian|vegan|채식|비건/i.test(hayLow);
      const conflicts = /beef|chicken|pork|소고기|돼지|닭/i.test(hayLow);
      if (!claimsVeg || conflicts) return true;
    }
    return false;
  };
}

// ── Indicator computations ─────────────────────────────────────────────────
function countUnverifiedRestaurants(stopsList, foodLookup) {
  let total = 0; let unverified = 0;
  for (const { stop } of stopsList) {
    if (stop.category !== 'food') continue;
    total++;
    if (foodLookup.size === 0) { unverified++; continue; }
    const head = stopLabel(stop);
    const en   = stop.display_name || stop.name_en || '';
    if (!foodLookup.has(head) && !foodLookup.has(en)) unverified++;
  }
  return { total, count: unverified };
}

function countLanguageMismatch(stopsList, lang) {
  let total = 0; let mismatch = 0;
  for (const { stop } of stopsList) {
    const detected = detectTipLang(stop);
    if (detected === 'none') continue;
    total++;
    if (lang === 'ko' && detected === 'en') mismatch++;
    else if (lang === 'en' && detected === 'ko') mismatch++;
  }
  return { total, count: mismatch };
}

function countBadAddressPrefix(stopsList) {
  let total = 0; let bad = 0;
  for (const { stop } of stopsList) {
    if (!stop.address) continue;
    total++;
    if (/^대한민국\s/.test(stop.address) || /\bKR\s/.test(stop.address)) { bad++; continue; }
    if (!CITY_PREFIX_RE.test(stop.address)) bad++;
  }
  return { total, count: bad };
}

// 숙소 앵커는 제외한다 — 모든 day 가 lodging 으로 시작·종료하도록 프롬프트가
// 강제하므로(buildPrompt.js:375, :390) 같은 숙소가 반복되는 건 설계된 구조다.
// 손님이 알아채는 진짜 중복은 관광지·식당이 다시 나오는 것.
function groupNonLodgingStopCounts(stopsList) {
  const counted = stopsList.filter(({ stop }) => !isLodging(stop));
  const seen = new Map();
  for (const { stop } of counted) {
    const key = stopLabel(stop);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return { counted, seen };
}

function countDuplicateStops(stopsList) {
  const { counted, seen } = groupNonLodgingStopCounts(stopsList);
  let dups = 0;
  for (const n of seen.values()) if (n > 1) dups += (n - 1);
  return { total: counted.length, count: dups };
}

/**
 * 종단(terminal) 중복 게이트용 — 중복된 stop 이름·건수 그대로 반환한다.
 * countDuplicateStops 와 같은 groupNonLodgingStopCounts 를 써서 점수 지표와
 * 종단 게이트가 절대 다른 결과를 내지 않는다(분류·식별 로직 단일 소스).
 * @param {object} itinerary
 * @returns {Array<{name: string, count: number}>}
 */
export function findDuplicateStops(itinerary) {
  const stopsList = flattenStops(itinerary);
  const { seen } = groupNonLodgingStopCounts(stopsList);
  const out = [];
  for (const [name, count] of seen) if (count > 1) out.push({ name, count });
  return out;
}

// 이 stop 으로 오는 이동에 걸린 시간(분). ODsay/TMAP 실측 우선, 없으면 Gemini 추정.
function transitMinutesTo(stop) {
  const odsayMin = stop?.travelFromPrev?.transitOptions?.publicTransit?.duration;
  if (odsayMin != null) return odsayMin;
  const geminiMin = stop?.transit_from_prev?.est_min;
  if (geminiMin != null) return geminiMin;
  return null;
}

// "HH:MM" → 자정 기준 분. 파싱 실패 시 null.
function parseHhmm(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function stopEndMinutes(stop) {
  const explicit = parseHhmm(stop.end_time);
  if (explicit != null) return explicit;
  const start = parseHhmm(stop.start_time || stop.time);
  if (start == null) return null;
  return start + (Number(stop.stay_min) || 0);
}

/**
 * tight = 여유(다음 시작 − 이전 종료 − 이동시간)가 SCHEDULE_BUFFER_MIN 미만.
 *         즉 손님이 그 시각에 실제로 도착할 수 없는 구간.
 * loose = 한 구간 이동이 90분 초과. 하루가 이동으로 날아간다.
 * 두 지표는 계산 가능한 구간이 달라 분모를 따로 센다.
 */
function countScheduleIssues(itinerary) {
  let slackTotal = 0; let tight = 0;
  let travelTotal = 0; let loose = 0;
  for (const day of (itinerary?.days || [])) {
    const stops = day.stops || [];
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const cur = stops[i];
      const transitMin = transitMinutesTo(cur);
      if (transitMin == null) continue;

      travelTotal++;
      if (transitMin > 90) loose++;

      const prevEnd = stopEndMinutes(prev);
      const curStart = parseHhmm(cur.start_time || cur.time);
      if (prevEnd == null || curStart == null) continue;
      const slack = curStart - prevEnd - transitMin;
      // 자정을 넘긴 day 는 curStart 가 되감겨 음수 폭이 커진다 — 오탐 방지.
      if (slack < -12 * 60) continue;
      slackTotal++;
      if (slack < SCHEDULE_BUFFER_MIN) tight++;
    }
  }
  return {
    tight: { total: slackTotal, count: tight },
    loose: { total: travelTotal, count: loose },
  };
}

/**
 * 출국일이 항공기 출발 마감을 넘는지 탐지 (2026-08-04, #1237 후속).
 *
 * 🔴 왜 필요한가 — #1237 은 **생성 쪽**을 막았지만 **보는 눈이 없었다.**
 *   운영 legacy plan `358e84c9` 는 10:00 ICN 출발인데 공항 도착이 09:31 이었고
 *   (손님이 비행기를 놓친다) 품질점수는 **79점**을 줬다. 지표 9개 중 어느 것도
 *   "출발 시각"을 안 본다 — 이 결함은 운영 Firestore 를 손으로 떠서야 발견됐다.
 *   컷이 다시 배선에서 빠지거나(이번처럼) 조용히 skip 되면 또 안 보인다.
 *
 * 점수에는 반영하지 않는다 — METRIC_WEIGHTS 합 100 을 건드리면 L3 하한(80)이
 * 흔들린다. 운영자 경고(quality_warnings)로만 낸다. 진짜 오류율이 쌓인 뒤
 * 가중치 편입 여부를 판단한다(7/28 가중치 사고와 같은 실수 방지).
 *
 * 기준: 마지막 day 의 모든 stop 은 `출발 − AIRPORT_ARRIVE_BEFORE_MIN` 이전에
 *   시작해야 한다. 공항 stop 자체가 정확히 그 시각이므로 "초과"만 잡는다.
 *   심야 출발(마감이 자정 이전으로 되감김)은 판정하지 않는다 — 오탐 방지.
 *
 * @param {object} itinerary
 * @param {string} departureTime "HH:mm" (미입력이면 판정 불가 = 빈 배열)
 * @returns {Array<{day: number, name: string, start_time: string, category: string}>}
 */
export function detectDepartureFlightOverrun(itinerary, departureTime) {
  const depMin = parseHhmm(departureTime);
  if (depMin == null) return [];
  const deadline = depMin - AIRPORT_ARRIVE_BEFORE_MIN;
  if (deadline < 0) return [];                     // 심야 출발 = 전날로 넘어간다. 판정 안 함.

  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const last = days[days.length - 1];
  const stops = Array.isArray(last?.stops) ? last.stops : [];
  const out = [];
  for (const s of stops) {
    const start = parseHhmm(s?.start_time || s?.time);
    if (start == null) continue;                   // 시각 미상 = 판정 불가
    if (start > deadline) {
      out.push({
        day: Number(last?.day) || days.length,
        name: String(s?.display_name || s?.name || '?'),
        start_time: String(s?.start_time || s?.time || ''),
        category: String(s?.category || ''),
      });
    }
  }
  return out;
}

function countRouteFailures(itinerary) {
  let total = 0; let failures = 0;
  // arrival_guide.route_to_hotel expected when arrival_airport set
  if (itinerary?.arrival_guide) {
    total++;
    if (!itinerary.arrival_guide.route_to_hotel) failures++;
  }
  for (const day of (itinerary?.days || [])) {
    const stops = day.stops || [];
    for (let i = 1; i < stops.length; i++) {
      const t = stops[i];
      // 좌표 없는 숙소(지역 placeholder)로는 경로를 낼 수 없다 — 분모에서도 뺀다.
      // 손님이 호텔을 특정해 좌표가 있으면 경로가 나와야 하므로 계속 센다.
      if (isLodging(t) && !hasCoords(t)) continue;
      total++;
      const has = t.transit_from_prev || t.travelFromPrev;
      if (!has) failures++;
    }
  }
  return { total, count: failures };
}

function countFieldIncomplete(stopsList) {
  let total = 0; let bad = 0;
  for (const { stop } of stopsList) {
    total++;
    const hasName    = !!(stop.name || stop.name_ko);
    const hasDisplay = !!(stop.display_name || stop.name_en);
    // 숙소는 좌표를 요구하지 않는다 — 손님이 호텔 미지정이면 지역 placeholder 다.
    const coordsOk   = isLodging(stop) ? true : hasCoords(stop);
    if (!hasName || !hasDisplay || !coordsOk) bad++;
  }
  return { total, count: bad };
}

function countDietaryViolations(stopsList, dietary) {
  const check = buildDietaryChecker(dietary);
  let total = 0; let bad = 0;
  for (const { stop } of stopsList) {
    if (stop.category !== 'food') continue;
    total++;
    if (check(stop)) bad++;
  }
  return { total, count: bad };
}

// ── Score formula ──────────────────────────────────────────────────────────
// rate(metric) = count / max(total, 1)  (clamped to [0,1])
// score = 100 - Σ_metric weight × rate(metric)
// Tight + loose share their weight buckets independently — together they sum
// at most to METRIC_WEIGHTS.tight_schedule + METRIC_WEIGHTS.loose_schedule.
export function computeWeightedScore(metrics) {
  const r = (count, total) => Math.min(1, count / Math.max(1, total));

  const penalty =
    METRIC_WEIGHTS.dietary_violation     * r(metrics.dietary_violation.count,     metrics.dietary_violation.total) +
    METRIC_WEIGHTS.unverified_restaurant * r(metrics.unverified_restaurant.count, metrics.unverified_restaurant.total) +
    METRIC_WEIGHTS.field_completeness    * r(metrics.field_completeness.count,    metrics.field_completeness.total) +
    METRIC_WEIGHTS.route_failure         * r(metrics.route_failure.count,         metrics.route_failure.total) +
    METRIC_WEIGHTS.bad_address_prefix    * r(metrics.bad_address_prefix.count,    metrics.bad_address_prefix.total) +
    METRIC_WEIGHTS.language_mismatch     * r(metrics.language_mismatch.count,     metrics.language_mismatch.total) +
    METRIC_WEIGHTS.duplicate_stops       * r(metrics.duplicate_stops.count,       metrics.duplicate_stops.total) +
    METRIC_WEIGHTS.tight_schedule        * r(metrics.tight_schedule.count,        metrics.tight_schedule.total) +
    METRIC_WEIGHTS.loose_schedule        * r(metrics.loose_schedule.count,        metrics.loose_schedule.total);

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * @param {object} itinerary  Plan itinerary (with .days[].stops[])
 * @param {string[]} dietary  User dietary prefs (Halal/Vegan/Vegetarian/...)
 * @param {string} _area      'seoul'|'busan'|'jeju'|... (reserved for future)
 * @param {object[]} foodIndex  api/_food_index.json (loaded array)
 * @param {object} opts       { lang: 'ko'|'en'|'ja'|'zh' }
 * @returns {{ metrics: object, score: number, computedAt: string }}
 */
export function computeQualityScore(itinerary, dietary, _area, foodIndex, opts = {}) {
  const lang = opts.lang || 'ko';
  const stopsList = flattenStops(itinerary);
  const foodLookup = buildFoodLookup(foodIndex);

  const sched = countScheduleIssues(itinerary);
  const metrics = {
    unverified_restaurant: countUnverifiedRestaurants(stopsList, foodLookup),
    language_mismatch:     countLanguageMismatch(stopsList, lang),
    bad_address_prefix:    countBadAddressPrefix(stopsList),
    duplicate_stops:       countDuplicateStops(stopsList),
    tight_schedule:        sched.tight,
    loose_schedule:        sched.loose,
    route_failure:         countRouteFailures(itinerary),
    field_completeness:    countFieldIncomplete(stopsList),
    dietary_violation:     countDietaryViolations(stopsList, dietary),
  };

  const score = computeWeightedScore(metrics);
  return { metrics, score, computedAt: new Date().toISOString() };
}
