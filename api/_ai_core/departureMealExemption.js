import { departureActivityDeadlineMin, resolveDepartureTime, resolveArrivalTime, resolveTourStartTime, hhmmToMin, singleDayMealWindows } from './constants.js';
import { strictHHMMToMin } from '../../src/lib/arrivalRestRules.js';

// A conservative proof: the real meal cannot finish even with zero travel and no sightseeing.
// This does not change meal roles, shorten stays, or excuse a merely inconvenient placement.
export function departureMealContext(input = {}, cityKey, durationDays = input.durationDays) {
  if (Number(durationDays) !== 1) return null;
  const departureTime = resolveDepartureTime(input);
  const departureMin = strictHHMMToMin(departureTime);
  if (departureMin === null) return null;
  const airport = input.departure_airport || input.departureAirport || input.arrival_airport || input.arrivalAirport;
  const arrivalAirport = input.arrival_airport || input.arrivalAirport;
  // RouteAgent (r3-9) adds no immigration/airport-transit estimate for an empty or ALREADY/already_in_korea airport — the arrival
  // minute itself is the ready time. Use that same earlier bound so the proof stays conservative (main readiness rules unchanged).
  const arrivalAirportKey = String(arrivalAirport || '').trim();
  const noAirport = !arrivalAirportKey || /^(already|already_in_korea)$/i.test(arrivalAirportKey);
  const rawReady = Math.max(hhmmToMin(resolveTourStartTime(input)), hhmmToMin(resolveArrivalTime(input)));
  const earliestStart = `${String(Math.floor(rawReady / 60)).padStart(2, '0')}:${String(rawReady % 60).padStart(2, '0')}`;
  return {
    deadline: departureActivityDeadlineMin(departureMin, airport, cityKey),
    windows: singleDayMealWindows({ ...input, durationDays: 1, cityKey,
      arrivalTime: noAirport ? undefined : resolveArrivalTime(input), arrivalAirport,
      departureTime, departureAirport: airport, tourStartTime: noAirport ? earliestStart : resolveTourStartTime(input),
      tourEndTime: input.tourEndTime || input.tour_end_time }),
  };
}

export function proveDepartureMealExemption(role, stayValue, context) {
  if (role !== 'lunch' && role !== 'dinner') return null;
  const window = context?.windows?.[role];
  const from = strictHHMMToMin(window?.from);
  const stay = Number(stayValue);
  if (from === null || !Number.isFinite(context?.deadline) || !Number.isFinite(stay) || stay <= 0 || stay > 1440) return null;
  return from + stay > context.deadline ? { from: window.from, stay } : null;
}

export function recordDepartureMealExemption(day, role, basis, stop) {
  day._routeMealRemoved = true;
  day.exempt_meals = [...new Set([...(Array.isArray(day.exempt_meals) ? day.exempt_meals : []), role])];
  day.exempt_meal_basis = { ...(day.exempt_meal_basis || {}), [role]: { ...basis,
    ...(stop ? { name: stop.name || stop.display_name || '', source_block_id: stop.source_block_id || '' } : {}) } };
}

// Called before block caps can discard the original restaurant. No schedule/role is rewritten.
export function exemptImpossibleDepartureMeals(stops, context, rolesByStop = new Map()) {
  const day = {};
  if (!context || !Array.isArray(stops)) return day;
  const groups = new Map();
  for (const stop of stops) {
    if (stop.category !== 'food') continue;
    const minute = strictHHMMToMin(stop.start_time);
    if (rolesByStop.get(stop) === 'cafe' || rolesByStop.get(stop) === 'breakfast') continue;
    const role = minute !== null && minute >= 660 ? (minute < 1020 ? 'lunch' : 'dinner') : null;
    if (role !== 'lunch' && role !== 'dinner') continue;
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(stop);
  }
  for (const [role, candidates] of groups) {
    const proofs = candidates.map((stop) => proveDepartureMealExemption(role, stop.stay_min, context));
    // A shorter restaurant in the same role may still fit: do not excuse that meal.
    if (proofs.some((proof) => !proof)) continue;
    candidates.forEach((stop, i) => {
      recordDepartureMealExemption(day, role, proofs[i], stop);
      stops.splice(stops.indexOf(stop), 1);
    });
  }
  return day;
}
