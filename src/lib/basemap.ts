/**
 * CARTO basemap (Leaflet raster tiles) — single source for the 3 maps (DayRouteMap, CourseMiniMap,
 * MoodShareRouteMap).
 *
 * 2026-09-29 CARTO terms change: tiles now REQUIRE a key; without one the CDN answers HTTP 200 with an
 * "API KEY REQUIRED" placeholder image (verified 2026-10-11 — production maps were blank). Commercial use is
 * free up to 1M requests/month; the key is a public (browser) key, so it lives in `VITE_CARTO_API_KEY`
 * (🌐 Vercel env, Production + Preview) and should be domain-restricted in the CARTO dashboard.
 * Attribution "© OpenStreetMap contributors © CARTO" is mandatory on every tier.
 *
 * Static `import.meta.env.VITE_…` access only (never dynamic keys — 2026-08-03 bundle leak incident).
 */
const KEY = (import.meta.env.VITE_CARTO_API_KEY as string | undefined)?.trim() || '';

/** Builds the tile URL; the new CARTO template has no `{s}` subdomain. */
export function buildCartoTileUrl(key: string = KEY, style = 'voyager'): string {
  const base = `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png`;
  return key ? `${base}?key=${encodeURIComponent(key)}` : base;
}

export const CARTO_VOYAGER_URL = buildCartoTileUrl();
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
export const CARTO_TILE_OPTIONS = { maxZoom: 20, attribution: CARTO_ATTRIBUTION } as const;
export const cartoKeyConfigured = (): boolean => KEY.length > 0;

if (import.meta.env.DEV && !KEY) {
  console.warn('[basemap] VITE_CARTO_API_KEY is not set — CARTO returns "API KEY REQUIRED" tiles (blank map).');
}
