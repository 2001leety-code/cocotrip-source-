/**
 * pickRecommendedRestaurants — derive a "must-visit" list from the food index
 * to attach to the generated plan as `itinerary.recommended_restaurants`.
 *
 * Why a discrete module:
 *   - keeps ai-planner-full.js handler under the P1 lock
 *   - small enough to unit-test independently when we add coverage
 *
 * Selection rules (regression fix 2026-05-05 — per-style buckets):
 *   - Always 10 `general` entries (city + 5km + plan-deduped + rating sort)
 *   - When user selects dietary (vegan/halal), add a separate 10-entry bucket
 *     per dietary so each tag is surfaced independently (vegan stays vegan,
 *     halal stays halal — never collapsed into a single mixed list).
 *   - Each bucket: same city, same 5km, same rating sort, same dedupe.
 *   - Output shape:
 *       pickRecommendedRestaurants — Array<RecRestaurant>  (legacy, general only)
 *       pickRecommendedRestaurantsByStyle — { general: [...], vegan?: [...], halal?: [...] }
 *   - SAFETY-CRITICAL (CLAUDE.md J): we DO NOT mix tags. vegan bucket only ever
 *     contains entries with `tag === 'vegan'`. No fallback to general inside
 *     a dietary bucket — empty vegan = empty bucket (UI hides).
 */

const KEEP_FIELDS = [
  'name', 'nameEn', 'address',
  'lat', 'lng',
  'rating', 'reviewCount',
  'cuisine', 'cuisineKo',
  'priceLabel', 'priceLabelKo',
  'placeId', 'googleMapsUrl',
  'dong', 'dongEn', 'district',
];

const EARTH_R_KM = 6371;
const MAX_DIST_KM = 5;
const TARGET_COUNT = 10;
const AREA_TO_CITY = {
  seoul_city: 'seoul',
  seoul: 'seoul',
  busan: 'busan',
  jeju: 'jeju',
  jeonju: 'jeonju',
  gyeongju: 'gyeongju',
};

function toRad(d) { return (d * Math.PI) / 180; }

function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
}

function score(entry) {
  const r = entry.rating || 0;
  const n = entry.reviewCount || 0;
  return r * Math.log10(n + 10);
}

function pickFields(entry) {
  const out = {};
  for (const k of KEEP_FIELDS) {
    if (entry[k] !== undefined) out[k] = entry[k];
  }
  return out;
}

// Map UI dietPref tokens (WizardForm: 'Vegan', 'Halal') to food_index `tag` values.
// SAFETY-CRITICAL (CLAUDE.md J): allowlist only — anything not listed is ignored
// (rather than silently bucketed as general). Add new tokens explicitly when DB
// gains new tags.
const DIET_PREF_TO_TAG = {
  Vegan: 'vegan',
  vegan: 'vegan',
  Halal: 'halal',
  halal: 'halal',
};

function dietPrefsToTags(dietPrefs) {
  if (!Array.isArray(dietPrefs)) return [];
  const out = [];
  const seen = new Set();
  for (const p of dietPrefs) {
    const tag = DIET_PREF_TO_TAG[p];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Internal bucket builder — given a fixed `tag`, return up to TARGET_COUNT
 * entries (city + 5km + plan-dedupe + rating sort).
 */
function pickBucket(foodIndex, cityKey, tag, planNames, planCoords) {
  const candidates = [];
  for (const entry of foodIndex) {
    if (entry.city !== cityKey) continue;
    if (entry.tag !== tag) continue;
    if (!entry.lat || !entry.lng) continue;
    if (planNames.has(entry.name) || planNames.has(entry.nameEn)) continue;

    let nearest = Infinity;
    for (const c of planCoords) {
      const d = distanceKm(entry.lat, entry.lng, c.lat, c.lng);
      if (d < nearest) nearest = d;
    }
    if (nearest > MAX_DIST_KM) continue;

    candidates.push({ entry, nearest, score: score(entry) });
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, TARGET_COUNT).map(({ entry, nearest }) => ({
    ...pickFields(entry),
    nearestStopKm: Math.round(nearest * 10) / 10,
  }));
}

/**
 * Legacy single-list picker — kept for backward compat (callers that don't
 * pass dietary). Returns the `general` bucket only.
 *
 * @param {Array} foodIndex   loaded _food_index.json
 * @param {object} itinerary  the plan being persisted (has days[].stops[])
 * @param {string} area       body.area — mapped to a `city` key in the index
 * @returns {Array} up to TARGET_COUNT entries with KEEP_FIELDS + nearestStopKm
 */
export function pickRecommendedRestaurants(foodIndex, itinerary, area) {
  if (!Array.isArray(foodIndex) || foodIndex.length === 0) return [];
  const cityKey = AREA_TO_CITY[area] || area;

  const planNames = new Set();
  const planCoords = [];
  for (const day of itinerary?.days || []) {
    for (const stop of day.stops || []) {
      if (stop.name) planNames.add(stop.name);
      if (stop.nameEn) planNames.add(stop.nameEn);
      if (stop.lat && stop.lng) planCoords.push({ lat: stop.lat, lng: stop.lng });
    }
  }
  if (planCoords.length === 0) return [];

  return pickBucket(foodIndex, cityKey, 'general', planNames, planCoords);
}

/**
 * Per-style picker — returns a map keyed by tag. `general` is always present
 * (may be empty array). Each dietPref the user selected adds a matching bucket
 * (vegan/halal) — never mixed with general.
 *
 * @param {Array}  foodIndex
 * @param {object} itinerary
 * @param {string} area
 * @param {string[]} dietPrefs  e.g. ['Vegan'], ['Halal','Vegan'], or []
 * @returns {{ general: Array, vegan?: Array, halal?: Array }}
 */
export function pickRecommendedRestaurantsByStyle(foodIndex, itinerary, area, dietPrefs) {
  if (!Array.isArray(foodIndex) || foodIndex.length === 0) {
    return { general: [] };
  }
  const cityKey = AREA_TO_CITY[area] || area;

  const planNames = new Set();
  const planCoords = [];
  for (const day of itinerary?.days || []) {
    for (const stop of day.stops || []) {
      if (stop.name) planNames.add(stop.name);
      if (stop.nameEn) planNames.add(stop.nameEn);
      if (stop.lat && stop.lng) planCoords.push({ lat: stop.lat, lng: stop.lng });
    }
  }
  if (planCoords.length === 0) {
    return { general: [] };
  }

  const result = {
    general: pickBucket(foodIndex, cityKey, 'general', planNames, planCoords),
  };

  for (const tag of dietPrefsToTags(dietPrefs)) {
    result[tag] = pickBucket(foodIndex, cityKey, tag, planNames, planCoords);
  }

  return result;
}
