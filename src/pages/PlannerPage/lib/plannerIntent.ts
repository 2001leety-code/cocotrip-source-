/**
 * PlannerIntent v1 — the ONE client-side normalized shape used identically by
 * NEW paid full generation (usePlannerHandlers.handlePaymentSuccess) and
 * REVISION regeneration (handleRevisionRegenerate). 2026-08-24 (planner-intent-v1).
 *
 * Before this module, each of those two handlers hand-built its own ~40-key
 * fetch body inline. They drifted: the revision path was missing
 * recommended_zone/recommended_zones/recommended_zone_address/hotelByCity
 * entirely, so a traveler with a multi-city zone hint or an undecided hotel
 * lost that context the moment they asked for a free revision. Both handlers
 * now call `buildFullPlannerIntentPayload` and spread its `flat` output —
 * so "new" and "revision" can only ever differ by revision metadata/route
 * mechanics (paypalOrderId vs revisionOf/revisionToken), never by a silently
 * omitted travel preference.
 *
 * Pure: this module makes no fetch calls, reads no storage, touches no DOM.
 * It reads only the `PlannerFormValues` the Wizard already assembled for
 * Review — no submit-time fabricated defaults for gate-critical fields
 * (durationDays/pax/dates/cities). The two exceptions (tourStartTime/
 * tourEndTime default '09:00'/'21:00') mirror the Wizard's own state
 * default, which Review already shows and lets the traveler edit — not a
 * value invented here.
 *
 * Mirrored server-side by `api/_shared/plannerIntentV1.js` (api/ and src/
 * never cross-import — .claude/rules/cocotrip-api-src-no-cross-import.md).
 * `tests/unit/planner-intent-v1-parity.test.ts` feeds this module's output
 * into the server normalizer and guards the two from drifting apart.
 *
 * SAFETY (.claude/rules/dietary-safety.md): dietaryRestrictions carries only
 * Halal/Vegan/Vegetarian. The retired medical-allergen concept is never
 * reintroduced here.
 */
import type { PlannerFormValues } from '@/components/PlannerForm';

export const PLANNER_INTENT_VERSION = 1 as const;
export const PLANNER_INTENT_KEY = 'planner_intent_v1' as const;

// Mirrors api/_shared/plannerIntentV1.js exactly — keep both in sync by hand;
// the parity test catches a drift in behavior, not in these literal lists.
export const RESERVATION_STATUSES = ['nothing', 'flight', 'flight_hotel', 'all_done'] as const;
export const DIETARY_RESTRICTION_VALUES = ['Halal', 'Vegan', 'Vegetarian'] as const;
export const PRICE_RANGES = ['Budget', 'Moderate', 'Premium', 'Any'] as const;
export const SPICE_LEVELS = ['none', 'mild', 'medium', 'hot'] as const;
export const TOUR_PACES = ['half', 'short', 'full', 'action'] as const;
export const ZONE_INTENSITIES = ['relaxed', 'standard', 'packed'] as const;
export const COMPANIONS = ['solo', 'couple', 'family', 'friends'] as const;
export const ACCOM_BUDGETS = ['budget', 'moderate', 'luxury'] as const;

export const INTENT_LIMITS = {
  avoidStopNames: 40,
  avoidStopNameLen: 120,
  revisionReasonCodes: 10,
  revisionNote: 300,
};

export interface PlannerIntentRevisionV1 {
  reasonCodes: string[];
  note: string;
  avoidStopNames: string[];
}

export interface PlannerIntentV1 {
  version: 1;
  language: string;
  reservationStatus: PlannerFormValues['reservation_status'] | null;

  cityKeys: string[];
  arrivalCityKey: string;
  departureCityKey: string;

  startDate: string;
  endDate: string;
  durationDays: number | null;

  arrivalAirport: string;
  departureAirport: string;
  arrivalTime: string;
  departureTime: string;
  tourStartTime: string;
  tourEndTime: string;

  hotelAddress: string;
  hotelByCity: Record<string, string>;
  recommendedZone: string;
  recommendedZones: Record<string, string>;
  recommendedZoneAddress: string;

  tourPace: string;
  zoneIntensity: string;

  activities: string[];
  foodStyles: string[];
  dietaryRestrictions: string[];
  priceRange: string;
  spiceLevel: string;
  bucketDishes: string[];

  pax: number | null;
  companions: string;
  luggage: { small: number; medium: number; large: number } | null;

  wantAccom: boolean;
  accomBudget: string;

  specialRequest: string;
  mobility: string;

  revision: PlannerIntentRevisionV1 | null;
}

/** Raw revision metadata as the caller (usePlannerHandlers) receives it — a
 *  comma-joined legacy string or an already-split array, either is accepted. */
export interface PlannerIntentRevisionInput {
  reasonCodes?: string[] | string | null;
  note?: string | null;
  avoidStopNames?: string[] | string | null;
}

function splitList(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(',');
  return [];
}

function normalizeRevision(input: PlannerIntentRevisionInput | null | undefined): PlannerIntentRevisionV1 | null {
  if (!input) return null;
  const reasonCodes = splitList(input.reasonCodes)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, INTENT_LIMITS.revisionReasonCodes);
  const note = (input.note || '').trim().slice(0, INTENT_LIMITS.revisionNote);
  const seen = new Set<string>();
  const avoidStopNames: string[] = [];
  for (const raw of splitList(input.avoidStopNames)) {
    const name = raw.trim().slice(0, INTENT_LIMITS.avoidStopNameLen);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    avoidStopNames.push(name);
    if (avoidStopNames.length >= INTENT_LIMITS.avoidStopNames) break;
  }
  if (!reasonCodes.length && !note && !avoidStopNames.length) return null;
  return { reasonCodes, note, avoidStopNames };
}

