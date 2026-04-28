/**
 * pickRecommendedRestaurants — derive a "must-visit" list from the food index
 * to attach to the generated plan as `itinerary.recommended_restaurants`.
 *
 * Why a discrete module:
 *   - keeps ai-planner-full.js handler under the P1 lock
 *   - small enough to unit-test independently when we add coverage
 *
 * Selection rules (per user spec 2026-04-28):
 *   - 10 entries
 *   - tag === 'general' only — halal-only / vegan-only are niche audiences,
 *     skipped to keep the list broadly useful
 *   - Same `city` as the plan's mainCity (seoul / busan / jeju / etc.)
 *   - Excluded if name matches any stop already in the plan (avoid duplicates)
 *   - Within 5km of any plan stop (so the user can detour easily)
 *   - Sorted by rating × log10(reviewCount + 10) — higher both = better, but
 *     log on reviewCount tames the long tail (a 5,000-review place doesn't
 *     dominate a 200-review place 25× over).
 *   - User's diet/cuisine preference NOT applied — this is a "discover more"
 *     widget that broadens beyond what the AI already picked.
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

/**
 * @param {Array} foodIndex   loaded _food_index.json
 * @param {object} itinerary  the plan being persisted (has days[].stops[])
 * @param {string} area       body.area — mapped to a `city` key in the index
 * @returns {Array} up to TARGET_COUNT entries with KEEP_FIELDS + nearestStopKm
 */
export function pickRecommendedRestaurants(foodIndex, itinerary, area) {
  if (!Array.isArray(foodIndex) || foodIndex.length === 0) return [];
  const cityKey = AREA_TO_CITY[area] || area;

  // Collect plan stop coords + names (for distance + dedupe).
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

  const candidates = [];
  for (const entry of foodIndex) {
    if (entry.city !== cityKey) continue;
    if (entry.tag !== 'general') continue; // skip vegan-only / halal-only
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
