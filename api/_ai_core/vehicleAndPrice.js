/**
 * Vehicle selection + per-day pricing (extracted from api/ai-planner-full.js).
 *
 * Why a module: hard-coded vehicle bands and base prices are referenced from
 * multiple places (planner, charter quote, future admin). One source of truth.
 *
 * `selectVehicle` honors an explicit override but otherwise picks by pax band.
 * `calcPrice` multiplies base price by `durationDays` (min 1).
 */

export function selectVehicle(pax, requestedVehicle) {
  if (requestedVehicle && requestedVehicle !== 'auto') return requestedVehicle;
  if (pax <= 8) return 'staria_8';
  if (pax <= 15) return 'sprinter';
  return 'large_bus';
}

const BASE_PRICES_KRW = { staria_8: 330000, sprinter: 450000, large_bus: 650000 };

export function calcPrice(vehicle, durationDays) {
  const base = BASE_PRICES_KRW[vehicle] || BASE_PRICES_KRW.staria_8;
  return base * Math.max(1, durationDays);
}

export const VEHICLE_LABELS = {
  staria_8: 'Staria Van (1-8 pax)',
  sprinter: 'Sprinter (9-15 pax)',
  large_bus: 'Large Bus',
};
