/**
 * Normalizes an /api/ai-planner-quick request body into the fields that
 * materially change a one-day preview, plus a coverage map of which ones
 * were actually usable.
 *
 * 2026-08-24 (planner-trust-course): the endpoint used to read only
 * destination/preferences/durationDays/pax/dietPrefs/dietaryRestrictions/
 * priceRange — everything else the wizard collects (dates, airports, hotel/
 * zone, mobility, pace, luggage, companions, entry/exit cities,
 * special_request) was silently dropped.
 *
 * Mirrored on the frontend by `src/pages/PlannerPage/lib/quickPreviewIntent.ts`.
 * `api/` and `src/` don't cross-import (two different runtimes) — the pair is
 * kept honest by `tests/unit/quick-preview-intent-parity.test.ts` instead of a
 * shared module.
 *
 * @param {Record<string, unknown>} rawBody
 * @returns {{ intent: Record<string, unknown>, coverage: Record<string, boolean> }}
 */
export function normalizeQuickPreviewIntent(rawBody) {
  const b = rawBody || {};
  const regions = Array.isArray(b.regions) ? b.regions.filter(Boolean).map(String) : [];
  const destinationRaw = String(b.destination || '').trim();
  // 2026-08-24 (planner-trust-course, hardening #12): destination and regions
  // are kept as two SEPARATE raw token lists here — the old code collapsed
  // them into one `cities` list the instant `destination` was present,
  // silently discarding `regions` with no comparison at all. That let a
  // client (or an attacker) send a `destination` the UI shows next to a
  // `regions` array the city/food/attraction lookups never see checked
  // against it. The handler (ai-planner-quick.js) resolves and compares both
  // lists when both are supplied, before either is trusted.
  const destinationCities = destinationRaw ? destinationRaw.split(',').map((c) => c.trim()).filter(Boolean) : [];
  const destination = destinationRaw || regions.join(', ');
  // Requested cities, in the order the traveller picked them — day 1 of a
  // preview is always the first one. Never re-priority them by keyword.
  const cities = destinationCities.length ? destinationCities : regions;

  const dietPrefs = Array.isArray(b.dietPrefs) ? b.dietPrefs.slice(0, 10) : [];
  const dietaryRestrictionsRaw = Array.isArray(b.dietaryRestrictions) ? b.dietaryRestrictions.slice(0, 5) : [];
  // 2026-08-24 (E.1): canonical `dietaryRestrictions` wins outright — the
  // deprecated `allergies` alias (old clients/revision links) is only ever
  // consulted when canonical is ABSENT, matching requestShaper.js's rule.
  // Merging both unconditionally (old behavior) meant a client that explicitly
  // cleared dietaryRestrictions to [] could still have a stale `allergies`
  // array silently re-add a restriction the traveler removed.
  let dietaryRestrictions = [];
  if (Object.prototype.hasOwnProperty.call(b, 'dietaryRestrictions')) {
    // Canonical field present — validate values only (no fallback to allergies)
    dietaryRestrictions = dietaryRestrictionsRaw.filter((v) => /^(halal|vegan|vegetarian)$/i.test(String(v || '')));
  } else if (Array.isArray(b.allergies)) {
    // Legacy fallback only when canonical key is absent
    dietaryRestrictions = b.allergies.slice(0, 5).filter((a) => /^(halal|vegan|vegetarian)$/i.test(String(a || '')));
  }
  dietaryRestrictions = [...new Set(dietaryRestrictions)];

  const luggage = b.luggage && typeof b.luggage === 'object' ? b.luggage : null;
  const luggageTotal = luggage
    ? (Number(luggage.small) || 0) + (Number(luggage.medium) || 0) + (Number(luggage.large) || 0)
    : 0;

  const intent = {
    language: b.language || 'en',
    destination,
    cities,
    // 2026-08-24 (hardening #12): raw per-source token lists, kept apart so
    // the handler can require them to resolve to the same canonical city set
    // when the client sent BOTH `destination` and `regions`.
    destinationCities,
    regionsCities: regions,
    // 2026-08-24 (planner-trust-course): stable UI city key for the primary
    // city (WizardForm CITY_CHIPS), preferred over parsing `destination` text.
    cityKey: String(b.cityKey || '').trim(),
    preferences: String(b.preferences || (Array.isArray(b.categories) ? b.categories.join(', ') : '') || '').slice(0, 300),
    // 2026-08-24 (planner-trust-course #9): raw category keys, kept separate
    // from the human-readable `preferences` string — server-side Food-family/
    // Temple/Night gating needs exact key membership, not substring parsing.
    categories: Array.isArray(b.categories) ? b.categories.slice(0, 20).map(String) : [],
    // 2026-08-24 (E.2): NEVER default before validation — a missing/zero/NaN
    // durationDays or pax must reach validateRequiredIntent's INVALID_DURATION/
    // INVALID_PAX, not silently become a fabricated "3-day, 2-person" trip.
    durationDays: b.durationDays != null ? Number(b.durationDays) : Number(b.duration),
    pax: b.pax != null ? Number(b.pax) : Number(b.members),
    startDate: String(b.startDate || '').slice(0, 20),
    endDate: String(b.endDate || '').slice(0, 20),
    arrivalAirport: String(b.arrival_airport || b.arrivalAirport || '').slice(0, 10),
    departureAirport: String(b.departure_airport || '').slice(0, 10),
    arrivalTime: String(b.arrival_time || '').slice(0, 10),
    departureTime: String(b.departure_time || '').slice(0, 10),
    hotelAddress: String(b.hotel_address || '').slice(0, 300),
    zone: String(b.recommended_zone || '').slice(0, 200),
    mobility: String(b.mobility || '').slice(0, 100),
    tourPace: String(b.tourPace || '').slice(0, 30),
    tourStartTime: String(b.tour_start_time || '').slice(0, 10),
    tourEndTime: String(b.tour_end_time || '').slice(0, 10),
    luggageTotal,
    companions: String(b.companions || '').slice(0, 100),
    // 2026-08-24 (E.4): explicit `arrival_city` (when the client sends it) is
    // preserved separately from and preferred over `entry_city` — the two are
    // not the same concept (arrival_city is where the flight lands; entry_city
    // was the older, less precise field) and collapsing them silently loses
    // the more precise value when both are present.
    arrivalCity: String(b.arrival_city || '').slice(0, 100),
    entryCity: String(b.entry_city || '').slice(0, 100),
    departureCity: String(b.departure_city || '').slice(0, 100),
    dietPrefs,
    dietaryRestrictions,
    priceRange: b.priceRange || 'Any',
    spiceLevel: b.spiceLevel || '',
    bucketDishes: Array.isArray(b.bucketDishes) ? b.bucketDishes.slice(0, 20) : [],
    // length-capped, not run through _food_helper's structured-field allowlist —
    // this only ever reaches a narrative Gemini prompt, never a DB matcher or a
    // persisted plan, so the blast radius of a prompt-injection attempt here is
    // "a weird free preview", not a corrupted saved plan.
    specialRequest: String(b.special_request || '').slice(0, 600),
  };

  const coverage = {
    destination: !!intent.destination,
    dates: !!(intent.startDate && intent.endDate),
    airport: !!intent.arrivalAirport,
    hotel: !!intent.hotelAddress,
    zone: !!intent.zone,
    // 2026-08-24 (E.5): 'ok' is the WizardForm baseline (index.tsx hardcodes it
    // for every traveler) — it carries no information, so it must read as "not
    // covered" the same as an empty string, or every single preview would
    // falsely claim to reflect a "mobility need".
    mobility: !!(intent.mobility && intent.mobility !== 'ok'),
    pace: !!intent.tourPace,
    luggage: intent.luggageTotal > 0,
    companions: !!intent.companions,
    foodStyle: intent.dietPrefs.length > 0,
    dietary: intent.dietaryRestrictions.length > 0,
    priceRange: intent.priceRange !== 'Any',
    specialRequest: !!intent.specialRequest,
    entryExitCities: !!(intent.arrivalCity || intent.entryCity || intent.departureCity),
  };

  return { intent, coverage };
}

