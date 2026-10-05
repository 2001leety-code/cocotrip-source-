import type { TourStop } from '@/data/tours';
import { TOUR_ROUTE_EDITORIAL_IDS } from '@/pages/tourRouteEditorial';

function minuteOfDay(value: string): number | null {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Editorial tours have public clock times only when every listed arrival can
 * follow the previous stop's published stay and transit estimate.
 * Non-editorial tours keep their existing timing presentation.
 */
export function hasReliableEditorialTiming(
  tourId: string,
  stops: TourStop[],
  durationHours?: number,
  durationDays?: number,
): boolean {
  if (!TOUR_ROUTE_EDITORIAL_IDS.includes(tourId)) return true;
  if (
    stops.length < 2
    || durationDays !== 1
    || !Number.isFinite(durationHours)
    || (durationHours || 0) <= 0
    || (durationHours || 0) > 24
  ) return false;

  const arrivals = stops.map((stop) => minuteOfDay(stop.time));
  if (arrivals.some((arrival) => arrival === null)) return false;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    if (!Number.isFinite(stop.stay_min) || stop.stay_min < 0) return false;

    if (index === 0) continue;
    const previous = stops[index - 1];
    const transit = stop.transit_from_prev;
    if (!transit || !Number.isFinite(transit.minutes) || transit.minutes < 0) return false;

    const previousArrival = arrivals[index - 1] as number;
    const arrival = arrivals[index] as number;
    if (arrival < previousArrival + previous.stay_min + transit.minutes) return false;
  }

  const firstArrival = arrivals[0] as number;
  const lastArrival = arrivals[arrivals.length - 1] as number;
  const lastStopStay = stops[stops.length - 1].stay_min;
  if (lastArrival + lastStopStay > firstArrival + (durationHours as number) * 60) return false;

  return true;
}
