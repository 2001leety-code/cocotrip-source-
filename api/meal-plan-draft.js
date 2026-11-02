import { mealRequirementIssue } from './_ai_core/verifiedMealOptions.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { readMealExecutionPolicy, checkMealExecutionRate, createMealRouteBudget } from './_ai_core/mealExecutionGuard.js';
import { buildCityPerDayWithBookends } from './_shared/plannerIntentV1.js';
import { createMealRouteProvider } from './_ai_core/mealRouteProvider.js';
import { randomUUID, createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyMealActor } from './_ai_core/mealActor.js';
import { shapeRequest } from './_ai_core/requestShaper.js';
import { loadMealFoodRows } from './_ai_core/mealFoodRows.js';
import { fetchAvailableBlocks, expandBlocksToItinerary, expandBlocksToItineraryMultiCity } from './_ai_core/blockMode.js';
import { runRouteEnrichment, applyBackfillsAndTmoney, applyRecommendedRestaurants } from './_ai_core/postResponsePipeline.js';
import { mealWindowsFromRequest } from './_ai_core/responseValidator.js';
import { mealRequirements, createMealPlanService, mealDatabaseVersion } from './_ai_core/mealPlanIntegration.js';

export const maxDuration = 180;
const HANG_WARN_MS = (maxDuration - 30) * 1000;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (res, code, data) => { res.writeHead(code, { ...headers, ...(data.retryAfterSec ? { 'Retry-After': String(data.retryAfterSec) } : {}) }); res.end(JSON.stringify(data)); };

/** Build a real unpaid baseline using existing deterministic block/routing paths, never an LLM.
 * Unknown dated opening or health input stops before routing and before a draft write.
 */
