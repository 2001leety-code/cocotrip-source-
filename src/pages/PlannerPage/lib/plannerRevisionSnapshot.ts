/**
 * Versioned revision snapshot — RevisionCard (PlanDetailPage) writes it right
 * before navigating to `/planner?revision=true&planId=...`; PlannerPage/Wizard
 * reads it once on mount. 2026-08-24 (planner-intent-v1 §3).
 *
 * Before this, RevisionCard serialized a handful of fields as URL query
 * params (prefillStartDate/prefillRegions/...) — endDate, bookend city keys,
 * airports/times, hotelByCity/zones, reservation status, pace, luggage,
 * companions and the accommodation choice never made the trip, so "다시
 * 만들기" silently dropped most of what the traveler had already told the
 * wizard. This carries the FULL safe brief instead, bound to the specific
 * plan being revised so one plan's snapshot can never prefill another
 * (stale sessionStorage from a previous revision, a different tab, or a
 * shared/forwarded link must not leak into the wrong plan).
 *
 * SAFETY: never stores email, uid, payment/order IDs, the revision token, or
 * a share token — none of that belongs in sessionStorage, and none of it is
 * needed to prefill the wizard (PlannerPage still reads token/planId from the
 * URL itself). Free text is bounded to the same two fields the rest of the
 * app already trusts as user-authored copy (specialRequest, revision note).
 * dietaryRestrictions keeps only Halal/Vegan/Vegetarian — a legacy plan's
 * medical-allergen values are discarded, never carried forward
 * (.claude/rules/dietary-safety.md).
 */
import type { PlannerFormValues } from '@/components/PlannerForm';
import { DIETARY_RESTRICTION_VALUES, INTENT_LIMITS, type PlannerIntentRevisionInput } from './plannerIntent';

export const REVISION_SNAPSHOT_VERSION = 1 as const;
const STORAGE_KEY = 'cocotrip:planner-revision-intent-v1';
const SPECIAL_REQUEST_MAX = 1000;

/** Safe subset of PlannerFormValues carried across the revision navigation. */
export interface PlannerRevisionSnapshotValues {
  regions?: string[];
  cityKey?: string;
  cityKeys?: string[];
  startDate?: string;
  endDate?: string;
  categories?: string[];
  pax?: number;
  arrival_airport?: string;
  departure_airport?: string;
  arrival_time?: string;
  departure_time?: string;
  tour_start_time?: string;
  tour_end_time?: string;
  hotel_address?: string;
  hotelByCity?: Record<string, string>;
  recommended_zone?: string;
  recommended_zones?: Record<string, string>;
  arrival_city?: string;
  departure_city?: string;
  entry_city?: string;
  reservation_status?: PlannerFormValues['reservation_status'];
  tourPace?: string;
  dietPrefs?: string[];
  dietaryRestrictions?: string[];
  priceRange?: string;
  spiceLevel?: string;
  bucketDishes?: string[];
  luggage?: { small: number; medium: number; large: number };
  companions?: string;
  wantAccom?: boolean;
  accomBudget?: string;
  freeText?: string;
}

export interface PlannerRevisionSnapshotV1 {
  version: 1;
  planId: string;
  values: PlannerRevisionSnapshotValues;
  revision: PlannerIntentRevisionInput;
}

function sanitizeStrArray(v: unknown, max = 40, elemMax = 120): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, elemMax));
  return out.length ? out.slice(0, max) : undefined;
}

function sanitizeDietary(v: unknown): string[] | undefined {
  const arr = sanitizeStrArray(v, 5, 20);
  if (!arr) return undefined;
  // SAFETY: only Halal/Vegan/Vegetarian survive — a legacy medical-allergen
  // value (Nuts/Shellfish/Gluten/Dairy) is dropped, never re-carried.
  const kept = arr.filter(x => (DIETARY_RESTRICTION_VALUES as readonly string[]).includes(x));
  return kept.length ? kept : undefined;
}

