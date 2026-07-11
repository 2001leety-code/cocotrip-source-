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
 *
 * 2026-05-11 (B-3 fix): multi-city distribution.
 *   - 5/10 prod 검증 결과 — 서울+부산 plan 의 추천 식당이 서울만 (부산 0건).
 *   - regions 파라미터 받아 도시 N개에 균등 분배 + 각 식당에 region 태그 부착.
 *   - regions.length===1 → 기존 동작 100% 유지 (regression 0).
 *   - regions.length===2 → 5+5, regions.length===3 → 4+3+3, 등등.
 *   - 각 도시 별 plan stops 좌표만으로 5km filter (서울 식당 ↔ 부산 stop 매칭 X).
 */
import { isDietaryTrusted } from '../_shared/dietary-trust.js';

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

/**
 * Map a user-facing region string (e.g. 'Seoul', '서울', 'busan', 'seoul_city')
 * to the food_index `city` key. Mirrors PlannerPage cityNameToAreaKey + AREA_TO_CITY
 * pipeline so multi-city `regions` array can be reduced uniformly here.
 *
 * SAFETY-CRITICAL note: unmapped regions return null (NOT a default like 'seoul') —
 * silent fallback would mean a foreign region pulls Seoul restaurants. Caller drops.
 */
function regionToCityKey(region) {
  if (typeof region !== 'string') return null;
  const norm = region.toLowerCase().trim();
  if (!norm) return null;
  // 1) area-key direct match
  if (AREA_TO_CITY[norm]) return AREA_TO_CITY[norm];
  // 2) english name / Korean / Japanese / Chinese
  const ALIASES = {
    seoul:     ['seoul', '서울', 'ソウル', '首尔'],
    busan:     ['busan', '부산', '釜山'],
    jeju:      ['jeju', '제주', '済州', '济州'],
    gyeongju:  ['gyeongju', '경주', '慶州', '庆州'],
    jeonju:    ['jeonju', '전주', '全州'],
  };
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => norm.includes(a.toLowerCase()))) return key;
  }
  return null;
}

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
 * Internal bucket builder — given a fixed `tag`, return up to `limit` entries
 * (city + 5km + plan-dedupe + rating sort). Accepts optional region tag to
 * attach to each output entry for multi-city UI rendering.
 *
 * 2026-05-11 (B-3): added `limit` + `regionTag` params. limit defaults to
 * TARGET_COUNT for backward compat — multi-city callers pass smaller value.
 */
