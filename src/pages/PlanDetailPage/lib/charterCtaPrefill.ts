// charterCtaPrefill.ts -- Charter CTA real-route prefill builder (firebase-free pure module)
// PR-C2 (2026-06-01): day.city / plan.input.area -> region -> destinationKey mapping + URL builder
// Flag OFF (unset) -> returns hardcoded URL (current behavior byte-identical)
//
// WARNING: this file must NOT import firebase / PayPal / React.
// Pure helper used by CharterCTA component -- directly importable in vitest.

/** Minimal stop shape -- no firebase type dependency */
export interface StopLike {
  name?: string;
  name_ko?: string;
  display_name?: string;
  name_en?: string;
}

/** Minimal day shape */
export interface DayLike {
  day?: number;
  date?: string;
  city?: string;
  stops?: StopLike[];
}

/** Minimal plan.input shape */
export interface PlanInputLike {
  area?: string;
  adults?: number;
  pax?: number;
}

// -- Region -> destinationKey mapping --
// Based on RouteAgent.js REGION_TO_CHARTER_PRODUCT + pricing_spec.json daily_tour_prices keys.
// Unmapped region -> undefined (caller applies fallback).
// jeju: no charter product in operator spec -> undefined (fallback: Seoul).
const REGION_TO_DESTINATION_KEY: Record<string, string> = {
  // Seoul / Incheon metro
  seoul: 'seoul-city',
  seoul_city: 'seoul-city',
  incheon: 'seoul-city',
  // Seoul suburb
  seoul_suburb: 'seoul-suburb',
  suwon: 'seoul-suburb',
  nami: 'seoul-suburb',
  // DMZ
  dmz: 'dmz',
  // Gangwon
  gangwon: 'gangwon',
  gangneung: 'gangwon',
  chuncheon: 'gangwon',
  sokcho: 'gangwon',
  // Ski resort
  pyeongchang: 'ski-resort',
  ski: 'ski-resort',
  // Gyeongju / Jeonju
  gyeongju: 'gyeongju-jeonju',
  jeonju: 'gyeongju-jeonju',
  // Busan area
  busan: 'busan-day',
  yeosu: 'busan-day',
  daegu: 'busan-day',
  // jeju: not registered -- no operator charter product
};

/** Hardcoded fallback origin (Seoul metro) */
const FALLBACK_ORIGIN = 'SEL_METRO';

// -- Region extraction --
/**
 * Extracts region key from PlanDay or plan.input.area.
 * Priority: day.city > planInput.area > undefined
 */
export function extractDayRegion(day: DayLike, planInput?: PlanInputLike): string | undefined {
  const raw = day.city || planInput?.area;
  if (!raw) return undefined;
  // Normalize: lowercase + underscores (mirrors normalizeRegionKey pattern)
  return String(raw).toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Maps a region string to a daily_tour_prices key (destinationKey).
 * Returns undefined when no mapping exists (caller must handle fallback).
 */
export function regionToDestinationKey(region: string | undefined): string | undefined {
  if (!region) return undefined;
  // Direct lookup
  if (REGION_TO_DESTINATION_KEY[region]) return REGION_TO_DESTINATION_KEY[region];
  // Prefix matching (e.g. busan_city -> busan)
  for (const [key, dest] of Object.entries(REGION_TO_DESTINATION_KEY)) {
    if (region.startsWith(key) || key.startsWith(region)) {
      return dest;
    }
  }
  return undefined;
}

// -- Feature flag --
/**
 * Returns true when VITE_FEATURE_CHARTER_CTA_REALROUTE === 'true'.
 * Vite env vars are strings, so strict === 'true' is required.
 * Always returns false in SSR / plain Node environments.
 */
export function isRealRoutePrefillEnabled(): boolean {
  if (typeof import.meta === 'undefined') return false;
  // Use || not nullish-coalescing to avoid pre-commit guard (env var is always string or undefined)
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_FEATURE_CHARTER_CTA_REALROUTE || '') === 'true';
}

// -- URL builder --

export interface CharterCTAUrlOptions {
  day: DayLike;
  planInput?: PlanInputLike;
  /** tourType from detectCharterRecommendation -- used as fallback destinationKey */
  detectedTourType?: string | null;
  /** pricing.hours from detectCharterRecommendation */
  pricingHours?: number;
  /** Flag override for testing */
  featureEnabled?: boolean;
}

export interface CharterCTAUrlResult {
  url: string;
  /** true when real-route prefill was applied; false = hardcoded fallback */
  isRealRoute: boolean;
  /** The destinationKey that was applied (may be undefined) */
  destinationKey: string | undefined;
}

/**
 * Pure function returning the charter CTA href.
 *
 * Flag OFF -> current hardcoded URL byte-identical (origin=SEL_METRO, service=day_tour)
 * Flag ON  -> day.city/plan.input.area -> destinationKey mapping
 *             -> falls back to detectedTourType on mapping miss
 *             -> falls back to no destinationKey (prevents wrong-region quote)
 */
export function buildCharterCTAUrl(opts: CharterCTAUrlOptions): CharterCTAUrlResult {
  const { day, planInput, detectedTourType, pricingHours, featureEnabled } = opts;

  const enabled = featureEnabled !== undefined ? featureEnabled : isRealRoutePrefillEnabled();

  // Flag OFF: hardcoded behavior byte-identical
  if (!enabled) {
    const qs = new URLSearchParams({
      from: 'planDetail',
      day: String(day.day || 1),
      origin: FALLBACK_ORIGIN,
      service: 'day_tour',
    });
    if (detectedTourType) qs.set('destinationKey', detectedTourType);
    if (pricingHours != null) qs.set('hours', String(pricingHours));
    return { url: `/charter?${qs.toString()}`, isRealRoute: false, destinationKey: detectedTourType || undefined };
  }

  // Flag ON: extract real region -> map -> build URL
  const region = extractDayRegion(day, planInput);
  const mappedKey = regionToDestinationKey(region);
  // Fallback chain: mapped region key -> detectedTourType -> undefined (no destinationKey)
  const destinationKey = mappedKey || detectedTourType || undefined;

  const pax = planInput?.adults || planInput?.pax;

  const qs = new URLSearchParams({
    from: 'planDetail',
    day: String(day.day || 1),
    origin: FALLBACK_ORIGIN,
    service: 'day_tour',
  });
  if (destinationKey) qs.set('destinationKey', destinationKey);
  if (pricingHours != null) qs.set('hours', String(pricingHours));
  if (pax) qs.set('pax', String(pax));
  if (day.date) qs.set('date', day.date);

  return { url: `/charter?${qs.toString()}`, isRealRoute: true, destinationKey };
}
