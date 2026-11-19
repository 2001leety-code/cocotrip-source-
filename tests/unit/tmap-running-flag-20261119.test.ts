/**
 * 2026-11-19: TMAP flags each transit leg running (`service` 1) or not (0) at searchDttm — the prod
 * N16 (18:35) / N73 (20:26) legs came back first with service 0. We now send the leg's real
 * departure (day date + leaving time) and skip candidates with a bus TMAP flags not running.
 *
 * Which flags are trusted comes from ~50 live TMAP calls on 2026-11-19 (shapes below copy them):
 *   · BUS, 05:00–23:59: right — N73 0 at 20:26 / 1 at 23:40; commuter 8101 (07:30–08:05 only) 0 at 13:00;
 *     Jeju/Busan/Daegu/Gyeongju/Gangneung buses 1 by day. A stopped main bus is skipped even if a Lane
 *     alternative runs (the card shows the main route).
 *   · 00:00–04:59: unusable (00:30–03:00 every leg 0, running N73 included; 04:00 mixed) → ignored.
 *   · Rail: 0 by day for Line 1 local / AREX all-stop / Sinbundang, which run → never used.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { itineraryNotRunning, searchTransitRouteTmap } from '../../api/_tmap_helper.js';
import { clockAt, transitLegOpts } from '../../api/_shared/nightBusLeg.js';

type Lane = { route: string; service?: unknown };
const walk = { mode: 'WALK', sectionTime: 120, distance: 150, start: { name: 'a' }, end: { name: 'b' } };
const bus = (route: string, service: unknown, lanes?: Lane[]) => ({
  mode: 'BUS', sectionTime: 900, distance: 3000, route, service, ...(lanes ? { Lane: lanes } : {}),
  start: { name: 'a' }, end: { name: 'b' }, passStopList: { stationList: [] },
});
const rail = (route: string, service: unknown, lanes?: Lane[]) => ({
  mode: 'SUBWAY', sectionTime: 1200, distance: 6000, route, service, ...(lanes ? { Lane: lanes } : {}),
  start: { name: 'a' }, end: { name: 'b' }, passStopList: { stationList: [] },
});
const itin = (...legs: unknown[]) => ({ pathType: 2, totalTime: 1800, transferCount: 0, totalWalkDistance: 300, totalDistance: 6000, fare: { regular: { totalFare: 1500 } }, legs: [walk, ...legs, walk] });

describe('itineraryNotRunning — which TMAP flags count', () => {
  const DAY = '202612012026';
  it('a bus flagged 0 with no running alternative = not running (N73 at 20:26, 8101 by day)', () => {
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), DAY)).toBe(true);
    expect(itineraryNotRunning(itin(bus('지선:8101', 0, [{ route: '일반:N62', service: 0 }])), DAY)).toBe(true);
    expect(itineraryNotRunning(itin(bus('간선:370', 1, [{ route: 'x', service: 1 }]), bus('지선:8101', 0)), DAY)).toBe(true);
    expect(itineraryNotRunning(itin(bus('순환:TOUR11', '0')), DAY)).toBe(true); // string flag
  });
  it('a running main bus keeps the leg whatever its alternatives say (463 with N16 lane 0)', () => {
    expect(itineraryNotRunning(itin(bus('간선:463', 1, [{ route: '일반:N16', service: 0 }])), DAY)).toBe(false);
    expect(itineraryNotRunning(itin(bus('간선:202', 1)), DAY)).toBe(false);
  });
  it('a stopped main bus is skipped even with a running alternative — the card would name the stopped one', () => {
    // live 23:40: "지선:8101(0)" with Lane N62(1); mapTmapItineraryToRoute shows route 8101.
    expect(itineraryNotRunning(itin(bus('지선:8101', 0, [{ route: '일반:N62', service: 1 }])), '202612012340')).toBe(true);
  });
  it('rail flags are never used (Line 1 local / AREX / Sinbundang read 0 at midday)', () => {
    expect(itineraryNotRunning(itin(rail('수도권1호선', 0, [{ route: '수도권1호선(급행)', service: 1 }])), DAY)).toBe(false);
    expect(itineraryNotRunning(itin(rail('공항철도', 0)), '202612011400')).toBe(false);
    expect(itineraryNotRunning(itin(rail('신분당선', 0), rail('수도권3호선', 1)), '202612011100')).toBe(false);
  });
  it('00:00–04:59 flags are ignored (00:30–03:00 TMAP reads every leg 0, running N73 included)', () => {
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), '202612020030')).toBe(false);
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), '202612020459')).toBe(false);
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), '202612020500')).toBe(true);
    expect(itineraryNotRunning(itin(bus('순환:TOUR11', 0)), '202612012359')).toBe(true);
  });
  it('01:00–04:59: any rail leg = not running, by timetable (no subway / AREX / Korail departures then)', () => {
    expect(itineraryNotRunning(itin(rail('수도권2호선', 1)), '202612020100')).toBe(true);
    expect(itineraryNotRunning(itin(bus('일반:N16', 1), rail('공항철도', 1)), '202612020430')).toBe(true);
    expect(itineraryNotRunning(itin({ ...rail('경부선', 1), mode: 'TRAIN' }), '202612020300')).toBe(true);
    expect(itineraryNotRunning(itin(rail('수도권2호선', 1)), '202612020059')).toBe(false); // last trains still run
    expect(itineraryNotRunning(itin(rail('수도권2호선', 0)), '202612020500')).toBe(false); // first trains; day rail flags unused
    expect(itineraryNotRunning(itin(bus('일반:N16', 0)), '202612020200')).toBe(false); // bus-only: flags still ignored
  });
  it('no real departure, missing flags or junk → false', () => {
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), undefined)).toBe(false);
    expect(itineraryNotRunning(itin(bus('일반:N73', 0)), '20261201')).toBe(false);
    expect(itineraryNotRunning(itin(bus('일반:N73', undefined)), DAY)).toBe(false);
    expect(itineraryNotRunning(itin(bus('일반:N73', null)), DAY)).toBe(false);
    expect(itineraryNotRunning(null, DAY)).toBe(false);
    expect(itineraryNotRunning({}, DAY)).toBe(false);
  });
});

describe('transitLegOpts / clockAt — the real departure of a leg', () => {
  it('prod legs: 18:35 and 20:21 on 2026-12-01', () => {
    expect(transitLegOpts({ end_time: '18:35' }, { start_time: '19:21' }, '2026-12-01')).toEqual({ avoidNightBus: true, departDttm: '202612011835' });
    expect(transitLegOpts({ start_time: '19:30', stay_min: 51 }, { category: 'lodging' }, '2026-12-01')).toEqual({ avoidNightBus: true, departDttm: '202612012021' });
  });
  it('rolls past midnight both ways', () => {
    expect(transitLegOpts({ start_time: '23:30', stay_min: 60 }, {}, '2026-12-01')).toEqual({ avoidNightBus: false, departDttm: '202612020030' });
    expect(transitLegOpts({}, { start_time: '00:30' }, '2026-12-01').departDttm).toBe('202611302330'); // arrival-only: leaves 23:30 the evening before
    expect(clockAt('2026-12-31', 24 * 60 + 5)).toEqual({ date: '2027-01-01', hhmm: '00:05' });
    expect(clockAt('2026-03-01', -60)).toEqual({ date: '2026-02-28', hhmm: '23:00' });
  });
  it('no date or no time → no departDttm (generation-time search, flags unused)', () => {
    expect(transitLegOpts({ end_time: '18:35' }, {}, undefined)).toEqual({ avoidNightBus: true });
    expect(transitLegOpts({ end_time: '18:35' }, {}, '2026-02-30')).toEqual({ avoidNightBus: true });
    expect(transitLegOpts({ end_time: '18:35' }, {}, 'Day 1')).toEqual({ avoidNightBus: true });
    expect(transitLegOpts({}, {}, '2026-12-01')).toEqual({ avoidNightBus: false });
    expect(clockAt('2026-12-01', Number.NaN)).toBe(null);
    expect(clockAt('2026-13-01', 600)).toBe(null);
    expect(clockAt('2026-02-29', 600)).toBe(null);
    expect(clockAt('2028-02-29', 600)).toEqual({ date: '2028-02-29', hhmm: '10:00' });
  });
});

describe('searchTransitRouteTmap — real departure + running flags', () => {
  const ORIGINAL_KEY = process.env.TMAP_APP_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.TMAP_APP_KEY; else process.env.TMAP_APP_KEY = ORIGINAL_KEY;
  });
  const stubTmap = (...answers: unknown[][]) => {
    process.env.TMAP_APP_KEY = 'test-key';
    let n = 0;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metaData: { plan: { itineraries: answers[Math.min(n++, answers.length - 1)] } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const bodyOf = (m: ReturnType<typeof vi.fn>, i: number) => JSON.parse((m.mock.calls[i] as unknown as [string, { body: string }])[1].body);
  const go = (opts: Record<string, unknown>) => searchTransitRouteTmap(127.0070, 37.5652, 126.9784, 37.5666, opts); // 을지로6가 → 시청 (~2.6 km)
  const picked = (r: { steps?: Array<{ busNo?: string; line?: string }> } | null) => (r?.steps || []).map((s) => s.busNo || s.line).filter(Boolean);

  // Live 20:26 answer for the prod N73 leg (first 3): N73 0, 2호선 1, TOUR11 0.
  const N73 = itin(bus('일반:N73', 0));
  const LINE2 = itin(rail('수도권2호선', 1));
  const TOUR11 = itin(bus('순환:TOUR11', 0));

  it('sends the real departure to TMAP', async () => {
    const m = stubTmap([LINE2]);
    await go({ avoidNightBus: true, departDttm: '202612012026' });
    expect(bodyOf(m, 0).searchDttm).toBe('202612012026');
  });
  it('20:26 prod leg → 2호선', async () => {
    stubTmap([N73, LINE2, TOUR11]);
    expect(picked(await go({ avoidNightBus: true, departDttm: '202612012026' }))).toEqual(['수도권2호선']);
  });
  it('23:40 night leg: a dead tour bus is skipped, the running N73 kept', async () => {
    stubTmap([TOUR11, itin(bus('일반:N73', 1)), LINE2]);
    expect(picked(await go({ avoidNightBus: false, departDttm: '202612012340' }))).toEqual(['N73']);
  });
  it('same night leg with no date → TMAP first pick, as before', async () => {
    stubTmap([TOUR11, itin(bus('일반:N73', 1)), LINE2]);
    expect(picked(await go({ avoidNightBus: false }))).toEqual(['TOUR11']);
  });
  it('00:30: everything reads 0 → flags ignored, first pick (N73) kept', async () => {
    stubTmap([N73, itin(rail('수도권2호선', 0))]);
    expect(picked(await go({ avoidNightBus: false, departDttm: '202612020030' }))).toEqual(['N73']);
  });
  it('by day only a commuter bus that has stopped → no transit (callers fall back to walk/car)', async () => {
    const m = stubTmap([itin(bus('지선:8101', 0)), N73]);
    expect(await go({ avoidNightBus: true, departDttm: '202612011300' })).toBe(null);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it('3 unusable → re-query (count 10) with the same real departure', async () => {
    const m = stubTmap([N73, TOUR11, itin(bus('지선:8101', 0))], [N73, TOUR11, itin(bus('지선:8101', 0)), itin(bus('간선:202', 1))]);
    expect(picked(await go({ avoidNightBus: true, departDttm: '202612012026' }))).toEqual(['202']);
    expect(bodyOf(m, 1)).toMatchObject({ count: 10, searchDttm: '202612012026' });
  });
  it('a rail leg TMAP reads 0 by day is still taken (Line 1 local with running express lane)', async () => {
    stubTmap([itin(rail('수도권1호선', 0, [{ route: '수도권1호선(급행)', service: 1 }]))]);
    expect(picked(await go({ avoidNightBus: true, departDttm: '202612011300' }))).toEqual(['수도권1호선']);
  });
  it('only TMAP-known keys go to TMAP', async () => {
    const m = stubTmap([LINE2]);
    await go({ avoidNightBus: true, departDttm: '202612012026' });
    expect(Object.keys(bodyOf(m, 0)).sort()).toEqual(['count', 'endX', 'endY', 'format', 'searchDttm', 'startX', 'startY']);
  });
});
