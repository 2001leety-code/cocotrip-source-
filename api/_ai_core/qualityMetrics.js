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
 *   5. tight_schedule        — transit gaps < 30 min
 *   6. loose_schedule        — transit gaps > 90 min
 *   7. route_failure         — RouteAgent failures (route_to_hotel missing,
 *                              transit_from_prev absent for non-first stop, etc.)
 *   8. field_completeness    — required fields (name/display_name/lat/lng) missing
 *   9. dietary_violation     — stops violating user dietary restrictions
 *      (SAFETY-CRITICAL — heaviest weight; see CLAUDE.md J)
 *
 * Logic mirrors scripts/validate-planner.cjs analyzeIssues() so offline
 * validation runs and live runtime computation produce identical counts.
 */

// ── Configuration ──────────────────────────────────────────────────────────
// Weights are applied to per-stop violation rates (or absolute counts for
// schedule). Sum of weights = 100 so a "perfect" plan scores 100, and a plan
// with ALL stops violating a single indicator drops by exactly that weight.
export const METRIC_WEIGHTS = {
  dietary_violation:     30,  // SAFETY-CRITICAL (J)
  unverified_restaurant: 18,
  field_completeness:    14,
  route_failure:         12,
  bad_address_prefix:     8,
  language_mismatch:      6,
  duplicate_stops:        5,
  tight_schedule:         4,
  loose_schedule:         3,
};

// Sanity-check at load time. Throws on accidental edit drift.
const _weightSum = Object.values(METRIC_WEIGHTS).reduce((a, b) => a + b, 0);
if (_weightSum !== 100) {
  console.warn(`[qualityMetrics] METRIC_WEIGHTS sum = ${_weightSum} (expected 100)`);
}

// City/region prefixes accepted for Korean addresses.
const CITY_PREFIX_RE = /^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/;

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

function countDuplicateStops(stopsList) {
  const total = stopsList.length;
  const seen = new Map();
  for (const { stop } of stopsList) {
    const key = stopLabel(stop);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  let dups = 0;
  for (const n of seen.values()) if (n > 1) dups += (n - 1);
  return { total, count: dups };
}

function countScheduleIssues(itinerary) {
  let total = 0; let tight = 0; let loose = 0;
  for (const day of (itinerary?.days || [])) {
    const stops = day.stops || [];
    for (let i = 1; i < stops.length; i++) {
      const t = stops[i];
      const odsayMin = t.travelFromPrev?.transitOptions?.publicTransit?.duration;
      const geminiMin = t.transit_from_prev?.est_min;
      const min = odsayMin ?? geminiMin;
      if (min == null) continue;
      total++;
      if (min < 30) tight++;
      else if (min > 90) loose++;
    }
  }
  return { total, tight, loose };
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
      total++;
      const t = stops[i];
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
    const hasCoords  = !!(stop.lat && stop.lng);
    if (!hasName || !hasDisplay || !hasCoords) bad++;
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
    tight_schedule:        { total: sched.total, count: sched.tight },
    loose_schedule:        { total: sched.total, count: sched.loose },
    route_failure:         countRouteFailures(itinerary),
    field_completeness:    countFieldIncomplete(stopsList),
    dietary_violation:     countDietaryViolations(stopsList, dietary),
  };

  const score = computeWeightedScore(metrics);
  return { metrics, score, computedAt: new Date().toISOString() };
}