export async function prepareUnpaidMealDraft(input, auth, adapters) {
  const legacy = shapeRequest(input, auth.email || '', false, auth.uid);
  const intent = legacy.plannerIntent;
  const shaped = { ...legacy, regions: intent.cityKeys, arrivalCity: intent.arrivalCityKey, departureCity: intent.departureCityKey,
    arrival_airport: intent.arrivalAirport, departure_airport: intent.departureAirport,
    arrivalTime: intent.arrivalTime, departureTime: intent.departureTime,
    tourStartTime: intent.tourStartTime, tourEndTime: intent.tourEndTime, hotel_address: intent.hotelAddress,
    styles: intent.activities, language: intent.language };
  const rawIntent = input.planner_intent_v1;
  if (rawIntent && ['durationDays', 'pax', 'startDate'].some((key) => rawIntent[key] !== undefined && rawIntent[key] !== shaped[key])) return { status: 'information_unknown', reason: 'input_scope_mismatch' };
  const restrictions = shaped.plannerIntent.dietaryRestrictions;
  const rows = await adapters.loadRows();
  const requirements = mealRequirements({ input: { ...input, dietaryRestrictions: restrictions } });
  const requirementIssue = mealRequirementIssue(requirements);
  if (requirementIssue) return { status: 'information_unknown', reason: requirementIssue };
  const regions = shaped.regions?.length ? shaped.regions : [shaped.area];
  const area = regions[0], durationDays = Number(shaped.durationDays);
  if (regions.length > durationDays) return { status: 'no_feasible', reason: 'more_cities_than_days' };
  const cityPerDay = buildCityPerDayWithBookends(regions, durationDays, { arrivalCityKey: shaped.arrivalCity, departureCityKey: shaped.departureCity });

  const cityBlocks = [];
  for (const city of regions) cityBlocks.push({ city, blocks: await adapters.loadBlocks(city, restrictions) });
  if (cityBlocks.some((item) => !item.blocks.length)) return { status: 'no_feasible', reason: 'no_available_course' };
  const blocks = cityBlocks.flatMap((item) => item.blocks);
  const requested = Array.isArray(input.day_selections) ? input.day_selections : [];
  const selections = cityPerDay.map((city, index) => {
    const candidates = cityBlocks.find((item) => item.city === city).blocks;
    return { day: index + 1, city, block_id: requested[index]?.block_id || candidates[index % candidates.length].id };
  });
  if (selections.some((selection) => !cityBlocks.find((item) => item.city === selection.city).blocks.some((block) => block.id === selection.block_id))) return { status: 'no_feasible', reason: 'unavailable_course' };
  const mealWindows = mealWindowsFromRequest(shaped);
  const userInput = { ...shaped, area, arrival_city: shaped.arrivalCity, departure_city: shaped.departureCity, durationDays, foodIndex: rows, dietPrefs: restrictions,
    arrival_time: shaped.arrivalTime, departure_time: shaped.departureTime, tour_start_time: shaped.tourStartTime, tour_end_time: shaped.tourEndTime };
  let itinerary;
  try {
    itinerary = regions.length > 1 ? expandBlocksToItineraryMultiCity({ day_selections: selections }, cityBlocks, { ...userInput, regions })
      : expandBlocksToItinerary({ day_selections: selections }, blocks, userInput);
    for (const day of itinerary.days) for (const stop of day.stops) if (stop.category === 'food' && stop.cafe_not_meal !== true) stop.stay_min = 60;
    const ctx = { body: input, area, regions, durationDays, language: shaped.language, dietPrefs: restrictions,
      arrivalTime: shaped.arrivalTime, departureTime: shaped.departureTime, arrival_airport: shaped.arrival_airport,
      departure_airport: shaped.departure_airport, mealWindows, styles: shaped.styles, avoidStopNames: [], blockModeUsed: true, verifiedMealDraft: true, routeBudget: adapters.routeBudget,
      tourEndTime: shaped.tourEndTime, hotel_address: shaped.hotel_address || '', hotelAddressFromBody: shaped.hotel_address || '' };
    await adapters.enrich(itinerary, ctx);
    adapters.routeBudget?.assertNotExceeded();
    applyBackfillsAndTmoney(itinerary, ctx);
    await adapters.finalize(itinerary, ctx);
    // Canonical planner input retires the medical alias; do not persist it.
    const { allergies: _allergies, legacyAllergies: _legacyAllergies, ...supportedInput } = input;
    const draftInput = { ...supportedInput, arrival_time: shaped.arrivalTime, departure_time: shaped.departureTime,
      arrival_airport: shaped.arrival_airport, departure_airport: shaped.departure_airport,
      tour_start_time: shaped.tourStartTime, tour_end_time: shaped.tourEndTime, regions, area,
      dietary: restrictions, dietaryRestrictions: restrictions, planner_intent_v1: shaped.plannerIntent, meal_windows: mealWindows, language: shaped.language };
    const service = createMealPlanService({ repository: { load: async () => ({ planId: 'unpaid-baseline', input: draftInput, itinerary }) },
      rows, route: adapters.route || createMealRouteProvider(), ...(adapters.opening ? { opening: adapters.opening } : {}) });
    let checked = await service.validateDraft();
    let referenceMeals;
    adapters.routeBudget?.assertNotExceeded();
    if (checked.status !== 'verified') {
      if (checked.status === 'information_unknown' && checked.reason === 'opening_information') {
        const preview = await service.previewDraft();
        if (['verified', 'opening_unconfirmed'].includes(preview.status)) {
          const view = await service.load();
          referenceMeals = view.meals.map(({ mealId, day, referenceOptions }) => ({ mealId, day, referenceOptions: referenceOptions || [] }));
          checked = preview;
        } else return { status: preview.status === 'validation_failed' ? 'no_feasible' : preview.status, reason: preview.reason };
      } else return { status: checked.status === 'validation_failed' ? 'no_feasible' : checked.status, reason: checked.reason };
    }
    return { status: checked.status, ...(referenceMeals ? { referenceMeals } : {}), itinerary, input: draftInput, inputFingerprint: digest(input), dbVersion: mealDatabaseVersion(rows), evidenceId: checked.evidenceId };
  } catch (error) {
    return { status: error?.code === 'ROUTE_DAY_INFEASIBLE' && error?.scheduleStatus === 'proven_infeasible' ? 'no_feasible' : 'route_failed', reason: error?.code || 'draft_validation_failed' };
  }
}