const REFLECTED_LABELS = {
  en: {
    dates: 'Your travel dates', airport: 'Arrival airport', hotel: 'Your hotel address',
    zone: 'Your preferred area', pace: 'Your travel pace', luggage: 'Your luggage',
    companions: 'Who you are travelling with', food: 'Your food preferences',
    specialRequest: 'Your special request', entryExit: 'Your entry/exit cities',
    mobility: 'Your mobility needs', reservationStatus: 'Your booking status',
  },
  ko: {
    dates: '여행 날짜', airport: '입국 공항', hotel: '숙소 주소',
    zone: '선호 지역', pace: '이동 속도', luggage: '수하물',
    companions: '동행 유형', food: '식이 선호',
    specialRequest: '요청사항', entryExit: '입출국 도시',
    mobility: '이동 편의 요구사항', reservationStatus: '예약 상태',
  },
  ja: {
    dates: '旅行日程', airport: '到着空港', hotel: '宿泊先住所',
    zone: '希望エリア', pace: '移動ペース', luggage: '手荷物',
    companions: '同行者', food: '食の好み',
    specialRequest: 'リクエスト内容', entryExit: '入出国都市',
    mobility: '移動に関する配慮事項', reservationStatus: '予約状況',
  },
  zh: {
    dates: '旅行日期', airport: '抵达机场', hotel: '酒店地址',
    zone: '偏好区域', pace: '出行节奏', luggage: '行李',
    companions: '同行人员', food: '饮食偏好',
    specialRequest: '特殊要求', entryExit: '入境/出境城市',
    mobility: '出行便利需求', reservationStatus: '预订状态',
  },
};

