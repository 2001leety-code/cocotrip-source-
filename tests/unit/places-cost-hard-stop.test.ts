import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import placePhotoHandler from '../../api/place-photo.js';

const routeAgentSource = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);
const routeEnrichmentSource = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/routeEnrichment.js'),
  'utf8',
);
const placePhotoSource = readFileSync(
  resolve(process.cwd(), 'api/place-photo.js'),
  'utf8',
);
const vercelConfig = JSON.parse(readFileSync(
  resolve(process.cwd(), 'vercel.json'),
  'utf8',
)) as { redirects?: Array<{ source?: string; destination?: string; permanent?: boolean }> };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Places cost hard stop', () => {
  it.each(['production', 'preview', 'development'])(
    'place-photo returns a static SVG without external calls in %s',
    async (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('GOOGLE_PLACES_API_KEY', 'must-not-be-used');
      const externalFetch = vi.fn(() => {
        throw new Error('external fetch must remain unreachable');
      });
      vi.stubGlobal('fetch', externalFetch);

      const response = await placePhotoHandler();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/svg+xml');
      expect(response.headers.get('cache-control')).toContain('s-maxage=31536000');
      expect(await response.text()).toContain('<svg');
      expect(externalFetch).not.toHaveBeenCalled();
    },
  );

  it('place-photo source has no paid provider, key read, or external request path', () => {
    expect(placePhotoSource).not.toContain('maps.googleapis.com');
    expect(placePhotoSource).not.toContain('GOOGLE_PLACES_API_KEY');
    expect(placePhotoSource).not.toMatch(/\bfetch\s*\(/);
  });

  it('Vercel routes legacy photo requests to a static asset before the function fallback', () => {
    expect(vercelConfig.redirects).toContainEqual({
      source: '/api/place-photo',
      destination: '/brand/icon.svg',
      permanent: true,
    });
  });

  it('RouteAgent has no Google Places Text Search or photo enrichment path', () => {
    expect(routeAgentSource).not.toContain('maps.googleapis.com');
    expect(routeAgentSource).not.toContain('GOOGLE_PLACES_API_KEY');
    expect(routeAgentSource).not.toContain('photo_reference');
    expect(routeAgentSource).not.toContain('photo_ref');
  });

  it('route enrichment runtime diagnostics no longer advertise Google Places', () => {
    expect(routeEnrichmentSource).not.toContain('GOOGLE_PLACES');
  });
});
