/**
 * PlannerIntent v1 — the ONE normalized shape every paid-planner path reads.
 *
 * 2026-08-24 (planner-intent-v1). Before this module the wizard's answers
 * reached the backend as ~40 loose top-level body keys, and each consumer
 * re-read the raw body its own way:
 *   - requestShaper dropped `reservation_status` entirely (buildPrompt branches
 *     on it → the branch always saw undefined),
 *   - blockMode's userInput never received arrival/departure city, hotels,
 *     zones, pace, spice, bucket dishes, meal budget, luggage, companions,
 *     special request or the revision reason/avoid list,
 *   - planPersister rebuilt `input.*` from the RAW body (so a legacy
 *     `allergies` payload migrated by requestShaper was persisted unmigrated,
 *     and a snake_case `arrival_time` was persisted as null),
 *   - the Inngest worker got `ctx.body` and repeated all of the above.
 *
 * So: normalize ONCE here, hand the result to everybody. The contract is
 * ADDITIVE — a client may send `planner_intent_v1` (preferred) and/or the old
 * flat fields; flat fields are translated into v1 so already-accepted requests
 * keep working byte-for-byte from the traveller's point of view.
 *
 * Fail-closed: a malformed type or an out-of-enum value throws BEFORE Gemini is
 * called rather than being coerced into something plausible. `String(['a'])`
 * === 'a' and `Number([5])` === 5, so type checks run BEFORE any coercion —
 * an array must never sneak through as a scalar.
 *
 * SAFETY (.claude/rules/dietary-safety.md): dietary values are Halal/Vegan/
 * Vegetarian only. The retired medical-allergen concept is accepted ONLY as the
 * legacy `allergies` inbound alias for migration, and only those three values
 * survive — allergen values are dropped and never re-emitted or persisted.
 * A dietary key that is present but not an array is an explicit error, never a
 * silent empty array ("누락 ≠ 없음").
 *
 * api/ and src/ never cross-import (.claude/rules → cocotrip-api-src-no-cross-import),
 * so the browser-side builder lives in src/pages/PlannerPage/lib/plannerIntent.ts
 * and `tests/unit/planner-intent-v1-parity.test.ts` keeps the pair honest.
 */

export const PLANNER_INTENT_VERSION = 1;
export const PLANNER_INTENT_KEY = 'planner_intent_v1';

export const RESERVATION_STATUSES = ['nothing', 'flight', 'flight_hotel', 'all_done'];
/** Canonical dietary restrictions. Medical allergens are NOT part of this set. */
export const DIETARY_RESTRICTION_VALUES = ['Halal', 'Vegan', 'Vegetarian'];
export const PRICE_RANGES = ['Budget', 'Moderate', 'Premium', 'Any'];
export const SPICE_LEVELS = ['none', 'mild', 'medium', 'hot'];
export const TOUR_PACES = ['half', 'short', 'full', 'action'];
export const ZONE_INTENSITIES = ['relaxed', 'standard', 'packed'];
export const COMPANIONS = ['solo', 'couple', 'family', 'friends'];
export const ACCOM_BUDGETS = ['budget', 'moderate', 'luxury'];
export const LANGUAGES = ['ko', 'en', 'ja', 'zh'];

/** Caps — mirrored by the client builder. Kept small enough that a full intent
 *  stays far below the Gemini prompt budget and the Firestore 1MB doc limit. */
export const INTENT_LIMITS = {
  cityKeys: 5,
  activities: 20,
  foodStyles: 10,
  dietaryRestrictions: 5,
  bucketDishes: 10,
  specialRequest: 1000,
  revisionNote: 300,
  revisionReasonCodes: 10,
  avoidStopNames: 40,
  avoidStopNameLen: 120,
  textElement: 200,
  hotelAddress: 300,
  mapEntries: 10,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PlannerIntentError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'PlannerIntentError';
    this.code = 'INVALID_PLANNER_INTENT';
    this.statusCode = 400;
    this.field = field || null;
  }
}

function fail(field, why) {
  throw new PlannerIntentError(`INVALID_PLANNER_INTENT: ${field} ${why}`, field);
}