/**
 * Short "what the preview actually used" lines for the UI — not what's
 * reserved for the paid full plan (that's `WizardStep3Review`'s existing
 * "the full itinerary includes" panel).
 * @param {Record<string, boolean>} coverage
 * @param {string} lang
 * @returns {string[]}
 */
export function buildReflectedConditions(coverage, lang) {
  const L = REFLECTED_LABELS[lang] || REFLECTED_LABELS.en;
  const lines = [];
  if (coverage.dates) lines.push(L.dates);
  if (coverage.airport) lines.push(L.airport);
  if (coverage.hotel) lines.push(L.hotel);
  else if (coverage.zone) lines.push(L.zone);
  if (coverage.mobility) lines.push(L.mobility);
  if (coverage.pace) lines.push(L.pace);
  if (coverage.luggage) lines.push(L.luggage);
  if (coverage.companions) lines.push(L.companions);
  if (coverage.foodStyle || coverage.dietary) lines.push(L.food);
  if (coverage.specialRequest) lines.push(L.specialRequest);
  if (coverage.entryExitCities) lines.push(L.entryExit);
  if (coverage.reservationStatus) lines.push(L.reservationStatus);
  return lines;
}

const RESERVATION_STATUSES = ['nothing', 'flight', 'flight_hotel', 'all_done'];

// 2026-08-24 (planner-trust-course, hardening #10) — scalar field validators.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealCalendarDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function hhmmToMinutes(s) {
  if (!HHMM_RE.test(String(s || ''))) return null;
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}
// Mirrors src/components/WizardForm/data.tsx AIRPORT_OPTIONS values — api/
// and src/ don't cross-import (.claude/rules/cocotrip-api-src-no-cross-import).
const SUPPORTED_AIRPORT_CODES = new Set(['ICN_T1', 'ICN_T2', 'GMP', 'PUS', 'TAE', 'CJU', 'MWX', 'YNY', 'RSU', 'ALREADY']);

