/**
 * 2026-11-18: Seoul night (N) buses run roughly 23:30–04:00, yet TMAP ranked N16/N73 first for
 * 18:35 and 20:26 legs (prod vegan plan e00efd46 day 1). Daytime legs ask TMAP for a candidate
 * without one (`searchTransitRouteTmap(..., { avoidNightBus })`); a leg whose time is unknown keeps
 * whatever TMAP ranks first.
 *
 * Airport legs get a narrower window: their only known time is often the airport arrival (the
 * hotel side carries no times), and the departure-morning N6701 to ICN is real — an 06:30 airport
 * arrival means leaving around 05:00, when only night buses run.
 *
 * Own module on purpose: tests and the offline plan harness mock `_transit_provider.js` wholesale,
 * so a pure helper living there would vanish from those mocks.
 *
 * ponytail: one fixed window for every route — per-route first/last runs need the Seoul bus-route
 * API (data.go.kr key not registered for it yet).
 */
import { isAirportStop } from '../../src/lib/airportStop.js'; // same airport rule as RouteAgent / DayTimeline

const DAY_FROM_MIN = 5 * 60;
const DAY_UNTIL_MIN = 23 * 60;
const AIRPORT_DAY_FROM_MIN = 7 * 60;
const AIRPORT_DAY_UNTIL_MIN = 22 * 60;

const toMin = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Leaving time of the leg, in minutes. At generation time end_time is not filled yet
 * (planPersister fills it later) and recalc-transit moves start_time without touching end_time,
 * so start_time + an explicit stay_min wins; then end_time; then the next stop's start; then the
 * stop's own start.
 */
function leavingMin(prev, curr) {
  const start = toMin(prev?.start_time);
  const stay = prev?.stay_min;
  if (start !== null && stay !== null && stay !== undefined && stay !== '' && Number.isFinite(Number(stay))) {
    return start + Math.max(0, Math.floor(Number(stay)));
  }
  for (const t of [prev?.end_time, curr?.start_time]) {
    const m = toMin(t);
    if (m !== null) return m;
  }
  return start;
}

/**
 * Should this stop-to-stop leg skip night-bus candidates?
 * @param {{category?: string, name?: string, start_time?: string, end_time?: string, stay_min?: number|string, _departure_airport_stop?: boolean}|null} prev
 * @param {{category?: string, name?: string, start_time?: string, _departure_airport_stop?: boolean}|null} curr
 * @returns {boolean}
 */
export function legAvoidsNightBus(prev, curr) {
  const min = leavingMin(prev, curr);
  if (min === null) return false;
  const airport = isAirportStop(prev) || isAirportStop(curr);
  return airport
    ? min >= AIRPORT_DAY_FROM_MIN && min < AIRPORT_DAY_UNTIL_MIN
    : min >= DAY_FROM_MIN && min < DAY_UNTIL_MIN;
}
