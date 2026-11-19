/**
 * 2026-11-18 (review): the airport cards' night-bus check must work on multi-day trips.
 *   `departure_time` reaches RouteAgent only for 1-day trips (meal cap), so the departure card had no
 *   time on every real trip. Runs the real enrichItineraryWithRoute → RouteAgent offline and records
 *   what `_routeAirportHotel` receives and what TMAP would be asked (avoidNightBus).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const transitCalls = vi.hoisted(() => [] as Array<{ ex: number; ey: number; sx: number; sy: number; opts: { avoidNightBus?: boolean; departDttm?: string } }>);
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({
  searchTransit: vi.fn(async (sx: number, sy: number, ex: number, ey: number, opts = {}) => { transitCalls.push({ sx, sy, ex, ey, opts }); return null; }),
  getTransitProvider: () => 'tmap',
}));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { airportPoint } from '../../api/_ai_core/constants.js';

type Stop = Record<string, unknown>;
const P = { lat: 37.5636, lng: 126.9826 };
const day = (d: number, stops: Stop[]) => ({ day: d, city: 'seoul', stops });
const hotel = (t: string) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P });
const sight = (t: string, n: number) => ({ category: 'culture', name: `Sight ${n}`, start_time: t, stay_min: 60, lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });

let cardSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  transitCalls.length = 0;
  process.env.ROUTE_TSP_ENABLED = 'false';
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 }); // _routeAirportHotel waits 1s before its retry
  cardSpy = vi.spyOn(RouteAgent.prototype, '_routeAirportHotel');
});
afterEach(() => { cardSpy.mockRestore(); vi.useRealTimers(); delete process.env.ROUTE_TSP_ENABLED; });

async function run(body: Record<string, unknown>, day1: Stop[] = [hotel('15:00'), sight('16:00', 1), hotel('20:00')], dates?: string[]) {
  const itinerary: { days: Array<Record<string, unknown>>; [k: string]: unknown } = { days: [
    day(1, day1),
    day(2, [hotel('09:00'), sight('10:00', 2), sight('13:00', 3), hotel('19:00')]),
    day(3, [hotel('08:00'), sight('09:00', 4)]),
  ].map((d, i) => (dates ? { ...d, date: dates[i] } : d)), departure_guide: { airport: 'ICN_T1' }, arrival_guide: {} };
  await enrichItineraryWithRoute(itinerary, {
    apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', recommendedZone: 'myeongdong', ...body },
    language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null,
  });
  return itinerary;
}
const card = (direction: string) => cardSpy.mock.calls.find((c) => c[2] === direction) as unknown[] | undefined;
const ap = airportPoint('ICN_T1') as { lat: number; lng: number };
const tmapOpts = (toAirport: boolean) => transitCalls
  .filter((c) => (toAirport ? c.ex === ap.lng && c.ey === ap.lat : c.sx === ap.lng && c.sy === ap.lat))
  .map((c) => c.opts.avoidNightBus);

describe('hotel legs with no transit (API down, or only night buses by day)', () => {
  it('become walk/taxi legs in the traveller language, not a "subway" card with a car time', async () => {
    const it2 = await run({ departure_time: '15:00', arrival_time: '14:00' });
    const legs = it2.days.flatMap((d) => [d.lodging_to_first, d.last_to_lodging]).filter(Boolean) as Array<Record<string, unknown>>;
    // Short legs (<1.5 km) are already turned into a walk by _getTransitData; longer ones hit the fallback.
    const fallback = legs.filter((l) => l.source === 'naver_fallback');
    expect(fallback.length).toBeGreaterThan(0);
    for (const leg of legs) expect(leg.method === 'subway' && !(leg.steps_detail as unknown[])?.length).toBe(false);
    for (const leg of fallback) {
      expect(['walk', 'taxi']).toContain(leg.method);
      expect(String((leg.step_by_step as string[])[0])).not.toMatch(/[가-힣]/); // English trip → no Korean step
      expect(typeof leg.anchor_lat).toBe('number'); // day hotel anchor kept (UI labels which hotel)
    }
  });
});

describe('airport cards carry flight-based times on a 3-day trip', () => {
  it('15:00 flight → hotel leaves before noon → TMAP asked to skip night buses', async () => {
    await run({ departure_time: '15:00', arrival_time: '14:00' });
    const dep = card('departure');
    expect(dep).toBeTruthy();
    const leave = (dep![3] as { leave?: string }).leave;
    expect(leave).toMatch(/^1[01]:\d{2}$/); // 15:00 − 180 − transfer
    expect(tmapOpts(true)).toContain(true);
    expect(tmapOpts(true)).not.toContain(false);
  });
  it('08:00 flight → hotel leaves before 05:00 → night bus allowed (N6701)', async () => {
    await run({ departure_time: '08:00', arrival_time: '14:00' });
    expect(((card('departure')![3]) as { leave?: string }).leave).toMatch(/^0[0-4]:\d{2}$/);
    expect(tmapOpts(true)).not.toContain(true);
  });
  it('arrival card: 14:00 landing skips night buses, 23:30 landing allows them', async () => {
    await run({ departure_time: '15:00', arrival_time: '14:00' });
    expect(((card('arrival')![3]) as { leave?: string }).leave).toBe('15:30');
    expect(tmapOpts(false)).toContain(true);
    transitCalls.length = 0; cardSpy.mockClear();
    await run({ departure_time: '15:00', arrival_time: '23:30' }, [hotel('23:59')]); // late landing: hotel only
    expect(((card('arrival')![3]) as { leave?: string }).leave).toBe('01:00');
    expect(tmapOpts(false)).not.toContain(true);
  });
});

describe('2026-11-19: dated trip → TMAP gets the real departure of each leg (running flags)', () => {
  const DATES = ['2026-12-01', '2026-12-02', '2026-12-03'];
  const dttms = (toAirport: boolean) => transitCalls
    .filter((c) => (toAirport ? c.ex === ap.lng && c.ey === ap.lat : c.sx === ap.lng && c.sy === ap.lat))
    .map((c) => c.opts.departDttm);
  it('departure card is dated on the last day, arrival card on day 1', async () => {
    await run({ departure_time: '15:00', arrival_time: '14:00' }, undefined, DATES);
    expect(dttms(true).length).toBeGreaterThan(0);
    for (const d of dttms(true)) expect(d).toMatch(/^202612031[01][0-5][0-9]$/); // 15:00 − 180 − transfer, on day 3
    expect(dttms(false)).toContain('202612011530');
  });
  it('23:30 landing → leaves the airport 01:00 the next day', async () => {
    await run({ departure_time: '15:00', arrival_time: '23:30' }, [hotel('23:59')], DATES);
    expect(dttms(false)).toContain('202612020100');
  });
  it('stop-to-stop legs carry the date of their own day', async () => {
    await run({ departure_time: '15:00', arrival_time: '14:00' }, undefined, DATES);
    const legDates = transitCalls.filter((c) => !(c.ex === ap.lng && c.ey === ap.lat) && !(c.sx === ap.lng && c.sy === ap.lat))
      .map((c) => String(c.opts.departDttm || '').slice(0, 8));
    expect(legDates).toContain('20261201');
    expect(legDates).toContain('20261202');
    expect(legDates).toContain('20261203');
    expect(legDates).not.toContain(''); // every timed leg is dated
  });
  it('undated trip → no departDttm anywhere (generation-time search, as before)', async () => {
    await run({ departure_time: '15:00', arrival_time: '14:00' });
    expect(transitCalls.length).toBeGreaterThan(0);
    for (const c of transitCalls) expect(c.opts.departDttm).toBeUndefined();
  });
});