/**
 * Normalizes `reservation_status` against the WizardStep0Reservation allowlist
 * (2026-08-24, planner-trust-course E.2). Distinguishes a field the client
 * never sent at all (legacy client, before this field existed — lenient) from
 * one it sent with an empty/unrecognized value (a live client sending garbage
 * — invalid, must fail explicitly rather than silently behave as "nothing").
 * @param {Record<string, unknown>} rawBody
 * @returns {{ status: string|null, provided: boolean, invalid: boolean }}
 */
export function normalizeReservationStatus(rawBody) {
  const b = rawBody || {};
  if (!Object.prototype.hasOwnProperty.call(b, 'reservation_status')) {
    return { status: null, provided: false, invalid: false };
  }
  const raw = String(b.reservation_status || '').trim();
  if (!raw || !RESERVATION_STATUSES.includes(raw)) {
    return { status: null, provided: true, invalid: true };
  }
  return { status: raw, provided: true, invalid: false };
}

/**
 * Required-intent validation (2026-08-24, planner-trust-course E.3) — the
 * quick preview must not silently default a malformed/missing request to
 * Seoul/today. Returns a stable error code + message, or null if valid.
 * Dates/airport may legitimately be absent when reservationStatus permits it
 * (traveller hasn't booked yet) — this only enforces what's *always* required.
 * @param {ReturnType<typeof normalizeQuickPreviewIntent>['intent']} intent
 * @param {ReturnType<typeof normalizeReservationStatus>} reservation
 * @returns {{code: string, message: string}|null}
 */
