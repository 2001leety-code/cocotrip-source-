/**
 * 2026-11-18: Seoul night (N) buses run roughly 23:30–04:00, yet TMAP ranked N16/N73 first for
 * 18:35 and 20:26 legs (prod vegan plan e00efd46 day 1). Daytime legs ask TMAP for a candidate
 * without one (`searchTransitRouteTmap(..., { avoidNightBus })`); a leg whose time is unknown keeps
 * whatever TMAP ranks first.
 *
 * The test is on the leaving time. When only the arrival is known (hotel or temp objects carry no
 * times), the leg is assumed to take ASSUMED_LEG_MIN, or ASSUMED_AIRPORT_LEG_MIN to/from an airport
 * — so an 06:30 airport arrival reads as leaving 04:30 and keeps the departure-morning N6701.
 *
 * 2026-11-19: TMAP flags each leg running (service 1) or not (0) at searchDttm, but we sent the
 * generation time. transitLegOpts adds the leg's real departure so those flags fit the trip; which
 * flags are trusted is decided in _tmap_helper.js (itineraryNotRunning).
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
const ASSUMED_LEG_MIN = 60;
const ASSUMED_AIRPORT_LEG_MIN = 120;
const DAY_MIN = 24 * 60;

const toMin = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** "HH:MM" moved by deltaMin, wrapping past midnight; null when the input is not "HH:MM". */
export function shiftHHMM(hhmm, deltaMin) {
  const min = toMin(hhmm);
  if (min === null) return null;
  const t = (((min + deltaMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Leaving time of the leg, in minutes. At generation time end_time is not filled yet
 * (planPersister fills it later) and recalc-transit moves start_time without touching end_time,
 * so start_time + an explicit stay_min wins; then end_time; then the next stop's start minus the
 * assumed leg time; then the stop's own start.
 */
function leavingMin(prev, curr, airport) {
  const start = toMin(prev?.start_time);
  const stay = prev?.stay_min;
  if (start !== null && stay !== null && stay !== undefined && stay !== '' && Number.isFinite(Number(stay))) {
    return start + Math.max(0, Math.floor(Number(stay)));
  }
  const end = toMin(prev?.end_time);
  if (end !== null) return end;
  const arrive = toMin(curr?.start_time);
  if (arrive !== null) return arrive - (airport ? ASSUMED_AIRPORT_LEG_MIN : ASSUMED_LEG_MIN);
  return start;
}

/**
 * Should this leg skip night-bus candidates?
 * @param {{category?: string, name?: string, start_time?: string, end_time?: string, stay_min?: number|string, _departure_airport_stop?: boolean}|null} prev
 * @param {{category?: string, name?: string, start_time?: string, _departure_airport_stop?: boolean}|null} curr
 * @returns {boolean}
 */
export function legAvoidsNightBus(prev, curr) {
  return transitLegOpts(prev, curr).avoidNightBus;
}

/**
 * Calendar day "YYYY-MM-DD" + minutes from its 00:00 (negative = day before, ≥ 1440 = day after)
 * → the real { date, hhmm }. null when the day is not a real date or the minutes are not finite.
 */
export function clockAt(ymd, min) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd == null ? '' : ymd).trim());
  if (!m || !Number.isFinite(min)) return null;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(base);
  if (d.getUTCMonth() + 1 !== Number(m[2]) || d.getUTCDate() !== Number(m[3])) return null; // 2026-02-30, 2026-13-01
  const t = new Date(base + Math.floor(min) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`, hhmm: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}` };
}

/**
 * TMAP options for one leg of a day: the night-bus check plus, when the day's date and the leaving
 * time are known, the real departure (`departDttm`, yyyymmddhhmi) so TMAP's per-leg running flags
 * describe the actual trip instead of the moment the plan was generated.
 * @param {object|null} prev
 * @param {object|null} curr
 * @param {string|null|undefined} ymd  "YYYY-MM-DD" of the day the leg starts on
 * @returns {{avoidNightBus: boolean, departDttm?: string}}
 */
export function transitLegOpts(prev, curr, ymd) {
  const min = leavingMin(prev, curr, isAirportStop(prev) || isAirportStop(curr));
  const at = min === null ? null : clockAt(ymd, min);
  return {
    avoidNightBus: min !== null && min >= DAY_FROM_MIN && min < DAY_UNTIL_MIN,
    ...(at ? { departDttm: at.date.replace(/-/g, '') + at.hhmm.replace(':', '') } : {}),
  };
}
