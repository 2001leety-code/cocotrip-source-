import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { backfillStopEndTimes } from '../../api/_ai_core/planPersister.js';

const coords = { lat: 37.5636, lng: 126.9826 };
const hotel = (start_time: string) => ({ category: 'lodging', name: 'Hotel', start_time, ...coords });

beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, index: number) => ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });

const options = { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null };

describe('PR2 counterexamples', () => {
  it('fails after removing all sights if protected stops still cannot fit before midnight', async () => {
    const sights = Array.from({ length: 12 }, (_, i) => ({ category: 'culture', name: `Sight ${i}`, start_time: '21:00', stay_min: 180, lat: coords.lat + 0.004 * (i + 1), lng: coords.lng + 0.004 * (i + 1) }));
    const data = { itinerary: { days: [
      { day: 1, city: 'seoul', stops: [hotel('09:00')] },
      { day: 2, city: 'seoul', stops: [hotel('22:00'), ...sights, { category: 'airport_transfer', name: 'Transfer', start_time: '23:20', stay_min: 60, ...coords }, hotel('23:00')] },
    ] }, regions: ['seoul'], area: 'seoul', language: 'en' };
    await expect(new RouteAgent('').call(JSON.stringify(data))).rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE', statusCode: 422 });
  });

  it('preserves a valid routed end time after rescheduling and the original reservation metadata', async () => {
    const original = { category: 'culture', name: 'Palace', start_time: '08:30', end_time: '09:30', entry_fee_krw: 5000, reservation_required: true, reservation_note: 'Book ahead' };
    const itinerary = { days: [{ day: 1, city: 'seoul', stops: [original] }] };
    vi.spyOn(RouteAgent.prototype, 'call').mockResolvedValue({ rawOutput: JSON.stringify({ itinerary: { days: [{ stops: [{ _ri: 0, name: 'Palace', start_time: '12:00', end_time: '13:00' }] }] } }) } as never);
    await enrichItineraryWithRoute(itinerary, options);
    expect(itinerary.days[0].stops[0]).toMatchObject({ start_time: '12:00', end_time: '13:00', entry_fee_krw: 5000, reservation_required: true, reservation_note: 'Book ahead' });
  });

  it('preserves the original end time and reservation metadata when the start is unchanged', async () => {
    const original = { category: 'culture', name: 'Palace', start_time: '08:30', end_time: '09:30', entry_fee_krw: 5000, reservation_required: true, reservation_note: 'Book ahead' };
    const itinerary = { days: [{ day: 1, city: 'seoul', stops: [original] }] };
    vi.spyOn(RouteAgent.prototype, 'call').mockResolvedValue({ rawOutput: JSON.stringify({ itinerary: { days: [{ stops: [{ _ri: 0, name: 'Palace', start_time: '08:30' }] }] } }) } as never);
    await enrichItineraryWithRoute(itinerary, options);
    expect(itinerary.days[0].stops[0]).toMatchObject({ start_time: '08:30', end_time: '09:30', entry_fee_krw: 5000, reservation_required: true, reservation_note: 'Book ahead' });
  });

  it('backfills the rescheduled stop end time from its new start and stay', async () => {
    const itinerary = { days: [{ day: 1, city: 'seoul', stops: [hotel('08:00'), { category: 'culture', name: 'Palace', start_time: '08:30', end_time: '09:30', stay_min: 60, lat: coords.lat + 0.004, lng: coords.lng + 0.004 }, hotel('20:00')] }] };
    await enrichItineraryWithRoute(itinerary, { ...options, body: { ...options.body, tourStartTime: '12:00' } });
    backfillStopEndTimes(itinerary);
    const dir = process.env.ROUTE_REVIEW_OUTPUT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      const output = join(dir, 'stale-end-time-backfilled.json');
      if (!existsSync(output)) writeFileSync(output, JSON.stringify(itinerary, null, 2), { flag: 'wx' });
    }
    const palace = itinerary.days[0].stops.find((stop) => stop.name === 'Palace')!;
    expect(palace.start_time).toBe('12:00');
    expect(palace.end_time).toBe('13:00');
  });
  it('protects mixed-case airport transfer stops from sightseeing removal', async () => {
    const data = { itinerary: { days: [
      { day: 1, city: 'seoul', stops: [hotel('09:00')] },
      { day: 2, city: 'seoul', stops: [hotel('22:00'), { category: 'Airport_Transfer', name: 'Airport transfer', start_time: '23:20', stay_min: 60, ...coords }, hotel('23:00')] },
    ] }, regions: ['seoul'], area: 'seoul', language: 'en' };
    await expect(new RouteAgent('').call(JSON.stringify(data))).rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE', statusCode: 422 });
  });
});