/** Reads a string field. Present-but-not-a-string is an error (no String() coercion). */
function readStr(src, field, { max = INTENT_LIMITS.textElement, fallback = '' } = {}) {
  const v = src[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') fail(field, 'must be a string');
  return v.trim().slice(0, max);
}

/** Reads an enum field. '' means "not answered"; an unrecognized value fails closed. */
function readEnum(src, field, allowed, { fallback = '' } = {}) {
  const v = readStr(src, field);
  if (!v) return fallback;
  if (!allowed.includes(v)) fail(field, `must be one of ${allowed.join('/')}`);
  return v;
}

/** Reads an integer field. Arrays/objects/NaN/fractions fail closed. */
function readInt(src, field, { min, max, fallback = null } = {}) {
  const v = src[field];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'number' && typeof v !== 'string') fail(field, 'must be a number');
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) fail(field, 'must be an integer');
  if (typeof min === 'number' && n < min) fail(field, `must be >= ${min}`);
  if (typeof max === 'number' && n > max) fail(field, `must be <= ${max}`);
  return n;
}

function readBool(src, field) {
  const v = src[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  fail(field, 'must be a boolean');
  return false;
}

/**
 * Reads a string array. A key that is PRESENT but not an array is an error —
 * never a silent []. That rule is load-bearing for dietary fields
 * (.claude/rules/dietary-safety.md: a transport-mangled restriction list must
 * not be downgraded to "no restrictions").
 */
function readArr(src, field, { max = 20, elemMax = INTENT_LIMITS.textElement, allowed = null } = {}) {
  const v = src[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(field, 'must be an array');
  if (v.length > max) fail(field, `has too many entries (max ${max})`);
  const out = [];
  for (const el of v) {
    if (typeof el !== 'string') fail(field, 'contains a non-string entry');
    const t = el.trim();
    if (!t) continue;
    if (t.length > elemMax) fail(field, `contains an entry longer than ${elemMax} chars`);
    if (allowed && !allowed.includes(t)) fail(field, `contains an unsupported value "${t.slice(0, 40)}"`);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Reads a Record<string,string> (hotelByCity / recommendedZones). */
function readMap(src, field, { keyLower = false, valMax = INTENT_LIMITS.hotelAddress } = {}) {
  const v = src[field];
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) fail(field, 'must be an object');
  const entries = Object.entries(v);
  if (entries.length > INTENT_LIMITS.mapEntries) fail(field, 'has too many entries');
  const out = {};
  for (const [k, val] of entries) {
    if (typeof val !== 'string') fail(field, 'values must be strings');
    const key = keyLower ? String(k).trim().toLowerCase() : String(k).trim();
    const value = val.trim();
    if (!key || !value) continue;
    out[key] = value.slice(0, valMax);
  }
  return out;
}

function readDate(src, field) {
  const v = readStr(src, field, { max: 10 });
  if (!v) return '';
  if (!DATE_RE.test(v)) fail(field, 'must be a yyyy-MM-dd date');
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(field, 'must be a real calendar date');
  }
  return v;
}

function readTime(src, field, fallback = '') {
  const raw = src[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') fail(field, 'must be a string');
  // 'HH:mm:ss' from admin/verify tooling is accepted; anything else is not.
  const v = raw.trim().slice(0, 5);
  if (!HHMM_RE.test(v)) fail(field, 'must be a valid HH:MM time');
  return v;
}

function readLuggage(src) {
  const v = src.luggage;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) fail('luggage', 'must be an object');
  const piece = (name) => {
    const raw = v[name];
    if (raw === undefined || raw === null || raw === '') return 0;
    if (typeof raw !== 'number' && typeof raw !== 'string') fail(`luggage.${name}`, 'must be a number');
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 99) fail(`luggage.${name}`, 'must be an integer 0-99');
    return n;
  };
  return { small: piece('small'), medium: piece('medium'), large: piece('large') };
}

/**
 * Case/Unicode-safe comparison key for a stop name.
 *
 * NFKC first (so a full-width "ＫＢＢＱ" or a decomposed Hangul syllable
 * compares equal to its composed twin), then case-fold, then drop every
 * separator/punctuation character — Gemini re-emits the same restaurant as
 * "광장시장 (Gwangjang Market)" / "광장시장" / "광장 시장" across runs, and a
 * naive === would let the avoided stop right back in.
 */
export function avoidKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, INTENT_LIMITS.avoidStopNameLen);
}

