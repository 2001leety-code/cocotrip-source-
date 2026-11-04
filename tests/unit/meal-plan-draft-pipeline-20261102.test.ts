import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: vi.fn(async () => ({ ok: false })) }));
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: vi.fn(async () => fixture.rows) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
import { createMealDraftHandler, prepareUnpaidMealDraft } from '../../api/meal-plan-draft.js';
import { validateStoredMealDraft } from '../../api/_ai_core/mealPlanIntegration.js';
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { runRouteEnrichment, applyRecommendedRestaurants } from '../../api/_ai_core/postResponsePipeline.js';
const input = { area: 'seoul', regions: ['seoul'], durationDays: 1, language: 'en', startDate: '2026-12-01', arrivalTime: '09:00', arrival_airport: 'ALREADY',
  tourStartTime: '09:00', tourEndTime: '16:00', dietPrefs: ['Halal'], dietaryRestrictions: ['Halal'], allergies: [] };
const rows = () => [{ name: 'Fixture Meal', nameEn: 'Fixture Meal', address: 'Seoul fixture', city: 'seoul', lat: 37.55, lng: 126.98,
  tag: 'halal', verification_status: 'halal_certified', opening_evidence: [{ date: '2026-12-01', from: '09:00', to: '16:00', source_url: 'https://example.test/hours', checked_at: '2026-11-02' }] }];
