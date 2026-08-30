import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchBestExternalRating,
  fetchGooglePlacesRating,
  hasAnyExternalReviewKey,
} from '../../src/lib/external-reviews';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

function runtimeSourceFiles(directory: string): string[] {
  const absolute = resolve(ROOT, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return runtimeSourceFiles(relative);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

const RUNTIME_SURFACES = [
  'src/pages/PlanDetailPage/components/StopCard.tsx',
  'src/pages/PlanDetailPage/components/TripHighlights.tsx',
  'src/pages/PlanDetailPage/pdfGenerator.ts',
  'src/lib/external-reviews.ts',
  'src/hooks/useTourRating.ts',
];

describe('Google Places frontend/PDF runtime hard-stop', () => {
  it.each(RUNTIME_SURFACES)('%s has no Google Places request wiring', (path) => {
    const source = read(path);
    expect(source).not.toContain('/api/place-photo');
    expect(source).not.toContain('places.googleapis.com');
    expect(source).not.toContain('VITE_GOOGLE_PLACES_API_KEY');
  });

  it('photo_ref remains out of the rendering and PDF surfaces', () => {
    for (const path of RUNTIME_SURFACES.slice(0, 3)) {
      expect(read(path)).not.toContain('photo_ref');
    }
  });

  it('external review compatibility exports are deterministic no-ops', async () => {
    expect(hasAnyExternalReviewKey()).toBe(false);
    await expect(fetchGooglePlacesRating('legacy-place-id')).resolves.toBeNull();
    await expect(fetchBestExternalRating({ googlePlaceId: 'legacy-place-id' })).resolves.toBeNull();
  });

  it('keeps all web and API runtime source free of billable Google Maps Platform wiring', () => {
    const forbidden = [
      /maps\.googleapis\.com/i,
      /places\.googleapis\.com/i,
      /\b(?:VITE_)?GOOGLE_(?:MAPS|PLACES)_API_KEY\b/,
      /@googlemaps\//i,
      /\bgoogle\.maps\./,
    ];
    const violations = [...runtimeSourceFiles('src'), ...runtimeSourceFiles('api')]
      .flatMap((path) => forbidden
        .filter((pattern) => pattern.test(read(path)))
        .map((pattern) => `${path}: ${pattern}`));

    for (const path of runtimeSourceFiles('src')) {
      if (/\/api\/place-photo(?:[/?'"`]|$)/.test(read(path))) {
        violations.push(`${path}: legacy place-photo endpoint`);
      }
    }

    expect(violations).toEqual([]);
  });
});