/**
 * Builds the normalized PlannerIntent v1 object from the Wizard's own
 * submitted `values` — the same object Review already renders. Pure: no
 * fabricated defaults for anything the Wizard's step gates require the
 * traveler to have actually answered.
 */
export function buildPlannerIntentV1(
  values: PlannerFormValues,
  language: string,
  revision?: PlannerIntentRevisionInput | null,
): PlannerIntentV1 {
  return {
    version: PLANNER_INTENT_VERSION,
    language: language || 'en',
    reservationStatus: values.reservation_status || null,

    cityKeys: values.cityKeys || (values.cityKey ? [values.cityKey] : []),
    arrivalCityKey: values.arrival_city || values.entry_city || '',
    departureCityKey: values.departure_city || '',

    startDate: values.startDate || '',
    endDate: values.endDate || '',
    durationDays: typeof values.durationDays === 'number' ? values.durationDays : null,

    arrivalAirport: values.arrival_airport || values.arrivalAirport || '',
    departureAirport: values.departure_airport || '',
    arrivalTime: values.arrival_time || '',
    departureTime: values.departure_time || '',
    // Wizard state default (visible/editable in Review), not fabricated here.
    tourStartTime: values.tour_start_time || '09:00',
    tourEndTime: values.tour_end_time || '21:00',

    hotelAddress: values.hotel_address || '',
    hotelByCity: values.hotelByCity || {},
    recommendedZone: values.recommended_zone || '',
    recommendedZones: values.recommended_zones || {},
    recommendedZoneAddress: values.recommended_zone_address || '',

    tourPace: values.tourPace || '',
    // WizardForm does not currently collect a separate "zone intensity" —
    // never fabricated; forwarded blank ('not answered'), same as the server
    // enum's own fallback.
    zoneIntensity: '',

    activities: values.categories || [],
    foodStyles: values.dietPrefs || [],
    dietaryRestrictions: values.dietaryRestrictions || [],
    priceRange: values.priceRange || 'Any',
    spiceLevel: values.spiceLevel || '',
    bucketDishes: values.bucketDishes || [],

    pax: typeof values.pax === 'number' ? values.pax : null,
    companions: values.companions || '',
    luggage: values.luggage || null,

    wantAccom: !!values.wantAccom,
    accomBudget: values.wantAccom ? (values.accomBudget || 'moderate') : '',

    specialRequest: values.freeText || '',
    mobility: values.mobility || 'ok',

    revision: normalizeRevision(revision),
  };
}

/**
 * Backward-compatible FLAT fields, derived from the SAME normalized intent
 * object built above — never re-read from `values` independently, so flat
 * and v1 cannot diverge (planner-intent-v1 requirement). `values.regions` is
 * the one exception: it is display-only routing context (destination text /
 * area key), which the intent object intentionally does not carry.
 */
function flattenPlannerIntentV1(intent: PlannerIntentV1, values: PlannerFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [PLANNER_INTENT_KEY]: intent,
    destination: (values.regions || []).join(', ') || undefined,
    regions: values.regions && values.regions.length ? values.regions : undefined,
    preferences: intent.activities.join(', ') || undefined,
    styles: intent.activities.length ? intent.activities : undefined,
    durationDays: intent.durationDays,
    pax: intent.pax,
    startDate: intent.startDate || undefined,
    endDate: intent.endDate || undefined,
    arrival_airport: intent.arrivalAirport || undefined,
    departure_airport: intent.departureAirport || undefined,
    hotel_address: intent.hotelAddress || undefined,
    mobility: intent.mobility,
    dietPrefs: intent.foodStyles,
    dietaryRestrictions: intent.dietaryRestrictions,
    priceRange: intent.priceRange,
    special_request: intent.specialRequest,
    arrivalTime: intent.arrivalTime || undefined,
    departureTime: intent.departureTime || undefined,
    tourStartTime: intent.tourStartTime,
    tourEndTime: intent.tourEndTime,
    luggage: intent.luggage || undefined,
    spiceLevel: intent.spiceLevel || undefined,
    bucketDishes: intent.bucketDishes.length ? intent.bucketDishes : undefined,
    tourPace: intent.tourPace || undefined,
    companions: intent.companions || undefined,
    recommended_zone: intent.recommendedZone || undefined,
    recommended_zones: Object.keys(intent.recommendedZones).length ? intent.recommendedZones : undefined,
    recommended_zone_address: intent.recommendedZoneAddress || undefined,
    entry_city: intent.cityKeys.length > 1 ? (intent.arrivalCityKey || intent.cityKeys[0]) : undefined,
    hotelByCity: Object.keys(intent.hotelByCity).length ? intent.hotelByCity : undefined,
    arrival_city: intent.arrivalCityKey || undefined,
    departure_city: intent.departureCityKey || undefined,
    reservation_status: intent.reservationStatus,
    ...(intent.wantAccom ? { wantAccom: true, accomBudget: intent.accomBudget || 'moderate' } : {}),
    ...(intent.revision ? {
      revisionReason: intent.revision.reasonCodes.join(','),
      revisionNote: intent.revision.note,
      avoidList: intent.revision.avoidStopNames.join(','),
    } : {}),
  };
  return out;
}

/**
 * The single entry point NEW and REVISION submit both call.
 * `revision` is undefined/null for a new paid generation.
 */
export function buildFullPlannerIntentPayload(
  values: PlannerFormValues,
  language: string,
  revision?: PlannerIntentRevisionInput | null,
): { plannerIntentV1: PlannerIntentV1; flat: Record<string, unknown> } {
  const plannerIntentV1 = buildPlannerIntentV1(values, language, revision);
  const flat = flattenPlannerIntentV1(plannerIntentV1, values);
  return { plannerIntentV1, flat };
}
