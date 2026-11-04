import { readFileSync } from 'node:fs';
import { AIRPORT_COORDS, AIRPORT_NAMES_KO } from '../../api/_ai_core/constants.js';
import { dietaryEvidenceFor } from '../../api/_shared/dietary-trust.js';
import { isRowCityConsistent } from '../../api/_shared/food-row-provenance.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import failures from '../fixtures/pr3-placement-failures-20261102.json';
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in test'); }, resolveLlmModel: () => 'mock' }));
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { BLOCKS, ARRIVALS0, runOne, setScenario, legMin } from '../helpers/pr3-offline-pipeline';
import { solveDay1BlockSchedule } from '../../api/_ai_core/day1BlockScheduler.js';

afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });

// Independent necessary-condition oracle over ALL trusted city restaurants, zero sightseeing,
// optimistic zero initial travel, actual fixture-direction legs and the unchanged airport buffer.
// No input identity is exempted. A physically impossible request must be refused before payment.
function mealOnlyFeasible(block, arrival, departure, diet) {
  const rows = JSON.parse(readFileSync('api/_food_index.json', 'utf8')).filter((row) => row.city === block.city
    && isRowCityConsistent(row) && (diet === 'none' || dietaryEvidenceFor(row, diet)));
  const min = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const ready = min(arrival.t), airportMin = min(departure) - 180;
  const airportCode = block.city === 'busan' ? 'PUS' : 'ICN_T1';
  const airport = { ...AIRPORT_COORDS[airportCode], name: AIRPORT_NAMES_KO[airportCode] };
  const roles = [[660, 1019], [1020, 1319]].filter(([from]) => Math.max(ready, from) + 60 + 5 <= airportMin);
  const visit = (index, time, previous, used) => {
    if (index === roles.length) return time + (previous ? legMin(previous, airport) + 5 : 0) <= airportMin;
    const [from, to] = roles[index];
    return rows.some((row, id) => {
      const start = Math.max(from, time + (previous ? (previous === row ? 0 : legMin(previous, row)) + 5 : 0));
      if (start > to || start + 60 > airportMin) return false;
      return visit(index + 1, start + 60, row, new Set([...used, id]));
    });
  };
  return ready <= airportMin && visit(0, ready, null, new Set());
}

describe('paid planner readiness regressions: actual offline pipeline', () => {
  it('satisfies every time-feasible grid row and refuses only independently proven impossible requests', async () => {
    process.env.ROUTE_TSP_ENABLED = 'false';
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (p, c, _a, _b, index) => ({ index, durationMin: legMin(p, c), verifiedRouteDurationMin: legMin(p, c), verifiedRouteSegment: { method: "bus" }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    for (const key of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, key).mockImplementation(() => {});
    const bad: unknown[] = [];
    for (const row of failures) {
      const [blockId, arrId, dur, diet, kind] = row.key.split('|');
      setScenario(row.leg, row.departure);
      const block = BLOCKS.find((b) => b.id === blockId)!;
      const arrival = ARRIVALS0.find((a) => a.id === arrId)!;
      const result = await runOne(block, arrival, dur, diet === 'none' ? [] : [diet], kind);
      if (dur === '1dDep' && !mealOnlyFeasible(block, arrival, row.departure, diet)) {
        expect(result.stage).toBe('route');
        expect(result.err).toBe('ROUTE_DAY_INFEASIBLE');
        expect(result.errDetails.join(' ')).toContain('proven_infeasible');
        continue;
      }
      if (result.stage !== 'done' || result.gateOk !== true || result.bmeal?.length) bad.push({ ...row, stage: result.stage, gate: result.gateCode, issues: result.bmeal, error: result.err });
    }
    setScenario('mixA', '17:00');
    const retained = await runOne(BLOCKS.find((b) => b.id === 'GYEONGJU_DAY_BULGUKSA_STANDARD')!, ARRIVALS0.find((a) => a.id === 'I0800')!, '1d', [], 'single');
    expect(retained.gateOk).toBe(true); expect(retained.bmeal).toEqual([]);
    const stops = retained.days[0].stops;
    expect(stops.some((s) => s.n === '\uBD88\uAD6D\uC0AC')).toBe(true);
    expect(stops.some((s) => s.n === '\uD669\uB9AC\uB2E8\uAE38')).toBe(true);
    expect(stops.filter((s) => s.c === 'food' && s.st === 60)).toHaveLength(2);
    setScenario('distA', '23:00');
    const halal = await runOne(BLOCKS.find((b) => b.id === 'BUSAN_DAY_HAEUNDAE_STANDARD')!, ARRIVALS0.find((a) => a.id === 'A0900')!, '3d', ['Halal'], 'single');
    // This frozen legacy input already has a Day2 dinner failure on main.
    // Preserve that explicit rejection; this regression checks the independent Day3 visit loss.
    expect(halal.gateOk).toBe(false);
    expect(halal.bmeal).toEqual([expect.stringMatching(/^Day 2:.*B-MEAL-DINNER/)]);
    const lastDay = halal.days[2].stops;
    expect(lastDay.filter((stop) => !['food', 'lodging', 'travel'].includes(stop.c))).toHaveLength(5);
    expect(lastDay.some((stop) => stop.n === '\uAD11\uC548\uB9AC \uC57C\uACBD')).toBe(true);
    expect(lastDay.filter((stop) => stop.c === 'food')).toHaveLength(2);
    expect(bad).toEqual([]);
  }, 60000);
});

describe('pure bounded meal scheduler', () => {
  const options = { readyMin: 930, tourEndMin: 1260, requireLunch: true, requireDinner: true,
    mealWindows: { lunch: { from: 930, to: 1019 }, dinner: { from: 1020, to: 1259 } }, transitMinutes: () => 20 };
  it('keeps all visits while inserting matched lunch and dinner inside their windows', () => {
    const stops = [{ category: 'culture', stay_min: 50 }, { category: 'photo', stay_min: 20 },
      { category: 'food', stay_min: 60, _blockMealRole: 'lunch' }, { category: 'food', stay_min: 60, _blockMealRole: 'dinner' }];
    const result = solveDay1BlockSchedule(stops, options);
    expect(result.status).toBe('feasible');
    expect(result.removedIndices).toEqual([]);
    expect(result.covered & 3).toBe(3);
  });
  it('never uses a cafe or one restaurant twice to cover both meals', () => {
    const result = solveDay1BlockSchedule([{ category: 'food', stay_min: 60 }, { category: 'food', stay_min: 45, cafe_not_meal: true }], options);
    expect(result.status).toBe('proven_infeasible');
  });
  it('distinguishes exhausted search from an infeasibility proof', () => {
    const result = solveDay1BlockSchedule([{ category: 'culture', stay_min: 30 }, { category: 'food', stay_min: 60 }], { ...options, maxStates: 1 });
    expect(result.status).toBe('budget_exhausted');
  });
  it('includes actual stay, directional travel and the airport arrival deadline', () => {
    const result = solveDay1BlockSchedule([{ category: 'food', stay_min: 90, _blockMealRole: 'lunch' }], {
      ...options, requireDinner: false, deadlineMin: 1025, terminal: { time: 1080, transitMinutes: () => 80 },
    });
    expect(result.status).toBe('proven_infeasible');
  });
});
