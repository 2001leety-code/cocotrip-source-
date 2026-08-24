/**
 * Deterministic "don't show me this again" filter for revisions
 * (2026-08-24, planner-intent-v1 §4).
 *
 * Until now the avoid list was PROMPT-ONLY: buildRevisionInstruction told
 * Gemini not to reuse those stops and nothing checked whether it listened.
 * Gemini is non-deterministic, so a traveller who paid a revision credit
 * specifically to get rid of a place could get it straight back.
 *
 * So we also filter, after the last mutation and before persistence:
 *   - hotels / airports / transit stops are NEVER removed — they are the day's
 *     bookend markers and the itinerary's structure depends on them,
 *   - matching is case/Unicode-safe (avoidKey: NFKC + case-fold + strip
 *     separators/punctuation) and matches on any of the stop's name fields,
 *     both directions of containment, because Gemini re-emits the same place
 *     as "광장시장", "광장 시장" and "광장시장 (Gwangjang Market)" across runs,
 *   - if removing avoided stops leaves a day that HAD activities with none, we
 *     fail closed (422) instead of shipping a hollow day and calling it done.
 */
import { avoidKey } from '../_shared/plannerIntentV1.js';

/** Location/transit-only stops — the day's structural markers, never filtered. */
const PROTECTED_CATEGORIES = new Set(['lodging', 'airport', 'travel']);

export const AVOID_UNSATISFIABLE_CODE = 'REVISION_AVOID_UNSATISFIABLE';

// .claude/rules/planner-schema.md — new-schema-first, old-schema fallback for
// stored plans (bracket-accessed field list, not a literal dot-chain per
// field) so this stays the ONE place the legacy fallback is spelled out.
const LEGACY_NAME_FIELDS = ['display_name', 'name_en', 'name', 'name_ko'];

function stopNameKeys(stop) {
  if (!stop || typeof stop !== 'object') return [];
  return LEGACY_NAME_FIELDS.map((f) => avoidKey(stop[f])).filter(Boolean);
}

/**
 * True when this stop is one the traveller asked not to see again.
 *
 * Exact normalized-key equality only (2026-08-24 refactor) — a substring test
 * (`k.includes(a) || a.includes(k)`) let "경복궁" avoid "경복궁 근처 카페" and
 * vice versa, which can silently strip an unrelated stop that merely shares a
 * short common substring (e.g. avoiding "명동" would also strip "명동교자").
 * `avoidKey` (NFKC + case-fold + strip separators/punctuation) still absorbs
 * pure separator/spacing variance ("광장시장" vs "광장 시장"), but a Gemini
 * re-emission with an appended translation ("광장시장 (Gwangjang Market)") no
 * longer matches — accepted tradeoff, see tests/unit/planner-avoid-and-bookend.test.ts.
 */
export function isAvoidedStop(stop, avoidKeys) {
  if (!avoidKeys || avoidKeys.length === 0) return false;
  if (PROTECTED_CATEGORIES.has(stop && stop.category)) return false;
  const keys = stopNameKeys(stop);
  if (keys.length === 0) return false;
  return keys.some((k) => avoidKeys.includes(k));
}

/**
 * Removes avoided stops from every day, in place, and reindexes `order` on the
 * survivors so a later route-enrichment pass computes adjacency (and any
 * transit-from-prev distance) against the stops that actually remain, not the
 * pre-removal gaps.
 *
 * @param {object} itinerary
 * @param {string[]} avoidStopNames — normalized (normalizeAvoidStopNames)
 * @returns {{removed: number, invalidDays: Array<{day:number, message:string}>}}
 */
export function filterAvoidedStops(itinerary, avoidStopNames) {
  const result = { removed: 0, invalidDays: [] };
  const names = Array.isArray(avoidStopNames) ? avoidStopNames : [];
  if (names.length === 0) return result;
  const avoidKeys = names.map((n) => avoidKey(n)).filter(Boolean);
  if (avoidKeys.length === 0) return result;

  const days = Array.isArray(itinerary && itinerary.days) ? itinerary.days : [];
  days.forEach((day, idx) => {
    const stops = Array.isArray(day && day.stops) ? day.stops : [];
    if (stops.length === 0) return;
    const activityBefore = stops.filter((s) => !PROTECTED_CATEGORIES.has(s && s.category)).length;
    const kept = stops.filter((s) => !isAvoidedStop(s, avoidKeys));
    const removed = stops.length - kept.length;
    if (removed === 0) return;
    result.removed += removed;
    // Reindex order — the removed stop(s) leave a gap (1,2,4,5,...) that would
    // otherwise mislead any downstream code that trusts `order` as a dense
    // 1..n sequence (route enrichment's adjacency, PDF/UI ordering).
    kept.forEach((s, i) => { if (s && typeof s.order === 'number') s.order = i + 1; });
    day.stops = kept;
    const activityAfter = kept.filter((s) => !PROTECTED_CATEGORIES.has(s && s.category)).length;
    if (activityBefore > 0 && activityAfter === 0) {
      const dayNum = Number(day && day.day) || (idx + 1);
      result.invalidDays.push({
        day: dayNum,
        message: `Day ${dayNum}: every activity stop was on the traveller's avoid list (${activityBefore} removed)`,
      });
    }
  });
  return result;
}

