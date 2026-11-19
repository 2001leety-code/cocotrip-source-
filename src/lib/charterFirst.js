/**
 * When a CocoTrip charter beats a taxi or public transit (2026-11-19, operator decision).
 * Shared by RouteAgent (server) and the plan page (client) so both sides agree.
 *
 *   - Dawn: leaving 23:00–04:59. City rail and airport buses have stopped (or are about to), and a
 *     driver who waits for the flight is easier than finding a taxi.
 *   - Group / luggage: a Korean taxi seats 4 with an LPG tank in the trunk; a charter is a 7–9 seat
 *     Staria. Four people, or luggage beyond a sedan trunk, go by charter.
 *
 * Night legs inside a trip point to WhatsApp instead of a booking: a charter needs the operator
 * awake, so no reply within NIGHT_WHATSAPP_REPLY_MIN minutes means no car — take a taxi.
 */

export const DAWN_FROM_MIN = 23 * 60;
export const DAWN_UNTIL_MIN = 5 * 60;
const DAY_MIN = 24 * 60;

export const COCOTRIP_WHATSAPP_URL = 'https://wa.me/821087140611';
export const NIGHT_WHATSAPP_REPLY_MIN = 20;

// A leg inside the trip with no transit found: from 22:00 the last subway/bus may be gone (RouteAgent's
// existing late-night window for these legs) → the WhatsApp contact line.
export const LATE_NIGHT_LEG_FROM_MIN = 22 * 60;

const inWindow = (min, from) => {
  if (typeof min !== 'number' || !Number.isFinite(min)) return false;
  const m = ((Math.floor(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return m >= from || m < DAWN_UNTIL_MIN;
};

/** Minutes from midnight (any integer, wraps) in the dawn window 23:00–04:59? Non-finite → false. */
export function isDawnMin(min) {
  return inWindow(min, DAWN_FROM_MIN);
}

/** Minutes from midnight in the late-night leg window 22:00–04:59? Non-finite → false. */
export function isLateNightLegMin(min) {
  return inWindow(min, LATE_NIGHT_LEG_FROM_MIN);
}

/**
 * Too many people or bags for a sedan taxi.
 *   pax ≥ 4, ≥ 3 large bags, 3 pax with 2 medium + 1 large, or 8+ bags in all (2 vehicles by
 *   luggageVehicle.calcVehicleCount).
 * @param {{ pax?: number, luggage?: { small?: number, medium?: number, large?: number } | null }} input
 */
export function needsCharterForGroup({ pax, luggage } = {}) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const people = n(pax);
  const large = n(luggage?.large);
  const medium = n(luggage?.medium);
  const small = n(luggage?.small);
  return people >= 4
    || large >= 3
    || (people >= 3 && medium >= 2 && large >= 1)
    || large + medium + small >= 8;
}