function sanitizeMap(v: unknown, max = 10, valMax = 300): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= max) break;
    if (typeof val !== 'string' || !k.trim() || !val.trim()) continue;
    out[k.trim()] = val.trim().slice(0, valMax);
    n++;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeValues(values: Partial<PlannerFormValues>): PlannerRevisionSnapshotValues {
  const out: PlannerRevisionSnapshotValues = {};
  if (sanitizeStrArray(values.regions, 5, 60)) out.regions = sanitizeStrArray(values.regions, 5, 60);
  if (typeof values.cityKey === 'string' && values.cityKey) out.cityKey = values.cityKey.slice(0, 60);
  if (sanitizeStrArray(values.cityKeys, 5, 60)) out.cityKeys = sanitizeStrArray(values.cityKeys, 5, 60);
  if (typeof values.startDate === 'string' && values.startDate) out.startDate = values.startDate.slice(0, 10);
  if (typeof values.endDate === 'string' && values.endDate) out.endDate = values.endDate.slice(0, 10);
  if (sanitizeStrArray(values.categories, 20, 60)) out.categories = sanitizeStrArray(values.categories, 20, 60);
  if (typeof values.pax === 'number' && Number.isFinite(values.pax)) out.pax = values.pax;
  if (typeof values.arrival_airport === 'string' && values.arrival_airport) out.arrival_airport = values.arrival_airport.slice(0, 10);
  if (typeof values.departure_airport === 'string' && values.departure_airport) out.departure_airport = values.departure_airport.slice(0, 10);
  if (typeof values.arrival_time === 'string' && values.arrival_time) out.arrival_time = values.arrival_time.slice(0, 5);
  if (typeof values.departure_time === 'string' && values.departure_time) out.departure_time = values.departure_time.slice(0, 5);
  if (typeof values.tour_start_time === 'string' && values.tour_start_time) out.tour_start_time = values.tour_start_time.slice(0, 5);
  if (typeof values.tour_end_time === 'string' && values.tour_end_time) out.tour_end_time = values.tour_end_time.slice(0, 5);
  if (typeof values.hotel_address === 'string' && values.hotel_address) out.hotel_address = values.hotel_address.slice(0, 300);
  const hotelByCity = sanitizeMap(values.hotelByCity);
  if (hotelByCity) out.hotelByCity = hotelByCity;
  if (typeof values.recommended_zone === 'string' && values.recommended_zone) out.recommended_zone = values.recommended_zone.slice(0, 120);
  const recommendedZones = sanitizeMap(values.recommended_zones, 10, 120);
  if (recommendedZones) out.recommended_zones = recommendedZones;
  if (typeof values.arrival_city === 'string' && values.arrival_city) out.arrival_city = values.arrival_city.slice(0, 60);
  if (typeof values.departure_city === 'string' && values.departure_city) out.departure_city = values.departure_city.slice(0, 60);
  if (typeof values.entry_city === 'string' && values.entry_city) out.entry_city = values.entry_city.slice(0, 60);
  if (values.reservation_status) out.reservation_status = values.reservation_status;
  if (typeof values.tourPace === 'string' && values.tourPace) out.tourPace = values.tourPace;
  if (sanitizeStrArray(values.dietPrefs, 10, 60)) out.dietPrefs = sanitizeStrArray(values.dietPrefs, 10, 60);
  const dietaryRestrictions = sanitizeDietary(values.dietaryRestrictions);
  if (dietaryRestrictions) out.dietaryRestrictions = dietaryRestrictions;
  if (typeof values.priceRange === 'string' && values.priceRange) out.priceRange = values.priceRange;
  if (typeof values.spiceLevel === 'string' && values.spiceLevel) out.spiceLevel = values.spiceLevel;
  if (sanitizeStrArray(values.bucketDishes, 10, 60)) out.bucketDishes = sanitizeStrArray(values.bucketDishes, 10, 60);
  if (values.luggage && typeof values.luggage === 'object') {
    const { small, medium, large } = values.luggage;
    out.luggage = { small: Number(small) || 0, medium: Number(medium) || 0, large: Number(large) || 0 };
  }
  if (typeof values.companions === 'string' && values.companions) out.companions = values.companions;
  if (typeof values.wantAccom === 'boolean') out.wantAccom = values.wantAccom;
  if (typeof values.accomBudget === 'string' && values.accomBudget) out.accomBudget = values.accomBudget;
  if (typeof values.freeText === 'string' && values.freeText.trim()) out.freeText = values.freeText.trim().slice(0, SPECIAL_REQUEST_MAX);
  return out;
}

/** RevisionCard calls this right before `window.location.href = '/planner?...'`. */
export function writePlannerRevisionSnapshot(
  planId: string,
  values: Partial<PlannerFormValues>,
  revision?: PlannerIntentRevisionInput | null,
): void {
  if (!planId) return;
  const snapshot: PlannerRevisionSnapshotV1 = {
    version: REVISION_SNAPSHOT_VERSION,
    planId,
    values: sanitizeValues(values),
    revision: {
      reasonCodes: Array.isArray(revision?.reasonCodes) ? revision!.reasonCodes : (revision?.reasonCodes ? [revision.reasonCodes as string] : []),
      note: typeof revision?.note === 'string' ? revision.note.slice(0, INTENT_LIMITS.revisionNote) : '',
      avoidStopNames: Array.isArray(revision?.avoidStopNames) ? revision!.avoidStopNames : (revision?.avoidStopNames ? String(revision.avoidStopNames).split(',') : []),
    },
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // private mode / quota / SSR — the URL query-param fallback still carries
    // the traveler through; losing the richer snapshot is not fatal.
  }
}

/**
 * PlannerPage/Wizard calls this once on mount with the `planId` it read from
 * the URL. Returns null for: no snapshot, malformed JSON, wrong version, or
 * (critically) a planId that doesn't match — a stale snapshot from a
 * DIFFERENT plan must never populate this one.
 */
export function readPlannerRevisionSnapshot(expectedPlanId: string): PlannerRevisionSnapshotV1 | null {
  if (!expectedPlanId) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlannerRevisionSnapshotV1>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== REVISION_SNAPSHOT_VERSION) return null;
    if (parsed.planId !== expectedPlanId) return null;
    if (!parsed.values || typeof parsed.values !== 'object') return null;
    return {
      version: REVISION_SNAPSHOT_VERSION,
      planId: parsed.planId,
      values: parsed.values,
      revision: parsed.revision && typeof parsed.revision === 'object' ? parsed.revision : { reasonCodes: [], note: '', avoidStopNames: [] },
    };
  } catch {
    return null;
  }
}

export function clearPlannerRevisionSnapshot(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* private mode / SSR — nothing to clear */ }
}