export function validateRequiredIntent(intent, reservation, rawBody) {
  if (!intent.destination) {
    return { code: 'MISSING_DESTINATION', message: 'destination is required' };
  }
  // 2026-08-24 (planner-trust-course, hardening #10): bounded INTEGER, not
  // just "any finite number >= 1" — a fractional or absurdly large value
  // (e.g. 2.5 or 9999) used to reach Gemini as an itinerary-length instruction.
  if (!(Number.isInteger(intent.durationDays) && intent.durationDays >= 1 && intent.durationDays <= 30)) {
    return { code: 'INVALID_DURATION', message: 'durationDays must be an integer between 1 and 30' };
  }
  if (!(Number.isInteger(intent.pax) && intent.pax >= 1 && intent.pax <= 50)) {
    return { code: 'INVALID_PAX', message: 'pax must be an integer between 1 and 50' };
  }
  // 2026-08-24 (#10): startDate/endDate, when supplied, must be real
  // yyyy-MM-dd calendar dates (not "2026-13-40") with end >= start — a
  // malformed/inverted date pair used to reach the traveler-data JSON block
  // and RouteAgent's downstream date math unvalidated.
  if (intent.startDate && !isRealCalendarDate(intent.startDate)) {
    return { code: 'INVALID_DATE', message: 'startDate must be a real yyyy-MM-dd date' };
  }
  if (intent.endDate && !isRealCalendarDate(intent.endDate)) {
    return { code: 'INVALID_DATE', message: 'endDate must be a real yyyy-MM-dd date' };
  }
  if (intent.startDate && intent.endDate && isRealCalendarDate(intent.startDate) && isRealCalendarDate(intent.endDate) && intent.endDate < intent.startDate) {
    return { code: 'INVALID_DATE_RANGE', message: 'endDate must not be before startDate' };
  }
  for (const [field, label] of [['arrivalTime', 'arrival_time'], ['departureTime', 'departure_time'], ['tourStartTime', 'tour_start_time'], ['tourEndTime', 'tour_end_time']]) {
    if (intent[field] && hhmmToMinutes(intent[field]) === null) {
      return { code: 'INVALID_TIME', message: `${label} must be a valid HH:MM time (00:00-23:59)` };
    }
  }
  if (intent.tourStartTime && intent.tourEndTime) {
    const s = hhmmToMinutes(intent.tourStartTime);
    const e = hhmmToMinutes(intent.tourEndTime);
    if (s !== null && e !== null && s >= e) {
      return { code: 'INVALID_TOUR_WINDOW', message: 'tour_start_time must be before tour_end_time' };
    }
  }
  // 2026-08-24 (#10): arrival/departure airport, when supplied, must be one
  // of the actual codes WizardStep0Reservation offers (src/components/
  // WizardForm/data.tsx AIRPORT_OPTIONS — api/ and src/ don't cross-import,
  // see .claude/rules/cocotrip-api-src-no-cross-import) — an arbitrary "XXX"
  // used to reach the traveler-data JSON block unvalidated.
  if (intent.arrivalAirport && !SUPPORTED_AIRPORT_CODES.has(intent.arrivalAirport)) {
    return { code: 'INVALID_AIRPORT', message: 'arrival airport is not a supported code' };
  }
  if (intent.departureAirport && !SUPPORTED_AIRPORT_CODES.has(intent.departureAirport)) {
    return { code: 'INVALID_AIRPORT', message: 'departure airport is not a supported code' };
  }
  // 2026-08-24 (planner-trust-course hardening): reservation_status is now
  // REQUIRED at this boundary — the old "key never sent at all -> stay
  // lenient" branch let a live client silently skip a field RouteAgent's
  // arrival-time logic depends on. A client that never sends the key at all
  // is treated exactly like one that sends it blank: MISSING_RESERVATION_STATUS.
  // An unrecognized value (sent, non-empty, not one of the 4 allowed) is a
  // distinct INVALID_RESERVATION_STATUS. rawBody is only used to tell "sent
  // blank" apart from "sent garbage" when available; without it (2-arg call)
  // an invalid-but-provided status defaults to INVALID_RESERVATION_STATUS.
  if (!reservation || !reservation.provided) {
    return { code: 'MISSING_RESERVATION_STATUS', message: 'reservation_status is required' };
  }
  if (reservation.invalid) {
    const rawVal = rawBody ? String(rawBody.reservation_status || '').trim() : undefined;
    if (rawVal === '') {
      return { code: 'MISSING_RESERVATION_STATUS', message: 'reservation_status was sent but empty' };
    }
    return { code: 'INVALID_RESERVATION_STATUS', message: 'reservation_status must be one of nothing/flight/flight_hotel/all_done' };
  }
  const status = reservation.status;
  // A booked-flight status implies the airport/time it depends on — both must
  // be present, not just the airport (a flight with no ETA still leaves
  // RouteAgent guessing what the old code was written to avoid).
  if (status === 'flight' || status === 'flight_hotel') {
    if (!intent.arrivalAirport) {
      return { code: 'MISSING_AIRPORT', message: 'arrival airport is required for a booked flight' };
    }
    if (!intent.arrivalTime) {
      return { code: 'MISSING_ARRIVAL_TIME', message: 'arrival time is required for a booked flight' };
    }
  }
  return null;
}

const LANGUAGE_ALLOWLIST = ['ko', 'en', 'ja', 'zh'];
const PRICE_RANGE_ALLOWLIST = ['Budget', 'Moderate', 'Premium', 'Any'];
const MAX_REQUEST_BYTES = 20_000;
const MAX_ARRAY_LEN = { dietPrefs: 10, dietaryRestrictions: 5, allergies: 5, bucketDishes: 20, regions: 10, categories: 20 };

/**
 * Request-shape validation (2026-08-24, planner-trust-course E.6) — runs
 * BEFORE normalizeQuickPreviewIntent/Gemini on the raw, untrusted body from an
 * unauthenticated endpoint. Bounds total size and array counts (cost/DoS —
 * this is a paid-Gemini-call endpoint with no auth), and allowlists the two
 * fields the model prompt branches string-compares on (language/priceRange) —
 * everything else the model just reads as free text and is bounded by the
 * per-field `.slice()` caps in normalizeQuickPreviewIntent instead. Unknown
 * top-level fields are ignored (not rejected) — normalize only ever reads
 * known keys.
 * @param {Record<string, unknown>} rawBody
 * @returns {{code: string, message: string}|null}
 */
