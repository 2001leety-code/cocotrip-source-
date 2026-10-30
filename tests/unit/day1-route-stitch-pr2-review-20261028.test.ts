import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';

const coords = { lat: 37.5636, lng: 126.9826 };
function saveArtifact(name: string, value: unknown) {
  const dir = process.env.ROUTE_REVIEW_OUTPUT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2));
}
const hotel = (start_time: string) => ({ category: 'lodging', name: 'Hotel', start_time, ...coords });
let transitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  transitSpy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, index: number) => ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { transitSpy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED; });

describe('PR2 independent review regressions', () => {
  it('keeps removing sightseeing until a dense late day actually fits', async () => {
    const sights = Array.from({ length: 12 }, (_, i) => ({ category: 'culture', name: `Sight ${i + 1}`, start_time: '21:00', stay_min: 180, lat: coords.lat + 0.004 * (i + 1), lng: coords.lng + 0.004 * (i + 1) }));
    const data = { itinerary: { days: [
      { day: 1, city: 'seoul', stops: [hotel('09:00')] },
      { day: 2, city: 'seoul', stops: [hotel('20:00'), ...sights, { category: 'food', name: 'Late dinner', start_time: '22:00', stay_min: 60, ...coords }, hotel('23:00')] },
    ] }, regions: ['seoul'], area: 'seoul', language: 'en' };
    const result = JSON.parse((await new RouteAgent('').call(JSON.stringify(data))).rawOutput);
    saveArtifact('dense-late-day.json', result.itinerary);
    expect(result.itinerary.days[1].stops.map((s: { name: string; start_time: string }) => `${s.name} ${s.start_time}`))
      .toEqual(['Hotel 20:00', 'Late dinner 22:00', 'Hotel 23:25']);
  });

  it('does not restore a stale end_time from the original after route rescheduling', async () => {
    const itinerary = { days: [{ day: 1, city: 'seoul', stops: [hotel('08:00'), { category: 'culture', name: 'Palace', start_time: '08:30', end_time: '09:30', stay_min: 60, lat: coords.lat + 0.004, lng: coords.lng + 0.004 }, hotel('20:00')] }] };
    await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], tourStartTime: '12:00', language: 'en' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    saveArtifact('stale-end-time.json', itinerary);
    const palace = itinerary.days[0].stops.find((s) => s.name === 'Palace')!;
    expect(palace.start_time).toBe('12:00');
    expect(palace.end_time).toBeUndefined();
  });
  it('does not remove a legacy airport_transfer stop as sightseeing to resolve midnight', async () => {
    const data = { itinerary: { days: [
      { day: 1, city: 'seoul', stops: [hotel('09:00')] },
      { day: 2, city: 'seoul', stops: [hotel('22:00'), { category: 'airport_transfer', name: 'Airport transfer', start_time: '23:20', stay_min: 60, ...coords }, hotel('23:00')] },
    ] }, regions: ['seoul'], area: 'seoul', language: 'en' };
    const call = new RouteAgent('').call(JSON.stringify(data)).then((result: { rawOutput: string }) => {
      saveArtifact('legacy-airport-transfer.json', JSON.parse(result.rawOutput).itinerary);
      return result;
    }, (error: { code?: string; statusCode?: number; stage?: string; message?: string; details?: unknown }) => {
      saveArtifact('airport-transfer-422.json', { code: error.code, statusCode: error.statusCode, stage: error.stage, message: error.message, details: error.details });
      throw error;
    });
    await expect(call).rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE', statusCode: 422 });
  });
});
