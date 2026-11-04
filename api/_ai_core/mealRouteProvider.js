import { createHash } from 'node:crypto';
import { RouteAgent } from './agents/RouteAgent.js';
import { geocode, resolveNcpKeys } from '../_shared/mood-route.js';

// Share the existing provider hierarchy, but reject its straight-line/blind duration fallback.
export function createMealRouteProvider(override, routeBudget) {
  const memo = new Map();
  const provider = override || (async ({ from, to, departMin }) => {
    const keys = resolveNcpKeys();
    const resolve = async (stop) => {
      if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) return stop;
      if (!stop.address) return null;
      const found = await geocode(stop.address, keys.clientId, keys.clientSecret);
      return found && Number.isFinite(found.lat) && Number.isFinite(found.lng) ? { ...stop, lat: found.lat, lng: found.lng } : null;
    };
    const origin = await resolve(from), destination = await resolve(to);
    if (!origin || !destination) return { status: 'failed', reason: 'coordinates_unknown' };
    const result = await new RouteAgent(null)._getTransitData(origin, destination, keys.clientId, keys.clientSecret, 0, null);
    if (!Number.isFinite(result.verifiedRouteDurationMin)) return { status: 'failed', reason: 'provider_route_unavailable' };
    return { status: 'verified', durationMin: result.verifiedRouteDurationMin, segment: result.verifiedRouteSegment,
      evidenceId: createHash('sha256').update(JSON.stringify([origin.lat, origin.lng, destination.lat, destination.lng,
        departMin, result.verifiedRouteSegment])).digest('hex') };
  });
  return async (request) => {
    const key = JSON.stringify([request.from.lat, request.from.lng, request.from.address, request.to.lat, request.to.lng, request.to.address, request.departMin]);
    if (!memo.has(key)) {
      if (memo.size >= 64) return { status: 'failed', reason: 'request_route_budget' };
      memo.set(key, Promise.resolve().then(() => { routeBudget?.consume(); return provider(request); }).catch(() => ({ status: 'failed', reason: 'provider_unavailable' })));
    }
    return memo.get(key);
  };
}