function pickBucket(foodIndex, cityKey, tag, planNames, planCoords, limit = TARGET_COUNT, regionTag = '') {
  const candidates = [];
  for (const entry of foodIndex) {
    if (entry.city !== cityKey) continue;
    if (entry.tag !== tag) continue;
    // 2026-07-11 SAFETY (3단계-B): unverified dietary 태그(naver 키워드·AI-curated)는
    // 추천 버킷 진입 금지 — 생선회집 vegan 실증. general 은 항상 통과(무해).
    if (!isDietaryTrusted(entry)) continue;
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

  return candidates.slice(0, limit).map(({ entry, nearest }) => {
    const out = {
      ...pickFields(entry),
      nearestStopKm: Math.round(nearest * 10) / 10,
    };
    // 2026-05-11 (B-3): region tag — UI groups picks by city in multi-city plans.
    // 단도시 plan 은 regionTag='' 로 호출 → 필드 자체가 안 붙음 (legacy 동일).
    if (regionTag) out.region = regionTag;
    return out;
  });
}

/**
 * Multi-city distribution helper.
 * - 1 city: 10 (TARGET_COUNT)
 * - 2 cities: 5+5
 * - 3 cities: 4+3+3
 * - 4+ cities: ceil/floor mix summing to TARGET_COUNT
 *
 * 2026-05-11 (B-3): even split keeps page weight uniform regardless of trip shape.
 * 사용자가 서울 위주 plan 짜도 부산 5건은 보장됨 (요청한 도시이므로).
 */
function splitTargetByRegion(regionCount) {
  if (regionCount <= 1) return [TARGET_COUNT];
  const base = Math.floor(TARGET_COUNT / regionCount);
  const remainder = TARGET_COUNT % regionCount;
  // first `remainder` regions get +1 (대도시 우선 = 첫 region 이 entry city 라 가정)
  return Array.from({ length: regionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Build per-region plan coords + names. Each region only "sees" stops whose
 * `day.city` matches OR (if no day.city) all stops fall under regions[0].
 *
 * 2026-05-11 (B-3): backend MUST not match 서울 식당 ↔ 부산 stop coords
 * (5km filter는 도시별 좌표 군집 안에서만). day.city 미존재 시 fallback —
 * 첫 region 이 모든 stop 흡수 (단도시 plan 시나리오 + Gemini 가 city 필드 누락한 케이스).
 */
function buildPlanCoordsByRegion(itinerary, regionKeys) {
  const result = {};
  for (const r of regionKeys) result[r] = { names: new Set(), coords: [] };

  const days = itinerary?.days || [];
  // city → regionKey lookup (lowercased loose match)
  const cityToRegion = new Map();
  for (const r of regionKeys) cityToRegion.set(r.toLowerCase(), r);

  let unassignedNames = new Set();
  let unassignedCoords = [];

  for (const day of days) {
    const dayCityRaw = typeof day?.city === 'string' ? day.city.trim() : '';
    const matchedRegion = dayCityRaw ? (
      regionToCityKey(dayCityRaw) && regionKeys.includes(regionToCityKey(dayCityRaw))
        ? regionToCityKey(dayCityRaw)
        : null
    ) : null;
    const bucket = matchedRegion ? result[matchedRegion] : null;
    for (const stop of (day.stops || [])) {
      if (stop.name) (bucket ? bucket.names : unassignedNames).add(stop.name);
      if (stop.nameEn) (bucket ? bucket.names : unassignedNames).add(stop.nameEn);
      if (stop.lat && stop.lng) {
        (bucket ? bucket.coords : unassignedCoords).push({ lat: stop.lat, lng: stop.lng });
      }
    }
  }

  // Fallback: 모든 stop 의 day.city 누락 → 첫 region 으로 흡수 (단도시 plan 또는
  // Gemini 가 city 필드 안 넣은 케이스). 단도시 시 regionKeys.length===1 라 안전.
  if (unassignedCoords.length > 0 && regionKeys.length > 0) {
    const first = regionKeys[0];
    for (const n of unassignedNames) result[first].names.add(n);
    result[first].coords.push(...unassignedCoords);
  }

  return result;
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
 * 2026-05-11 (B-3 fix): 5번째 인자 regions 추가. 다도시 plan 시 city 별 분배.
 *   - regions undefined / length<=1 → 기존 단도시 동작 (regression 0).
 *   - regions.length===2 → 5+5, regions.length===3 → 4+3+3 (TARGET_COUNT 합).
 *   - 각 식당에 `region: 'seoul'|'busan'` 태그 부착 (UI 도시 별 섹션 분리용).
 *
 * @param {Array}    foodIndex
 * @param {object}   itinerary
 * @param {string}   area
 * @param {string[]} dietPrefs  e.g. ['Vegan'], ['Halal','Vegan'], or []
 * @param {string[]} [regions]  optional — multi-city plans pass city names/keys.
 * @returns {{ general: Array, vegan?: Array, halal?: Array }}
 */
export function pickRecommendedRestaurantsByStyle(foodIndex, itinerary, area, dietPrefs, regions) {
  if (!Array.isArray(foodIndex) || foodIndex.length === 0) {
    return { general: [] };
  }

  // 2026-05-11 (B-3): regions → city key 배열. 단도시 fallback = [area].
  const regionKeys = (() => {
    if (Array.isArray(regions) && regions.length > 0) {
      const mapped = regions.map(regionToCityKey).filter(Boolean);
      // dedupe while preserving order (첫 도시 = entry city 우선)
      const seen = new Set();
      const out = [];
      for (const k of mapped) {
        if (!seen.has(k)) { seen.add(k); out.push(k); }
      }
      if (out.length > 0) return out;
    }
    // fallback: legacy single-city via area
    const fallback = AREA_TO_CITY[area] || area;
    return [fallback];
  })();

  const isMultiCity = regionKeys.length > 1;
  const counts = splitTargetByRegion(regionKeys.length);

  // 단도시 — legacy 경로 그대로 (region 태그 없음, plan 전체 stops 좌표 기반)
  if (!isMultiCity) {
    const cityKey = regionKeys[0];
    const planNames = new Set();
    const planCoords = [];
    for (const day of itinerary?.days || []) {
      for (const stop of day.stops || []) {
        if (stop.name) planNames.add(stop.name);
        if (stop.nameEn) planNames.add(stop.nameEn);
        if (stop.lat && stop.lng) planCoords.push({ lat: stop.lat, lng: stop.lng });
      }
    }
    if (planCoords.length === 0) return { general: [] };

    const result = {
      general: pickBucket(foodIndex, cityKey, 'general', planNames, planCoords, counts[0], ''),
    };
    for (const tag of dietPrefsToTags(dietPrefs)) {
      result[tag] = pickBucket(foodIndex, cityKey, tag, planNames, planCoords, counts[0], '');
    }
    return result;
  }

  // 다도시 — 도시별 plan stops 좌표 분리 → 각 도시 quota 별로 pick → merge.
  const byRegion = buildPlanCoordsByRegion(itinerary, regionKeys);
  // region 별 plan coords 합쳐 score 후 quota slice 가 아니라 region 별로 pickBucket 호출.
  // 이렇게 하면 5km filter 가 도시 좌표 군집 안에서만 동작 (서울 식당이 부산 stop 5km
  // 안에 못 들어옴 — 실제로는 100km+ 떨어져 있음).
  const result = { general: [] };
  const dietTags = dietPrefsToTags(dietPrefs);
  for (const tag of dietTags) result[tag] = [];

  for (let i = 0; i < regionKeys.length; i++) {
    const cityKey = regionKeys[i];
    const limit = counts[i];
    const { names, coords } = byRegion[cityKey];
    if (coords.length === 0) continue; // 그 도시 stop 없음 — 빈 quota skip.
    result.general.push(
      ...pickBucket(foodIndex, cityKey, 'general', names, coords, limit, cityKey),
    );
    for (const tag of dietTags) {
      result[tag].push(
        ...pickBucket(foodIndex, cityKey, tag, names, coords, limit, cityKey),
      );
    }
  }

  return result;
}