const block = { id: 'SEOUL_TEST', city: 'seoul', block_type: 'city_day', zone: 'fixture', theme: 'fixture', stops: [
  { order: 1, category: 'culture', name: 'Museum', stay_min: 30, start_time_offset_min: 0, lat: 37.551, lng: 126.981 },
  { order: 2, category: 'food', placeholder: 'verified_lunch', stay_min: 90, start_time_offset_min: 120 },
  { order: 3, category: 'culture', name: 'Gallery', stay_min: 30, start_time_offset_min: 220, lat: 37.552, lng: 126.982 },
] };
afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });
function adapters() { return { loadRows: async () => fixture.rows, loadBlocks: async () => [block], enrich: runRouteEnrichment, finalize: applyRecommendedRestaurants }; }
describe('unpaid baseline runs existing generation/routing/final gates before draft storage', () => {
  it('unknown opening produces a conditional draft without claiming confirmed hours', async () => {
    fixture.rows = rows().map((row) => ({ ...row, opening_evidence: [] })); process.env.ROUTE_TSP_ENABLED = 'false';
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p, _c, _id, _secret, index) => ({ index, durationMin: 20, verifiedRouteDurationMin: 20, verifiedRouteSegment: { method: 'bus' }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    const result = await prepareUnpaidMealDraft(input, { uid: 'owner' }, { ...adapters(), route: async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-route' }) });
    expect(result).toMatchObject({ status: 'opening_unconfirmed', referenceMeals: [expect.objectContaining({ referenceOptions: [expect.objectContaining({ openingStatus: 'unknown', referenceOnly: true })] })] });
    expect(result).not.toHaveProperty('fingerprint'); expect(result).not.toHaveProperty('draftId');
  });
  it('normal input does not require retired medical collection or inject a none assertion', async () => {
    fixture.rows = rows(); const missing: Partial<typeof input> = { ...input }; delete missing.allergies;
    const loadBlocks = vi.fn(async () => []);
    expect(await prepareUnpaidMealDraft(missing, { uid: 'owner' }, { ...adapters(), loadBlocks })).toMatchObject({ status: 'no_feasible', reason: 'no_available_course' });
    expect(loadBlocks).toHaveBeenCalled(); expect(missing).not.toHaveProperty('allergies');
  });
  it('canonical-only Halal is preserved while food styles stay separate from safety conditions', async () => {
    fixture.rows = rows(); const captured: unknown[] = [];
    const canonical = { ...input, planner_intent_v1: { version: 1, dietaryRestrictions: ['Halal'], foodStyles: ['Seafood'] },
      dietPrefs: ['Seafood'], dietaryRestrictions: [] };
    await prepareUnpaidMealDraft(canonical, { uid: 'owner' }, { ...adapters(), loadBlocks: async (_city, restrictions) => { captured.push(restrictions); return []; } });
    expect(captured).toEqual([['Halal']]);
  });
  it('a health condition in special request is never erased by an empty medical array', async () => {
    fixture.rows = rows();
    expect(await prepareUnpaidMealDraft({ ...input, special_request: 'Severe peanut allergy' }, { uid: 'owner' }, adapters())).toMatchObject({ status: 'information_unknown' });
  });
  it('canonical nested revision health notes are not lost behind an explicit empty legacy array', async () => {
    fixture.rows = rows();
    expect(await prepareUnpaidMealDraft({ ...input, planner_intent_v1: { version: 1, dietaryRestrictions: ['Halal'], revision: { reasonCodes: [], note: 'Peanut allergy' } } }, { uid: 'owner' }, adapters())).toMatchObject({ status: 'information_unknown' });
  });
  it('refuses an independently impossible ready-after-airport-deadline request before any unpaid snapshot write', async () => {
    fixture.rows = rows(); process.env.ROUTE_TSP_ENABLED = 'false';
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p, _c, _id, _secret, index) => ({ index, durationMin: 20, verifiedRouteDurationMin: 20,
      verifiedRouteSegment: { method: 'bus' }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    const write = vi.fn();
    const db = { collection: () => ({ doc: () => ({ create: write }) }) };
    const handler = createMealDraftHandler({ db, checkRateLimit: async () => ({ ok: true }), authenticate: async () => ({ ok: true, uid: 'owner' }), ...adapters(),
      route: async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-provider', segment: { method: 'bus' } }) });
    let result;
    await handler({ method: 'POST', body: { input: { ...input, arrivalTime: '18:00', departureTime: '17:00', departure_airport: 'ICN_T1' } }, headers: {} },
      { writeHead: () => {}, end: (body) => { result = JSON.parse(body); } });
    expect(result.status).toBe('no_feasible'); expect(write).not.toHaveBeenCalled();
  });
  it('shares the explicit route query budget across initial placement and final verification', async () => {
    fixture.rows = rows(); process.env.ROUTE_TSP_ENABLED = 'false';
    const initial = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p, _c, _id, _secret, index) => ({ index, durationMin: 20, verifiedRouteDurationMin: 20,
      verifiedRouteSegment: { method: 'bus' }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    const write = vi.fn(), finalRoute = vi.fn(async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-provider' }));
    const db = { collection: () => ({ doc: () => ({ create: write }) }) };
    const handler = createMealDraftHandler({ db, checkRateLimit: async () => ({ ok: true }),
      executionPolicy: { readIpLimit: 100, expensiveIpLimit: 100, actorLimit: 100, routeQueryLimit: 1 },
      authenticate: async () => ({ ok: true, uid: 'owner' }), ...adapters(), route: finalRoute });
    let result;
    await handler({ method: 'POST', body: { input }, headers: {} }, { writeHead: () => {}, end: body => { result = JSON.parse(body); } });
    expect(result.status).toBe('route_failed'); expect(result.reason).toBe('MEAL_ROUTE_BUDGET_EXHAUSTED');
    expect(initial.mock.calls.length).toBeLessThanOrEqual(1); expect(finalRoute).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('restores server departure proof after JSON storage without route API calls', async () => {
    fixture.rows = rows(); process.env.ROUTE_TSP_ENABLED = 'false';
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p, _c, _id, _secret, index) => ({ index, durationMin: 20, verifiedRouteDurationMin: 20, verifiedRouteSegment: { method: 'bus' }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    const result = await prepareUnpaidMealDraft({ ...input, departureTime: '21:00', departure_airport: 'ICN_T1' }, { uid: 'owner' }, { ...adapters(), route: async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-provider', segment: { method: 'bus' } }) });
    expect(result.status).toBe('verified');
    const stored = JSON.parse(JSON.stringify({ input: result.input, itinerary: result.itinerary }));
    const before = JSON.stringify(stored);
    expect(await validateStoredMealDraft(stored, fixture.rows)).toMatchObject({ status: 'verified' });
    expect(JSON.stringify(stored)).toBe(before);
    stored.itinerary.days[0].stops.at(-1).start_time = '20:00';
    expect(await validateStoredMealDraft(stored, fixture.rows)).toMatchObject({ status: 'validation_failed' });
  });
  it('real block expansion, mocked transport and real final validators produce one unpaid server snapshot', async () => {
    fixture.rows = rows(); process.env.ROUTE_TSP_ENABLED = 'false';
    vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p, _c, _id, _secret, index) => ({ index, durationMin: 20, verifiedRouteDurationMin: 20,
      verifiedRouteSegment: { method: 'bus' }, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    vi.spyOn(RouteAgent.prototype, '_routeAirportHotel').mockImplementation(async () => null);
    const writes: unknown[] = [];
    const db = { collection: (name) => ({ doc: (id) => ({ create: async (value) => { writes.push({ name, id, value }); } }) }) };
    const handler = createMealDraftHandler({ db, checkRateLimit: async () => ({ ok: true }), route: async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-provider', segment: { method: 'bus' } }), authenticate: async () => ({ ok: true, uid: 'owner' }), ...adapters() });
    let result;
    await handler({ method: 'POST', body: { input: { ...input, allergies: ['Halal'], legacyAllergies: ['Halal'] } }, headers: {} }, { writeHead: () => {}, end: (body) => { result = JSON.parse(body); } });
    expect(result).toMatchObject({ ok: true, status: 'verified', draftId: expect.any(String), revision: expect.any(String), fingerprint: expect.any(String) });
    expect(writes).toHaveLength(1);
    const saved = (writes[0] as { value: { uid: string; itinerary: { meal_options_version: number; days: { stops: { category: string; stay_min: number }[] }[] } } }).value;
    expect(saved).toHaveProperty('input.dietaryRestrictions', ['Halal']);
    expect(saved).not.toHaveProperty('input.allergies'); expect(saved).not.toHaveProperty('input.legacyAllergies');
    expect(saved.uid).toBe('owner'); expect(saved.itinerary.meal_options_version).toBe(1);
    expect(saved.itinerary.days[0].stops.filter((s) => s.category === 'food').every((s) => s.stay_min === 60)).toBe(true);
  });
});