function unsatisfiableError(invalidDays, stage) {
  // 2026-08-24: paymentGate.js decrements revisionCredits BEFORE this runs (the
  // gate is the FIRST step in handlerCore, removal now runs right after the
  // itinerary exists — before persistence) — by the time this throws, the
  // credit is already spent. The message must not claim otherwise; do not add
  // a credit-state assertion here without also fixing the actual spend/refund
  // order (money boundary — out of scope for this filter).
  const e = new Error(
    'We could not rebuild your itinerary without the places you asked us to avoid. '
    + 'Please try again with fewer exclusions or contact support.',
  );
  e.code = AVOID_UNSATISFIABLE_CODE;
  e.statusCode = 422;
  e.stage = stage;
  e.details = invalidDays.slice(0, 5).map((d) => d.message);
  return e;
}

/**
 * Actually removes avoided stops and throws when a day is left structurally
 * invalid. Called ONCE, right after the itinerary exists (block-mode expand or
 * the Gemini pipeline) and BEFORE route enrichment — removal has to happen
 * before route enrichment computes transit-from-prev/adjacency, or the
 * enrichment work (and the API calls behind it) is wasted on stops that are
 * about to be deleted, and the surviving stops' adjacency would still reflect
 * the pre-removal layout.
 *
 * @throws {Error & {code: string, statusCode: 422}}
 */
export function removeAvoidedStopsOrThrow(itinerary, avoidStopNames, stage = 'unknown') {
  const result = filterAvoidedStops(itinerary, avoidStopNames);
  if (result.removed > 0) {
    console.log(`[avoidStops] ${stage}: removed ${result.removed} avoided stop(s)`);
  }
  if (result.invalidDays.length > 0) {
    console.error(`[avoidStops] ${stage} FAILED:`, JSON.stringify(result.invalidDays.slice(0, 5)));
    throw unsatisfiableError(result.invalidDays, stage);
  }
  return result;
}

// Back-compat name — some call sites/tests predate the removal/assert split.
export const assertAvoidListApplied = removeAvoidedStopsOrThrow;

/**
 * Final-stage safety net: after route enrichment and every other mutation has
 * run, confirm no avoided stop is present — WITHOUT removing anything. By this
 * point transit/adjacency fields exist on the surviving stops; mutating here
 * would leave stale `transit_from_prev` on whatever stop ends up adjacent to
 * the gap, so this stage only asserts. A hit here means the earlier removal
 * (removeAvoidedStopsOrThrow) did not run for this itinerary — a wiring bug,
 * not a recoverable state — so it fails the same way (422).
 *
 * @throws {Error & {code: string, statusCode: 422}}
 */
export function assertNoAvoidedStopsRemain(itinerary, avoidStopNames, stage = 'unknown') {
  const names = Array.isArray(avoidStopNames) ? avoidStopNames : [];
  if (names.length === 0) return { leaked: 0 };
  const avoidKeys = names.map((n) => avoidKey(n)).filter(Boolean);
  if (avoidKeys.length === 0) return { leaked: 0 };

  const invalidDays = [];
  let leaked = 0;
  const days = Array.isArray(itinerary && itinerary.days) ? itinerary.days : [];
  days.forEach((day, idx) => {
    const stops = Array.isArray(day && day.stops) ? day.stops : [];
    const hit = stops.filter((s) => isAvoidedStop(s, avoidKeys));
    if (hit.length === 0) return;
    leaked += hit.length;
    const dayNum = Number(day && day.day) || (idx + 1);
    invalidDays.push({
      day: dayNum,
      message: `Day ${dayNum}: ${hit.length} avoided stop(s) survived to the final gate (removal step did not run)`,
    });
  });
  if (leaked > 0) {
    console.error(`[avoidStops] ${stage} LEAK:`, JSON.stringify(invalidDays.slice(0, 5)));
    throw unsatisfiableError(invalidDays, stage);
  }
  return { leaked: 0 };
}

/**
 * Filters recommended-restaurant buckets ({ general: [...], vegan?: [...], ... })
 * against the avoid list. These entries come straight from the food DB
 * (recommendedRestaurants.js), never from the Gemini/block-mode itinerary, so
 * they cannot be caught by the stops-based removal above — an avoided
 * restaurant could otherwise resurface here even after a clean day-stop removal.
 *
 * @param {Record<string, Array<object>>} buckets
 * @param {string[]} avoidStopNames
 * @returns {Record<string, Array<object>>} same shape, filtered (new object; no mutation)
 */
export function filterAvoidedRestaurantBuckets(buckets, avoidStopNames) {
  const names = Array.isArray(avoidStopNames) ? avoidStopNames : [];
  if (!buckets || typeof buckets !== 'object') return buckets;
  if (names.length === 0) return buckets;
  const avoidKeys = names.map((n) => avoidKey(n)).filter(Boolean);
  if (avoidKeys.length === 0) return buckets;

  const out = {};
  for (const [bucket, list] of Object.entries(buckets)) {
    out[bucket] = Array.isArray(list) ? list.filter((r) => !isAvoidedStop(r, avoidKeys)) : list;
  }
  return out;
}