const DIETARY_ENUM_RE = /^(halal|vegan|vegetarian)$/i;
const MAX_ARRAY_ELEMENT_LEN = 200;

// 2026-08-24 (planner-trust-course, hardening #11): every scalar field the
// rest of this module reads via String(b.x)/Number(b.x) — a raw-type bypass
// let arrays/objects through: String(['seoul']) === 'seoul' and, worse,
// Number([5]) === 5 (JS singleton-array-to-number coercion), so a
// `durationDays: [5]` request sailed through Number.isInteger downstream as
// if it were the plain number 5. Reject BEFORE any coercion runs — never let
// String()/Number() decide whether an array/object counts as valid input.
const TEXT_SCALAR_FIELDS = [
  'language', 'destination', 'cityKey', 'preferences', 'startDate', 'endDate',
  'arrival_airport', 'arrivalAirport', 'departure_airport', 'arrival_time', 'departure_time',
  'hotel_address', 'recommended_zone', 'mobility', 'tourPace', 'tour_start_time', 'tour_end_time',
  'companions', 'arrival_city', 'entry_city', 'departure_city', 'priceRange', 'spiceLevel',
  'special_request', 'reservation_status',
];
const NUMERIC_SCALAR_FIELDS = ['duration', 'durationDays', 'pax', 'members'];

export function validateRequestShape(rawBody) {
  const b = rawBody || {};
  let size = 0;
  try { size = JSON.stringify(b).length; } catch { size = MAX_REQUEST_BYTES + 1; }
  if (size > MAX_REQUEST_BYTES) {
    return { code: 'INVALID_REQUEST', message: 'Request body too large' };
  }
  for (const key of TEXT_SCALAR_FIELDS) {
    if (b[key] == null) continue;
    if (typeof b[key] !== 'string') {
      return { code: 'INVALID_REQUEST', message: `${key} must be a string` };
    }
  }
  for (const key of NUMERIC_SCALAR_FIELDS) {
    if (b[key] == null) continue;
    if (typeof b[key] !== 'number' && typeof b[key] !== 'string') {
      return { code: 'INVALID_REQUEST', message: `${key} must be a number` };
    }
    if (typeof b[key] === 'number' && !Number.isFinite(b[key])) {
      return { code: 'INVALID_REQUEST', message: `${key} must be a finite number` };
    }
  }
  // 2026-08-24 (#4): a field expected to be an array must actually BE one
  // (not a bare string/object a caller could send instead), every element
  // must be a bounded-length string (never an object/number smuggled in),
  // and dietaryRestrictions/allergies values must be Halal/Vegan/Vegetarian —
  // an unrecognized value is now a stable 422, not a silent filter-and-continue.
  for (const [key, max] of Object.entries(MAX_ARRAY_LEN)) {
    if (b[key] == null) continue;
    if (!Array.isArray(b[key])) {
      return { code: 'INVALID_REQUEST', message: `${key} must be an array` };
    }
    if (b[key].length > max) {
      return { code: 'INVALID_REQUEST', message: `${key} has too many entries` };
    }
    for (const el of b[key]) {
      if (typeof el !== 'string' || el.length > MAX_ARRAY_ELEMENT_LEN) {
        return { code: 'INVALID_REQUEST', message: `${key} contains an invalid entry` };
      }
      if ((key === 'dietaryRestrictions' || key === 'allergies') && !DIETARY_ENUM_RE.test(el)) {
        return { code: 'INVALID_REQUEST', message: `${key} must only contain Halal/Vegan/Vegetarian` };
      }
    }
  }
  if (b.language != null && !LANGUAGE_ALLOWLIST.includes(String(b.language))) {
    return { code: 'INVALID_REQUEST', message: 'language must be one of ko/en/ja/zh' };
  }
  if (b.priceRange != null && !PRICE_RANGE_ALLOWLIST.includes(String(b.priceRange))) {
    return { code: 'INVALID_REQUEST', message: 'priceRange must be one of Budget/Moderate/Premium/Any' };
  }
  return null;
}
