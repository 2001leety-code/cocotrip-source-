/**
 * 2026-11-18: Seoul night (N) buses run roughly 23:30–04:00, yet TMAP ranked N16/N73 first for
 * 18:35 and 20:26 legs (prod vegan plan e00efd46 day 1). Daytime legs ask TMAP for a candidate
 * without one (`searchTransitRouteTmap(..., { avoidNightBus })`). Airport legs keep whatever TMAP
 * ranks first (the departure-morning N6701 to ICN is real), and so does a leg whose time is unknown.
 *
 * Own module on purpose: tests and the offline plan harness mock `_transit_provider.js` wholesale,
 * so a pure helper living there would vanish from those mocks.
 *
 * ponytail: one fixed window for every route — per-route first/last runs need the Seoul bus-route
 * API (data.go.kr key not registered for it yet).
 */
const NIGHT_BUS_FREE_FROM_MIN = 5 * 60;
const NIGHT_BUS_FREE_UNTIL_MIN = 23 * 60;

/**
 * Should this stop-to-stop leg skip night-bus candidates? Uses the leaving time (prev.end_time,
 * else curr.start_time, else prev.start_time) as planned before transit times are stitched.
 * @param {{category?: string, start_time?: string, end_time?: string}|null} prev
 * @param {{category?: string, start_time?: string}|null} curr
 * @returns {boolean}
 */
export function legAvoidsNightBus(prev, curr) {
  if (prev?.category === 'airport' || curr?.category === 'airport') return false;
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(String(prev?.end_time || curr?.start_time || prev?.start_time || '').trim());
  if (!hhmm) return false;
  const min = Number(hhmm[1]) * 60 + Number(hhmm[2]);
  return min >= NIGHT_BUS_FREE_FROM_MIN && min < NIGHT_BUS_FREE_UNTIL_MIN;
}