/**
 * Normalizes the revision avoid list. Accepts the legacy comma-joined
 * `avoidList` string as well as an array. Bounded in both count and per-entry
 * length; blank/duplicate entries are dropped.
 */
export function normalizeAvoidStopNames(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = raw.split(',');
  else if (raw !== undefined && raw !== null) fail('avoidStopNames', 'must be an array or comma-separated string');
  const out = [];
  const seen = new Set();
  for (const el of list) {
    if (typeof el !== 'string') fail('avoidStopNames', 'contains a non-string entry');
    const name = el.trim().slice(0, INTENT_LIMITS.avoidStopNameLen);
    if (!name) continue;
    const key = avoidKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= INTENT_LIMITS.avoidStopNames) break;
  }
  return out;
}

/**
 * SAFETY (dietary-safety.md): the canonical `dietaryRestrictions` wins outright.
 * The deprecated `allergies` alias is consulted ONLY when canonical is absent —
 * merging both would let a stale allergies array re-add a restriction the
 * traveller just removed. Values outside Halal/Vegan/Vegetarian (retired
 * medical allergens on an old revision link) are dropped here and never
 * re-emitted downstream. A present-but-non-array value throws either way.
 * Used ONLY for the explicit v1.dietaryRestrictions path — the legacy flat
 * path's equivalent throw already lives in requestShaper.js (unchanged).
 */
