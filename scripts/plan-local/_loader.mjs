/**
 * Node 20+ ESM loader for the offline planner harness.
 * Only redirects the explicit live-service boundaries used by run.mjs.
 */

let mockUrls = null;

export function initialize(data) {
  mockUrls = data;
}

export async function resolve(specifier, context, nextResolve) {
  if (!mockUrls) {
    throw new Error('PLAN_LOCAL_LOADER_NOT_INITIALIZED');
  }

  // RouteAgent / external HTTP calls are satisfied by fixture coordinates.
  if (specifier === 'axios') {
    return { url: mockUrls.axiosMockUrl, shortCircuit: true };
  }

  const resolved = await nextResolve(specifier, context);
  const url = resolved.url;

  if (/[\\/]api[\\/]_ai_core[\\/]firestoreAdmin\.js$/.test(url)
      || /[\\/]api[\\/]_shared[\\/]firebase-admin\.js$/.test(url)) {
    return { url: mockUrls.firestoreAdminMockUrl, shortCircuit: true };
  }

  if (/[\\/]api[\\/]_transit_provider\.js$/.test(url)) {
    return { url: mockUrls.transitProviderMockUrl, shortCircuit: true };
  }

  return resolved;
}
