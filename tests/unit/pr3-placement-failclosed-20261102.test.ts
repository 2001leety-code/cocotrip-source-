import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn().mockRejectedValue(new Error('offline')), post: vi.fn().mockRejectedValue(new Error('offline')) } }));
vi.mock('../../api/_ai_core/routeEnrichment.js', () => ({ enrichItineraryWithRoute: vi.fn() }));
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: vi.fn(async () => []) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'offline' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { runRouteEnrichment, applyRecommendedRestaurants } from '../../api/_ai_core/postResponsePipeline.js';
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';

const pendingPlan = () => ({ days: [{ day: 1, city: 'seoul', _day1PlacementPending: true, stops: [
  { name: 'Museum', category: 'culture', start_time: '11:00' },
  { name: 'Restaurant', category: 'food', start_time: '12:00' },
] }] });
const routeCtx = { body: { area: 'seoul' }, language: 'en', arrival_airport: 'ALREADY', departure_airport: 'ALREADY', dietPrefs: [], avoidStopNames: [] };
const gateCtx = { area: 'seoul', dietPrefs: [], regions: ['seoul'], language: 'en', styles: [], avoidStopNames: [], blockModeUsed: true, body: { area: 'seoul' } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('pending day-one placement fails closed', () => {
  it('the final gate rejects a pending plan even without dietary constraints', () => {
    expect(runFinalItineraryValidation(pendingPlan(), { dietary: [] })).toMatchObject({ ok: false, requiredMealIssues: ['Day 1 schedule has not been verified'] });
  });

  it('generic route failure rejects before downstream persistence', async () => {
    vi.mocked(enrichItineraryWithRoute).mockRejectedValue(new Error('route failed'));
    const save = vi.fn();
    const plan = pendingPlan();
    const pipeline = async () => { await runRouteEnrichment(plan, routeCtx); await applyRecommendedRestaurants(plan, gateCtx); await save(plan); };
    await expect(pipeline()).rejects.toThrow('route failed');
    expect(plan.days[0]._day1PlacementPending).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('route timeout leaves pending marker and final gate prevents downstream persistence', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(enrichItineraryWithRoute).mockImplementation(() => new Promise(() => {}));
    const save = vi.fn();
    const plan = pendingPlan();
    const run = runRouteEnrichment(plan, routeCtx);
    await vi.advanceTimersByTimeAsync(180000);
    await run;
    expect(plan.days[0]._day1PlacementPending).toBe(true);
    const pipeline = async () => { await applyRecommendedRestaurants(plan, gateCtx); await save(plan); };
    await expect(pipeline()).rejects.toMatchObject({ statusCode: 422 });
    expect(save).not.toHaveBeenCalled();
  });
});