function readDietaryRestrictions(v1) {
  const hasCanonical = v1.dietaryRestrictions !== undefined && v1.dietaryRestrictions !== null;
  if (hasCanonical) {
    return readArr(v1, 'dietaryRestrictions', {
      max: INTENT_LIMITS.dietaryRestrictions,
      allowed: DIETARY_RESTRICTION_VALUES,
    });
  }
  const legacyAllergies = v1.allergies;
  if (legacyAllergies === undefined || legacyAllergies === null) return [];
  if (!Array.isArray(legacyAllergies)) fail('allergies', 'must be an array');
  const out = [];
  for (const el of legacyAllergies) {
    if (typeof el !== 'string') continue;
    const t = el.trim();
    if (DIETARY_RESTRICTION_VALUES.includes(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, INTENT_LIMITS.dietaryRestrictions);
}

/** Strict — used only when the client sent an explicit v1.revision object. */
function readExplicitRevision(rev) {
  if (rev !== null && (typeof rev !== 'object' || Array.isArray(rev))) fail('revision', 'must be an object');
  const r = rev || {};
  const reasonCodes = r.reasonCodes === undefined || r.reasonCodes === null
    ? []
    : readArr(r, 'reasonCodes', { max: INTENT_LIMITS.revisionReasonCodes, elemMax: 60 });
  const note = readStr(r, 'note', { max: INTENT_LIMITS.revisionNote });
  const avoidStopNames = normalizeAvoidStopNames(r.avoidStopNames);
  if (!reasonCodes.length && !note && !avoidStopNames.length) return null;
  return { reasonCodes, note, avoidStopNames };
}

/**
 * Lenient — built from the already-clamped legacy flat fields (revisionReason
 * chip string already sliced to 200 chars, revisionNote to 300, avoidList to
 * 1000 — see requestShaper.js). No per-entry length cap and no throwing here:
 * that would be new, unrequested strictness for a request shape that has
 * worked this way in production for months.
 */
function legacyRevision(ls) {
  const reasonCodes = typeof ls.revisionReason === 'string' && ls.revisionReason
    ? ls.revisionReason.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const note = typeof ls.revisionNote === 'string' ? ls.revisionNote : '';
  const avoidStopNames = normalizeAvoidStopNames(ls.avoidListBody || '');
  if (!reasonCodes.length && !note && !avoidStopNames.length) return null;
  return { reasonCodes, note, avoidStopNames };
}

/**
 * The single entry point. Throws PlannerIntentError (400) on malformed input —
 * but ONLY on fields the client explicitly set via `planner_intent_v1`. A pure
 * legacy request (no `planner_intent_v1` key) never throws from this module;
 * its fields come verbatim from `legacyShaped`, the object requestShaper.js
 * already builds using its existing (unit-tested) clamp/filter/truncate rules.
 * That split is the whole point of this module's "additive, not replacing"
 * contract — see the file header.
 *
 * MONEY BOUNDARY (.claude/rules money-relevant fields): startDate, durationDays
 * and pax are ALWAYS taken from `legacyShaped` — never from an explicit v1
 * value — because those are exactly the fields the payment/revision-credit
 * gate already priced and approved upstream (paymentGate.js / vehicleAndPrice.js
 * run against the shaped flat values, not this module). Letting a v1 object
 * override them here would let a mismatched v1 payload silently change paid
 * scope (e.g. a 3-day gate-approved request producing a 10-day itinerary)
 * without ever touching the gate itself. See tests/unit/planner-intent-v1-money-boundary.test.ts.
 *
 * @param {Record<string, unknown>} body — already-parsed request body
 * @param {Record<string, unknown>|null} legacyShaped — requestShaper's already
 *   clamped/truncated flat fields (see requestShaper.js `LEGACY_SHAPED_KEYS`
 *   mapping). Optional only for callers that pass an explicit-v1-only body
 *   (e.g. a future parity test) — every production call site supplies it.
 * @returns {object} normalized, versioned PlannerIntent v1
 */
export function normalizePlannerIntentV1(body, legacyShaped = null) {
  const b = body || {};
  const raw = b[PLANNER_INTENT_KEY];
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    fail(PLANNER_INTENT_KEY, 'must be an object');
  }
  const v1 = raw || {};
  if (v1.version !== undefined && v1.version !== null) {
    const version = readInt(v1, 'version', { min: 1, max: PLANNER_INTENT_VERSION });
    if (version !== PLANNER_INTENT_VERSION) fail('version', `must be ${PLANNER_INTENT_VERSION}`);
  }
  const ls = legacyShaped || {};

  // `pick(name, explicitFn)`: the client's explicit v1 value (strict — throws
  // on a bad shape) when they sent one, else the legacy-shaped value verbatim
  // (already correct — no re-validation, no throw). Absent both, `explicitFn`
  // runs against an empty v1 and returns its own documented fallback.
  const pick = (name, explicitFn, legacyKey = name) => (
    v1[name] !== undefined ? explicitFn() : (legacyKey in ls ? ls[legacyKey] : explicitFn())
  );

  const cityKeys = pick('cityKeys', () => readArr(v1, 'cityKeys', { max: INTENT_LIMITS.cityKeys, elemMax: 60 }), 'regions');
  const arrivalCityKey = pick('arrivalCityKey', () => readStr(v1, 'arrivalCityKey', { max: 60 }).toLowerCase(), 'arrivalCity');
  const departureCityKey = pick('departureCityKey', () => readStr(v1, 'departureCityKey', { max: 60 }).toLowerCase(), 'departureCity');

  // MONEY BOUNDARY — always the gate-approved shaped value, see doc comment above.
  const startDate = 'startDate' in ls ? ls.startDate : readDate(v1, 'startDate');
  const durationDays = 'durationDays' in ls ? ls.durationDays : readInt(v1, 'durationDays', { min: 1, max: 30 });
  const pax = 'pax' in ls ? ls.pax : readInt(v1, 'pax', { min: 1, max: 50 });

  // No legacy flat equivalent — always a strict (optional) v1-only field.
  // startDate/endDate both inclusive (endDate = last travel day) — same
  // convention as src/components/charter/Step5DateOptions.tsx.
  const endDate = readDate(v1, 'endDate');
  if (startDate && endDate && endDate < startDate) fail('endDate', 'must not be before startDate');

  const tourStartTime = pick('tourStartTime', () => readTime(v1, 'tourStartTime', '09:00'));
  const tourEndTime = pick('tourEndTime', () => readTime(v1, 'tourEndTime', '21:00'));

  const intent = {
    version: PLANNER_INTENT_VERSION,
    language: pick('language', () => readEnum(v1, 'language', LANGUAGES, { fallback: 'en' })),
    reservationStatus: pick(
      'reservationStatus',
      () => readEnum(v1, 'reservationStatus', RESERVATION_STATUSES, { fallback: '' }) || null,
    ) || null,

    cityKeys,
    arrivalCityKey,
    departureCityKey,

    startDate,
    endDate,
    durationDays,

    arrivalAirport: pick('arrivalAirport', () => readStr(v1, 'arrivalAirport', { max: 10 }), 'arrival_airport'),
    departureAirport: pick('departureAirport', () => readStr(v1, 'departureAirport', { max: 10 }), 'departure_airport'),
    arrivalTime: pick('arrivalTime', () => readTime(v1, 'arrivalTime')),
    departureTime: pick('departureTime', () => readTime(v1, 'departureTime')),
    tourStartTime,
    tourEndTime,

    hotelAddress: pick('hotelAddress', () => readStr(v1, 'hotelAddress', { max: INTENT_LIMITS.hotelAddress }), 'hotel_address'),
    hotelByCity: pick('hotelByCity', () => readMap(v1, 'hotelByCity', { keyLower: true })),
    recommendedZone: pick('recommendedZone', () => readStr(v1, 'recommendedZone')),
    recommendedZones: pick('recommendedZones', () => readMap(v1, 'recommendedZones', { valMax: 120 })),
    recommendedZoneAddress: pick('recommendedZoneAddress', () => readStr(v1, 'recommendedZoneAddress', { max: INTENT_LIMITS.hotelAddress })),

    tourPace: pick('tourPace', () => readEnum(v1, 'tourPace', TOUR_PACES, { fallback: '' })),
    zoneIntensity: pick('zoneIntensity', () => readEnum(v1, 'zoneIntensity', ZONE_INTENSITIES, { fallback: '' }), 'pace'),

    activities: pick('activities', () => readArr(v1, 'activities', { max: INTENT_LIMITS.activities, elemMax: 60 }), 'styles'),
    foodStyles: pick('foodStyles', () => readArr(v1, 'foodStyles', { max: INTENT_LIMITS.foodStyles, elemMax: 60 }), 'dietPrefs'),
    dietaryRestrictions: pick('dietaryRestrictions', () => readDietaryRestrictions(v1)),
    priceRange: pick('priceRange', () => readEnum(v1, 'priceRange', PRICE_RANGES, { fallback: 'Any' })),
    spiceLevel: pick('spiceLevel', () => readEnum(v1, 'spiceLevel', SPICE_LEVELS, { fallback: '' })),
    bucketDishes: pick('bucketDishes', () => readArr(v1, 'bucketDishes', { max: INTENT_LIMITS.bucketDishes, elemMax: 60 })),

    pax,
    companions: pick('companions', () => readEnum(v1, 'companions', COMPANIONS, { fallback: '' })),
    luggage: pick('luggage', () => readLuggage(v1)),

    wantAccom: pick('wantAccom', () => readBool(v1, 'wantAccom')),
    accomBudget: pick('accomBudget', () => readEnum(v1, 'accomBudget', ACCOM_BUDGETS, { fallback: '' })),

    specialRequest: pick('specialRequest', () => readStr(v1, 'specialRequest', { max: INTENT_LIMITS.specialRequest })),
    mobility: pick('mobility', () => readStr(v1, 'mobility', { max: 100 }) || 'ok'),

    revision: v1.revision !== undefined ? readExplicitRevision(v1.revision) : legacyRevision(ls),
  };

  // Bookends must be cities the traveller actually picked — a bookend naming a
  // city that isn't in cityKeys would silently reorder somebody else's trip.
  if (cityKeys.length > 0) {
    const known = new Set(cityKeys.map((c) => String(c).toLowerCase()));
    if (intent.arrivalCityKey && !known.has(intent.arrivalCityKey)) intent.arrivalCityKey = '';
    if (intent.departureCityKey && !known.has(intent.departureCityKey)) intent.departureCityKey = '';
  }
  // A 1-day trip cannot land in one city and fly out of another — buildCityPerDayWithBookends
  // would otherwise silently keep only the arrival city and drop the departure bookend,
  // shipping a plan that quietly strands the traveller at the wrong airport. Fail closed
  // instead (both legacy and explicit-v1 requests — this is a structural conflict, not a
  // new-strictness relational check like the tourStartTime/tourEndTime one above).
  if (intent.durationDays === 1 && intent.arrivalCityKey && intent.departureCityKey
      && intent.arrivalCityKey !== intent.departureCityKey) {
    fail('departureCityKey', 'cannot differ from arrivalCityKey for a 1-day trip');
  }
  // tour window sanity — only enforced when the CLIENT explicitly set one of
  // these via v1; legacy flat requests never had this relational check and
  // must not start throwing now (requestShaper's own regex defaults already
  // guarantee 09:00 < 21:00 for anything it clamps).
  if ((v1.tourStartTime !== undefined || v1.tourEndTime !== undefined) && intent.tourStartTime >= intent.tourEndTime) {
    fail('tourEndTime', 'must be after tourStartTime');
  }
  return intent;
}

/**
 * Ordered city key per day, honouring explicit bookends.
 *
 * Requirements (planner-intent-v1 §4):
 *   - exactly `durationDays` entries,
 *   - day 1 === arrivalCityKey and day N === departureCityKey when supplied,
 *   - the traveller's city ordering is preserved in between,
 *   - single-city stays byte-identical to "every day is that city".
 *
 * Deterministic — no randomness, no clock. Cities are compared lowercased;
 * the ORIGINAL casing from `cityKeys` is what's returned.
 *
 * @param {string[]} cityKeys — ordered, as the traveller picked them
 * @param {number} durationDays
 * @param {{arrivalCityKey?: string, departureCityKey?: string}} bookends
 * @returns {string[]} length === durationDays
 */
export function buildCityPerDayWithBookends(cityKeys, durationDays, bookends = {}) {
  const days = Math.max(1, Math.floor(Number(durationDays) || 1));
  const cities = (Array.isArray(cityKeys) ? cityKeys : []).map(String).filter(Boolean);
  if (cities.length === 0) return [];
  if (cities.length === 1) return Array.from({ length: days }, () => cities[0]);

  const find = (key) => cities.find((c) => c.toLowerCase() === String(key || '').toLowerCase()) || '';
  const arrival = find(bookends.arrivalCityKey);
  const departure = find(bookends.departureCityKey);

  // Ordered city sequence: arrival first, departure last, everything else in
  // the traveller's original order in between.
  const middle = cities.filter((c) => c !== arrival && c !== departure);
  const sequence = [
    ...(arrival ? [arrival] : []),
    ...middle,
    ...(departure && departure !== arrival ? [departure] : []),
  ];
  const ordered = sequence.length ? sequence : cities;

  // More cities than days: keep the bookends, drop from the middle.
  const usable = ordered.length <= days
    ? ordered
    : [ordered[0], ...ordered.slice(1, -1).slice(0, Math.max(0, days - 2)), ordered[ordered.length - 1]].slice(0, days);

  // Even distribution across the usable sequence, then force the bookends.
  const out = [];
  for (let d = 0; d < days; d++) {
    const idx = Math.min(Math.floor((d / days) * usable.length), usable.length - 1);
    out.push(usable[idx]);
  }
  if (arrival) out[0] = arrival;
  if (departure && days > 1) out[days - 1] = departure;
  return out;
}

/**
 * Departure/arrival airport inference keyed off the EXPLICIT bookends when the
 * traveller set them, falling back to the raw first/last region only when they
 * didn't. Blindly using the last raw region sent a Busan-exit traveller to ICN.
 *
 * @param {object} intent — normalized PlannerIntent v1
 * @returns {{arrivalCity: string, departureCity: string}} lowercased keys ('' when unknown)
 */
export function resolveBookendCities(intent) {
  const cities = Array.isArray(intent && intent.cityKeys) ? intent.cityKeys : [];
  const lower = cities.map((c) => String(c).toLowerCase());
  const arrivalCity = intent.arrivalCityKey || lower[0] || '';
  const departureCity = intent.departureCityKey || lower[lower.length - 1] || '';
  return { arrivalCity, departureCity };
}