export function createMealDraftHandler(overrides = {}) {
  return async (req, res) => {
    let currentStep = 'request', currentStepStart = Date.now();
    async function withStep(label, fn) {
      const previousStep = currentStep, previousStart = currentStepStart;
      currentStep = label; currentStepStart = Date.now();
      console.log(`[meal-plan-draft] step=${label} ENTER`);
      try { return await fn(); }
      finally {
        console.log(`[meal-plan-draft] step=${label} END ${Date.now() - currentStepStart}ms`);
        currentStep = previousStep; currentStepStart = previousStart;
      }
    }
    const hangWarnTimer = setTimeout(() => {
      const elapsedMs = Date.now() - currentStepStart;
      throttledTelegramAlert({ key: 'meal-plan-draft-hang', channel: 'admin', severity: 'high',
        message: `meal-plan-draft step=${currentStep} elapsedMs=${elapsedMs}` }).catch(() => {});
    }, HANG_WARN_MS);
    hangWarnTimer.unref?.();
    try {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, status: 'method_not_allowed' });
    const auth = await withStep('authenticate', () => (overrides.authenticate || verifyMealActor)(req));
    if (!auth.ok || typeof auth.uid !== 'string' || !auth.uid.trim()) return reply(res, 401, { ok: false, status: 'authentication_required' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (!body.input || typeof body.input !== 'object') return reply(res, 400, { ok: false, status: 'invalid_input' });
      const db = overrides.db || initAdminDb();
      const policy = overrides.executionPolicy || readMealExecutionPolicy().policy;
      const rate = await withStep('rate-limit', () => (overrides.checkRateLimit || checkMealExecutionRate)({ req, db, phase: 'expensive', actorKey: `uid:${auth.uid}`, policy }));
      if (!rate.ok) return reply(res, rate.status, { ok: false, status: rate.reason, retryAfterSec: rate.retryAfterSec });
      const routeBudget = createMealRouteBudget(policy?.routeQueryLimit || 64);
      const result = await withStep('draft', () => prepareUnpaidMealDraft(body.input, auth, {
        loadRows: () => withStep('load-rows', () => (overrides.loadRows || loadMealFoodRows)()),
        loadBlocks: (city, dietary) => withStep('load-blocks', () => (overrides.loadBlocks || ((c, d) => fetchAvailableBlocks(db, c, { dietaryRequired: d })))(city, dietary)),
        enrich: (itinerary, ctx) => withStep('route', () => (overrides.enrich || runRouteEnrichment)(itinerary, ctx)), finalize: (itinerary, ctx) => withStep('finalize', () => (overrides.finalize || applyRecommendedRestaurants)(itinerary, ctx)),
        route: createMealRouteProvider(overrides.route, routeBudget), routeBudget,
        ...(overrides.opening ? { opening: overrides.opening } : {}),
      }));
      if (!['verified', 'opening_unconfirmed'].includes(result.status)) return reply(res, 200, { ok: true, status: result.status, reason: result.reason, ...(result.referenceMeals ? { referenceMeals: result.referenceMeals } : {}) });
      if (!db) return reply(res, 503, { ok: false, status: 'storage_unavailable' });
      const draftId = randomUUID(), revision = randomUUID();
      const fingerprint = digest({ input: result.inputFingerprint, canonicalInput: result.input, itinerary: result.itinerary, revision, dbVersion: result.dbVersion });
      await withStep('save-draft', () => db.collection('meal_plan_drafts').doc(draftId).create(JSON.parse(JSON.stringify({ ...result, uid: auth.uid, revision, fingerprint, createdAt: Date.now() }))));
      return reply(res, 200, { ok: true, status: result.status, draftId, revision, fingerprint, ...(result.referenceMeals ? { referenceMeals: result.referenceMeals } : {}) });
    } catch (error) {
      console.error('[meal-plan-draft]', error?.code || error?.name || 'error');
      return reply(res, 422, { ok: false, status: 'verification_failed' });
    } finally { clearTimeout(hangWarnTimer); }
  };
}
export default createMealDraftHandler();
