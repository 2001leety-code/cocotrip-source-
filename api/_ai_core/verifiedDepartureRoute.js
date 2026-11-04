// Request-local transport evidence. Serialized client markers never grant this trust.
const proofs = new WeakMap();
export function registerVerifiedDepartureRoute(target, proof) {
  if (!target || !proof || !Number.isFinite(proof.airportMin) || !Number.isFinite(proof.departureMin)
      || proof.airportMin > proof.departureMin - 180 || !Number.isFinite(proof.travelMin) || proof.travelMin < 0
      || proof.lastEndMin + proof.travelMin + proof.bufferMin > proof.airportMin) throw new Error('INVALID_DEPARTURE_ROUTE_PROOF');
  proofs.set(target, structuredClone(proof));
}
export function verifiedDepartureRoute(target) {
  return proofs.get(target) || ((target?.days?.length === 1) ? proofs.get(target.days[0]) : null) || null;
}
export function verifiedDepartureMealWindows(itinerary) { return verifiedDepartureRoute(itinerary)?.windows || null; }
