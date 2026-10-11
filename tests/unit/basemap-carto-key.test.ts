/**
 * 2026-10-11 — CARTO basemap tiles require a key since 2026-09-29 (unkeyed requests get an
 * "API KEY REQUIRED" placeholder → blank production maps). All three Leaflet maps must build their tile URL
 * through src/lib/basemap.ts so the key is applied in exactly one place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCartoTileUrl, CARTO_ATTRIBUTION } from '../../src/lib/basemap';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const MAPS = [
  'src/pages/PlanDetailPage/components/DayRouteMap.tsx',
  'src/pages/PlannerPage/components/courseBuilder/CourseMiniMap.tsx',
  'src/components/mood/MoodShareRouteMap.tsx',
];

describe('CARTO tile URL', () => {
  it('without a key: new template, no {s} subdomain, no query', () => {
    expect(buildCartoTileUrl('')).toBe('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png');
  });
  it('with a key: ?key= appended and URL-encoded', () => {
    expect(buildCartoTileUrl('abc 123')).toBe('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abc%20123');
  });
  it('attribution names both OpenStreetMap contributors and CARTO (mandatory on every tier)', () => {
    expect(CARTO_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(CARTO_ATTRIBUTION).toMatch(/CARTO/);
  });
});

describe('every map goes through src/lib/basemap', () => {
  it.each(MAPS)('%s imports the shared URL and has no literal cartocdn host', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '@\/lib\/basemap'/);
    expect(src).not.toMatch(/basemaps\.cartocdn\.com/);
    expect(src).not.toMatch(/subdomains:\s*'abcd'/);
  });
});
