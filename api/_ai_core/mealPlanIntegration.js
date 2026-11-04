import { isRowCityConsistent } from '../_shared/food-row-provenance.js';
import { canServeMeal } from '../_shared/meal-venue.js';
import { applyMealSlotNotes } from '../../src/lib/mealSlotNotes.js';
import { registerVerifiedDepartureRoute } from './verifiedDepartureRoute.js';
import { checkRequiredMeals } from './responseValidator.js';
import { applyFoodRowToStop } from './revisitPolicy.js';
import { createHash, randomUUID } from 'node:crypto';
import { buildVerifiedMealOptions, prepareMealSelection, commitMealSelection, restaurantIdentity, mealRequirementIssue } from './verifiedMealOptions.js';
import { runFinalItineraryValidation, runDuplicateStopGate, tripTimesFrom } from './finalItineraryGate.js';
import { mealWindowsForStoredPlan } from './responseValidator.js';
import { AIRPORT_COORDS, SCHEDULE_BUFFER_MIN, resolveDepartureTime, resolveTourStartTime, resolveTourEndTime, resolveArrivalTime, arrivalReadyMinutes } from './constants.js';
import { dietaryEvidenceFor } from '../_shared/dietary-trust.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const minute = (value) => { const m = /^(\d{2}):(\d{2})$/.exec(String(value || '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };
const food = (stop) => stop?.category === 'food' && stop.cafe_not_meal !== true && stop._blockMealRole !== 'cafe';
export const mealPlanRevision = (plan) => String(plan.mealOptionsRevision || hash(plan.itinerary));
export const mealDatabaseVersion = (rows) => hash(rows);
const rowFor = (stop, rows, city) => {
  const eligible = city ? rows.filter((row) => String(row.city || '').toLowerCase() === String(city).toLowerCase() && isRowCityConsistent(row)) : rows;
  const names = [stop.name, stop.display_name].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  return eligible.find((row) => restaurantIdentity(row) === stop.restaurant_id)
    || eligible.find((row) => [row.name, row.nameEn].filter(Boolean).flatMap((value) => String(value).split('|')).some((name) => names.includes(name.trim().toLowerCase())));
};

// A restaurant may be revisited; attraction duplication remains a quality error.
// This projection is used only by server-owned v1 verification. Every actual visit
// still goes through dietary, opening, meal-window and route validation below.
export function mealRepeatGateItinerary(itinerary, rows, dietary) {
  const seen = new Set();
  return { ...itinerary, days: (itinerary.days || []).map((day) => ({ ...day, stops: (day.stops || []).filter((stop) => {
    if (!food(stop)) return true;
    const row = rowFor(stop, rows, day.city);
    if (!row || !canServeMeal(row) || !dietary.every((diet) => dietaryEvidenceFor(row, diet))) return true;
    const id = restaurantIdentity(row);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }) })) };
}

// Preserve facts only. openNow is a historical observation, never a travel-date opening guarantee.
export function verifyMealOpening(row, { date, startMin, endMin }) {
  const facts = Array.isArray(row?.opening_evidence) ? row.opening_evidence : [];
  const records = facts.filter((fact) => {
    if (!fact || fact.date !== date || typeof fact.source_url !== 'string' || typeof fact.checked_at !== 'string') return false;
    try {
      const url = new URL(fact.source_url), checked = Date.parse(fact.checked_at);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && Number.isFinite(checked) && checked <= Date.now();
    } catch { return false; }
  });
  if (!records.length) return { status: 'unknown' };
  if (records.some((fact) => fact.closed === true)) return { status: 'closed' };
  const periods = records.filter((fact) => minute(fact.from) !== null && minute(fact.to) !== null && minute(fact.from) < minute(fact.to));
  if (!periods.length) return { status: 'unknown' };
  const open = periods.find((fact) => minute(fact.from) <= startMin && endMin <= minute(fact.to));
  return open ? { status: 'verified_open', sourceUrl: open.source_url, checkedAt: open.checked_at } : { status: 'closed' };
}

export function attachMealOptionState(itinerary, rows = [], language = 'en') {
  itinerary.meal_options_version = 1;
  const oldMeals = new Map((itinerary.meal_options || []).map((meal) => [meal.mealId, meal]));
  const meals = [];
  for (const day of itinerary.days || []) {
    for (const [index, stop] of (day.stops || []).entries()) {
      stop.plan_stop_id = stop.plan_stop_id || `day-${day.day}-stop-${index + 1}`;
      if (!food(stop)) continue;
      stop.meal_slot_id = stop.meal_slot_id || `day-${day.day}-meal-${index + 1}`;
      const row = rowFor(stop, rows, day.city);
      if (row) stop.restaurant_id = restaurantIdentity(row);
      meals.push(oldMeals.get(stop.meal_slot_id) || { mealId: stop.meal_slot_id, day: day.day, status: 'information_unknown', baselineId: stop.restaurant_id || null,
        selectedId: null, options: [] });
    }
  }
  itinerary.meal_options = meals;
  applyMealSlotNotes(itinerary, language);
  return itinerary;
}

export function mealRequirements(plan) {
  const input = plan.input || {};
  const intent = input.planner_intent_v1;
  // Explicit canonical restrictions take precedence, including an explicit empty array.
  const canonical = intent && Object.prototype.hasOwnProperty.call(intent, 'dietaryRestrictions') ? intent.dietaryRestrictions
    : Object.prototype.hasOwnProperty.call(input, 'dietaryRestrictions') ? input.dietaryRestrictions : undefined;
  const supported = (value) => typeof value === 'string' && /^(halal|vegan|vegetarian)$/i.test(value.trim());
  const medicalAliases = [input.allergies, intent?.allergies, intent?.dietary?.allergies, input.legacyAllergies];
  const aliasRestrictions = medicalAliases.filter(Array.isArray).flat().filter(supported);
  const legacy = Array.isArray(input.dietary) ? input.dietary : aliasRestrictions.length ? aliasRestrictions
    : Array.isArray(input.dietPrefs) ? input.dietPrefs : medicalAliases.some(Array.isArray) ? aliasRestrictions : undefined;
  const dietary = canonical !== undefined ? canonical : Array.isArray(legacy)
    ? legacy.filter(supported) : undefined;
  // Legacy allergies is a dietary migration alias. Keep real medical requests
  // distinct, including a malformed supplied value; omission is not medical clearance.
  const retainedMedicalValues = medicalAliases.filter(Array.isArray).flat().filter((value) => !supported(value));
  const allergies = medicalAliases.some((value) => value !== undefined) ? retainedMedicalValues : undefined;
  const medicalInputMalformed = medicalAliases.some((value) => value !== undefined && !Array.isArray(value));
  const notes = [input.specialRequest, input.special_request, input.revisionNote, input.revision_note, intent?.specialRequest, intent?.revisionNote, intent?.revision?.note].filter((value) => typeof value === 'string').join(' ');
  const healthConditionMentioned = retainedMedicalValues.length > 0 || /allerg|알레르|アレルギ|过敏|過敏|\b(?:nuts?|shellfish|gluten|dairy)\b|땅콩|견과|갑각|글루텐|유제품|乳製品|花生|甲殻/i.test(notes);
  // A canonical religious/lifestyle restriction list is not evidence of medical safety.
  return { dietary, allergies, healthConditionMentioned, medicalInputMalformed };
}

export async function validateMealPlan(plan, rows, opening = verifyMealOpening, { previewOpening = false } = {}) {
  let openingUnconfirmed = false;
  const requirements = mealRequirements(plan);
  const requirementIssue = mealRequirementIssue(requirements);
  if (requirementIssue) return { status: 'information_unknown', reason: requirementIssue };
  const itinerary = plan.itinerary;
  const input = plan.input || {};
  const tripTimes = tripTimesFrom({ ...input, meal_windows: mealWindowsForStoredPlan(input, itinerary.days.length) });
  for (const field of ['plan_stop_id', 'meal_slot_id']) {
    const ids = itinerary.days.flatMap((day) => day.stops.map((stop) => stop[field]).filter(Boolean));
    if (new Set(ids).size !== ids.length) return { status: 'validation_failed', reason: 'duplicate_stop_identity' };
  }
  const final = runFinalItineraryValidation(itinerary, { dietary: requirements.dietary, language: input.language, foodIndex: rows, tripTimes });
  if (checkRequiredMeals(itinerary, tripTimes).length) return { status: 'validation_failed', reason: 'required_meal_missing' };
  if (!final.ok || !runDuplicateStopGate(mealRepeatGateItinerary(itinerary, rows, requirements.dietary), { foodIndex: rows, dietary: requirements.dietary }).ok) return { status: 'validation_failed', reason: final.code || 'duplicate_stop' };
  const departureMin = minute(resolveDepartureTime(input));
  if (departureMin !== null) {
    const lastDay = itinerary.days[itinerary.days.length - 1];
    const airport = lastDay.stops[lastDay.stops.length - 1];
    if (!airport || !['travel', 'airport', 'airport_transfer'].includes(airport.category) || minute(airport.start_time) === null || minute(airport.start_time) > departureMin - 180) return { status: 'validation_failed', reason: 'airport_arrival_buffer' };
    if (itinerary.days.length === 1) {
      const arrivalAirport = input.arrival_airport || input.arrivalAirport;
      const arrival = resolveArrivalTime(input);
      const ready = Math.max(minute(resolveTourStartTime(input)), (arrivalAirport ? arrivalReadyMinutes(arrival, arrivalAirport, lastDay.city) : minute(arrival)) || 0);
      if (minute(airport.start_time) < ready) return { status: 'validation_failed', reason: 'ready_after_airport_deadline' };
    }
    const code = String(input.departure_airport || input.departureAirport || '').trim().toUpperCase().replace(/\s+/g, '_');
    const expected = AIRPORT_COORDS[code];
    if (!expected || !Number.isFinite(airport.lat) || !Number.isFinite(airport.lng)
        || Math.abs(expected.lat - airport.lat) > 0.00001 || Math.abs(expected.lng - airport.lng) > 0.00001) return { status: 'validation_failed', reason: 'airport_identity_mismatch' };
  }
  for (const day of itinerary.days || []) {
    const firstDay = day === itinerary.days[0];
    const arrivalAirport = input.arrival_airport || input.arrivalAirport;
    const ready = firstDay ? (arrivalAirport ? arrivalReadyMinutes(resolveArrivalTime(input), arrivalAirport, day.city) : minute(resolveArrivalTime(input))) : 0;
    const floor = Math.max(minute(resolveTourStartTime(input)), ready || 0);
    const tourEnd = minute(resolveTourEndTime(input));
    let previousEnd = null;
    for (const stop of day.stops || []) {
      if (typeof stop.name !== 'string' || !stop.name.trim()) return { status: 'validation_failed', reason: 'stop_name_missing' };
      const start = minute(stop.start_time);
      const stay = Number(stop.stay_min);
      if (start === null || !Number.isInteger(stay) || stay < 0 || start + stay >= 1440) return { status: 'validation_failed', reason: 'invalid_stop_time' };
      if (!['lodging', 'airport', 'airport_transfer', 'travel'].includes(stop.category) && (start < floor || start >= tourEnd)) return { status: 'validation_failed', reason: 'outside_activity_window' };
      if (previousEnd !== null) {
        const travel = stop.transit_from_prev?.est_min;
        if (typeof travel !== 'number' || !Number.isFinite(travel) || travel < 0 || stop.transit_from_prev?._stale || stop._stale_transit) return { status: 'route_failed', reason: 'unverified_or_stale_transit' };
        if (previousEnd + Math.ceil(travel) + SCHEDULE_BUFFER_MIN > start) return { status: 'validation_failed', reason: 'overlapping_stops' };
      }
      previousEnd = start + stay;
      if (!food(stop)) continue;
      if (stay !== 60) return { status: 'validation_failed', reason: 'meal_stay_must_be_60' };
      const row = rowFor(stop, rows, day.city);
      if (!row || !canServeMeal(row) || !requirements.dietary.every((diet) => dietaryEvidenceFor(row, diet))) return { status: 'validation_failed', reason: 'dietary_evidence_missing' };
      const verified = await opening(row, { date: day.date, startMin: start, endMin: start + stay });
      if (verified.status !== 'verified_open') {
        if (!previewOpening || verified.status !== 'unknown') return { status: verified.status === 'closed' ? 'validation_failed' : 'information_unknown', reason: 'opening_information' };
        openingUnconfirmed = true;
      }
    }
  }
  return { status: openingUnconfirmed ? 'opening_unconfirmed' : 'verified', evidenceId: hash({ itinerary, requirements, db: mealDatabaseVersion(rows) }) };
}

function mealContext(plan, mealId) {
  for (const day of plan.itinerary.days || []) {
    const index = (day.stops || []).findIndex((stop) => stop.meal_slot_id === mealId);
    if (index < 0) continue;
    const stop = day.stops[index], previous = day.stops[index - 1], next = day.stops[index + 1];
    if (!previous || !next) return null; // Anchors must be server-owned actual endpoints.
    const start = minute(stop.start_time);
    const role = stop._blockMealRole === 'breakfast' || (start !== null && start < 660) ? 'breakfast' : start !== null && start < 1020 ? 'lunch' : 'dinner';
    const departure = minute(resolveDepartureTime(plan.input || {}));
    return { id: mealId, day: day.day, date: day.date, city: day.city, previous, next,
      readyMin: minute(previous.start_time) + Number(previous.stay_min), windowFrom: role === 'breakfast' ? 360 : role === 'lunch' ? 660 : 1020,
      latestStartMin: role === 'breakfast' ? 659 : role === 'lunch' ? 1019 : 1319, nextDeadlineMin: minute(next.start_time), bufferMin: SCHEDULE_BUFFER_MIN,
      activityDeadlineMin: departure !== null && plan.itinerary.days.length === 1 ? departure - 180 - SCHEDULE_BUFFER_MIN : 1439 };
  }
  return null;
}

function visibleMealChanges(before, after, language) {
  const words = {
    ko: { time: '시각 변경', route: '이동 시간 변경', place: '방문지 변경', order: '방문 순서 변경', unknown: '미확인', minute: '분' },
    en: { time: 'Time change', route: 'Travel time change', place: 'Place change', order: 'Visit order change', unknown: 'Unconfirmed', minute: 'min' },
    ja: { time: '時刻変更', route: '移動時間変更', place: '訪問先変更', order: '訪問順序変更', unknown: '未確認', minute: '分' },
    zh: { time: '时间变更', route: '交通时间变更', place: '地点变更', order: '游览顺序变更', unknown: '未确认', minute: '分钟' },
  };
  const t = words[language] || words.en, changes = [];
  for (const [index, oldDay] of before.days.entries()) {
    const day = after.days[index];
    for (const old of oldDay.stops || []) {
      const next = (day?.stops || []).find((stop) => stop.plan_stop_id && stop.plan_stop_id === old.plan_stop_id);
      if (!next) continue;
      const name = next.display_name || next.name;
      if (old.start_time !== next.start_time || old.stay_min !== next.stay_min) changes.push(`${t.time} · ${name}: ${old.start_time} (${old.stay_min}${t.minute}) → ${next.start_time} (${next.stay_min}${t.minute})`);
      const previousTravel = old.transit_from_prev?.est_min, travel = next.transit_from_prev?.est_min;
      if (previousTravel !== travel) changes.push(`${t.route} · ${name}: ${previousTravel === undefined ? t.unknown : previousTravel + t.minute} → ${travel === undefined ? t.unknown : travel + t.minute}`);
      if (old.name !== next.name || old.address !== next.address || old.lat !== next.lat || old.lng !== next.lng) changes.push(`${t.place} · ${old.display_name || old.name} (${old.address || ''}) → ${name} (${next.address || ''})`);
      if (oldDay.stops.indexOf(old) !== day.stops.indexOf(next)) changes.push(`${t.order} · ${name}: ${oldDay.stops.indexOf(old) + 1} → ${day.stops.indexOf(next) + 1}`);
    }
  }
  return changes;
}

// Only call this adapter after verifying a server-owned draft fingerprint.
// Rebuild request-local departure proof from that immutable server itinerary;
// no serialized client marker grants trust and no external route is queried.
function restoreServerDepartureProof(itinerary, input) {
  const departureMin = minute(resolveDepartureTime(input));
    if (departureMin !== null && itinerary.days.length === 1) {
      const day = itinerary.days[0], airportIndex = day.stops.findIndex((stop) => stop._departure_airport_stop === true);
      if (airportIndex > 0) {
        const airport = day.stops[airportIndex], last = day.stops[airportIndex - 1];
        const airportMin = minute(airport.start_time);
        const airportCode = input.arrival_airport || input.arrivalAirport;
        const arrival = resolveArrivalTime(input);
        const ready = Math.max(minute(resolveTourStartTime(input)), (airportCode ? arrivalReadyMinutes(arrival, airportCode, day.city) : minute(arrival)) || 0);
        const end = minute(resolveTourEndTime(input));
        const windows = Object.fromEntries([['lunch', 660, 1019], ['dinner', 1020, 1319]].map(([role, from, to]) => {
          const low = Math.max(ready, from), high = Math.min(to, end - 1, airportMin - SCHEDULE_BUFFER_MIN - 60);
          const hhmm = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
          return [role, low <= high ? { from: hhmm(low), to: hhmm(high) } : null];
        }));
        try { registerVerifiedDepartureRoute(day, { departureMin, airportMin, travelMin: airport.transit_from_prev.est_min,
          lastEndMin: minute(last.start_time) + Number(last.stay_min), bufferMin: SCHEDULE_BUFFER_MIN, windows }); }
        catch { return { status: 'validation_failed', reason: 'airport_arrival_buffer' }; }
      }
    }
}
export async function validateStoredMealDraft(plan, rows, opening = verifyMealOpening, { allowUnconfirmedOpening = false } = {}) {
  const failed = restoreServerDepartureProof(plan.itinerary, plan.input || {});
  return failed || validateMealPlan(plan, rows, opening, { previewOpening: allowUnconfirmedOpening });
}

export function createMealPlanService({ repository, rows, route, opening = verifyMealOpening }) {
  const dbVersion = mealDatabaseVersion(rows);
  const conditionalPlan = (current) => current.mealDraftBinding?.openingNoticeVersion === 'meal-opening-unconfirmed-v1';
  const validate = async (itinerary, current, { previewOpening = false } = {}) => {
    previewOpening = previewOpening || conditionalPlan(current);
    const requirements = mealRequirements(current);
    const requirementIssue = mealRequirementIssue(requirements);
    if (requirementIssue) return { status: 'information_unknown', reason: requirementIssue };
    // Requery every affected day's route with server-owned adapters, never client travel estimates.
    for (const day of itinerary.days || []) {
      for (const stop of day.stops || []) {
        const start = minute(stop.start_time), stay = Number(stop.stay_min);
        if (start === null || !Number.isInteger(stay) || stay < 0 || start + stay >= 1440) return { status: 'validation_failed', reason: 'invalid_stop_time' };
        const end = start + stay;
        stop.end_time = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      }
      for (const stop of day.stops || []) if (food(stop)) {
        const row = rowFor(stop, rows, day.city), startMin = minute(stop.start_time);
        if (!row || startMin === null) return { status: 'information_unknown', reason: 'restaurant_or_time_unknown' };
        if (stop.reservation_required && (stop.lat !== row.lat || stop.lng !== row.lng || stop.address !== row.address)) return { status: 'validation_failed', reason: 'protected_stop_changed' };
        applyFoodRowToStop(stop, row, { diets: requirements.dietary, language: current.input?.language || 'en' });
        stop.restaurant_id = restaurantIdentity(row);
        const hours = await opening(row, { date: day.date, startMin, endMin: startMin + 60 });
        stop.opening_status = hours.status === 'verified_open' ? 'verified_open' : hours.status === 'closed' ? 'closed' : 'unknown';
        stop.opening_source_url = hours.sourceUrl || null; stop.opening_checked_at = hours.checkedAt || null;
        if (hours.status !== 'verified_open' && (!previewOpening || hours.status !== 'unknown')) return { status: hours.status === 'closed' ? 'validation_failed' : 'information_unknown', reason: 'opening_information' };
      }
      for (let i = 1; i < (day.stops || []).length; i++) {
        const prev = day.stops[i - 1], next = day.stops[i];
        const checked = await route({ from: prev, to: next, departMin: minute(prev.start_time) + Number(prev.stay_min) });
        if (checked?.status !== 'verified' || !Number.isFinite(checked.durationMin) || !checked.evidenceId) return { status: 'route_failed', reason: 'route_verification_failed' };
        next.transit_from_prev = { ...(checked.segment || {}), est_min: Math.ceil(checked.durationMin), evidence_id: checked.evidenceId };
        delete next._stale_transit; delete next.same_lodging_as_prev; next.travelFromPrev = null;
      }
    }
    const departureFailure = restoreServerDepartureProof(itinerary, current.input || {});
    if (departureFailure) return departureFailure;
    return validateMealPlan({ ...current, itinerary }, rows, opening, { previewOpening });
  };
  async function loadCurrent() {
    const plan = await repository.load();
    return plan ? { ...plan, revision: mealPlanRevision(plan), dbVersion, requirements: mealRequirements(plan) } : null;
  }
  async function rebuild(current, mealId, { previewOpening = false } = {}) {
    const allowUnconfirmedOpening = conditionalPlan(current);
    previewOpening = previewOpening || allowUnconfirmedOpening;
    const meal = mealContext(current, mealId);
    if (!meal) return { status: 'information_unknown', reason: 'meal_anchors_missing', options: [] };
    // With no dated opening evidence, stop before any route provider call.
    if (!previewOpening && !rows.some((row) => row.city === meal.city && Array.isArray(row.opening_evidence) && row.opening_evidence.some((fact) => fact && typeof fact === 'object' && !Array.isArray(fact) && fact.date === meal.date && fact.source_url && fact.checked_at))) return { status: 'information_unknown', reason: 'opening_information_missing', options: [] };
    const visitedIds = current.itinerary.days.filter((day) => Number(day.day) <= Number(meal.day)).flatMap((day) => {
      const stops = day.stops || [];
      const before = Number(day.day) < Number(meal.day) ? stops : stops.slice(0, stops.findIndex((stop) => stop.meal_slot_id === mealId));
      return before.map((stop) => stop.restaurant_id).filter(Boolean);
    });
    return buildVerifiedMealOptions({ rows, meal, visitedIds, requirements: current.requirements, itinerary: current.itinerary,
      revision: current.revision, dbVersion, baselineRestaurantId: current.itinerary.days.flatMap((day) => day.stops || []).find((stop) => stop.meal_slot_id === mealId)?.restaurant_id, maxRouteCalls: 64, previewOpening, allowUnconfirmedOpening }, { route, opening: ({ row, ...time }) => opening(row, time),
      validateItinerary: (itinerary) => validate(itinerary, current, { previewOpening }) });
  }
  async function baselineReference(current, mealId) {
    // A valid existing baseline can be shown even when an alternative cannot fit
    // between fixed anchors. This never authorizes selection or checkout.
    const itinerary = structuredClone(current.itinerary);
    const checked = await validate(itinerary, current, { previewOpening: true });
    if (checked.status !== 'opening_unconfirmed') return [];
    const day = itinerary.days.find((value) => value.stops?.some((stop) => stop.meal_slot_id === mealId));
    const stop = day?.stops.find((value) => value.meal_slot_id === mealId);
    const row = stop && rowFor(stop, rows, day.city);
    if (!row) return [];
    const index = day.stops.indexOf(stop);
    const hours = await opening(row, { date: day.date, startMin: minute(stop.start_time), endMin: minute(stop.start_time) + 60 });
    return [{ id: restaurantIdentity(row), name: stop.display_name || stop.name, mealId,
      openingStatus: hours.status === 'verified_open' ? 'verified_open' : 'unknown', referenceOnly: true,
      startMin: minute(stop.start_time), endMin: minute(stop.start_time) + 60,
      inboundMin: index ? stop.transit_from_prev.est_min : null,
      outboundMin: day.stops[index + 1]?.transit_from_prev?.est_min,
      openingSourceUrl: hours.sourceUrl || null, openingCheckedAt: hours.checkedAt || null,
      verificationStatus: current.requirements.dietary.map((diet) => dietaryEvidenceFor(row, diet)?.verification_status).filter(Boolean).join(', ') || 'DB listing',
    }];
  }
  const adapters = { loadCurrent, rebuild, validateItinerary: validate,
    compareAndSave: async (expected, proposal) => {
      if (proposal.mealId) {
        const current = await loadCurrent();
        if (current.revision !== expected.revision) return false;
        const choices = await rebuild(current, proposal.mealId);
        if (choices.status !== 'feasible') return false;
        proposal.itinerary.meal_options = (proposal.itinerary.meal_options || []).map((meal) => meal.mealId === proposal.mealId ? {
          mealId: meal.mealId, day: meal.day, status: 'feasible', baselineId: proposal.candidateId, selectedId: proposal.selectedId,
          options: choices.options.map(({ itinerary: _itinerary, evidenceIds: _evidence, rowFingerprint: _fingerprint, ...view }) => view),
        } : { ...meal, status: 'information_unknown', options: [] });
      }
      const current = await loadCurrent();
      applyMealSlotNotes(proposal.itinerary, current.input?.language || 'en');
      return repository.compareAndSave(expected, proposal);
    } };
  return {
    async load() {
      const current = await loadCurrent();
      const meals = [];
      for (const slot of current.itinerary.meal_options || []) {
        let built = await rebuild(current, slot.mealId);
        if (built.status === 'information_unknown' && ['opening_information', 'opening_information_missing', 'meal_anchors_missing', 'verification_information_missing'].includes(built.reason)) {
          const preview = await rebuild(current, slot.mealId, { previewOpening: true });
          const references = preview.referenceOptions?.length ? preview.referenceOptions : await baselineReference(current, slot.mealId);
          built = { ...built, referenceOptions: references.map(({ itinerary: _itinerary, evidenceIds: _evidence, rowFingerprint: _fingerprint, ...view }) => view) };
        }
        const actual = current.itinerary.days.flatMap((day) => day.stops || []).find((stop) => stop.meal_slot_id === slot.mealId)?.restaurant_id;
        const baselinePresent = (built.options || []).some((option) => option.id === actual);
        meals.push({ ...slot, ...built, mealId: slot.mealId, day: slot.day,
          baselineId: baselinePresent ? actual : null, selectedId: baselinePresent ? slot.selectedId || null : null,
          baselineInvalid: built.status === 'feasible' && !baselinePresent,
          options: (built.options || []).map(({ itinerary: _itinerary, evidenceIds: _evidence, rowFingerprint: _fingerprint, ...view }) => view) });
      }
      return { ok: true, revision: current.revision, meals };
    },
    async select(command) {
      const current = await loadCurrent();
      const draft = { planId: current.planId, revision: current.revision, dbVersion };
      const request = { ...command, draft };
      if (command.action === 'preview') {
        const result = await prepareMealSelection(request, adapters);
        const { proposal: _proposal, ...publicResult } = result;
        return { ok: true, ...publicResult, changes: result.proposal ? visibleMealChanges(current.itinerary, result.proposal.itinerary, current.input?.language || 'en') : [] };
      }
      const result = await commitMealSelection(request, adapters);
      const after = result.status === 'saved' ? await loadCurrent() : current;
      return { ok: true, ...result, revision: after.revision };
    },
    async validateEdit(days, baseRevision) {
      const current = await loadCurrent();
      if (current.revision !== baseRevision) return { status: 'revision_conflict' };
      if (days.length !== current.itinerary.days.length) return { status: 'validation_failed', reason: 'day_structure_changed' };
      const sanitized = [];
      for (const [dayIndex, oldDay] of current.itinerary.days.entries()) {
        const incoming = days[dayIndex];
        if (!Array.isArray(incoming?.stops)) return { status: 'validation_failed', reason: 'invalid_stops' };
        const oldById = new Map(oldDay.stops.map((stop, index) => [stop.plan_stop_id || `day-${oldDay.day}-stop-${index + 1}`, stop]));
        const used = new Set(); const stops = [];
        for (const item of incoming.stops) {
          const source = oldById.get(item.plan_stop_id);
          if (source) {
            if (used.has(item.plan_stop_id)) return { status: 'validation_failed', reason: 'duplicate_stop_identity' };
            used.add(item.plan_stop_id);
            const protectedStop = source.reservation_required || source._departure_airport_stop;
            if (protectedStop && ['name','address','lat','lng','category','start_time','stay_min'].some((key) => item[key] !== source[key])) return { status: 'validation_failed', reason: 'protected_stop_changed' };
            stops.push({ ...structuredClone(source), ...(protectedStop ? {} : { start_time: item.start_time, stay_min: item.stay_min }) });
          } else {
            if (item.plan_stop_id) return { status: 'validation_failed', reason: 'unknown_stop_identity' };
            stops.push({ plan_stop_id: randomUUID(), name: item.name, display_name: item.display_name || item.name, address: item.address,
              lat: item.lat, lng: item.lng, category: item.category, start_time: item.start_time, stay_min: item.stay_min, _userAdded: true });
          }
        }
        if ([...oldById].some(([id, stop]) => (stop.meal_slot_id || stop.reservation_required || stop._departure_airport_stop) && !used.has(id))) return { status: 'validation_failed', reason: 'required_stop_removed' };
        sanitized.push({ ...structuredClone(oldDay), stops });
      }
      const itinerary = attachMealOptionState({ ...structuredClone(current.itinerary), days: sanitized }, rows);
      for (const day of current.itinerary.days || []) for (const stop of day.stops || []) {
        if (!stop.reservation_required && !stop._departure_airport_stop) continue;
        const kept = (itinerary.days || []).flatMap((d) => d.stops || []).find((s) => s.name === stop.name && s.start_time === stop.start_time);
        if (!kept) return { status: 'validation_failed', reason: 'protected_stop_changed' };
      }
      const checked = await validate(itinerary, current);
      if (checked.status !== 'verified' && !(conditionalPlan(current) && checked.status === 'opening_unconfirmed')) return checked;
      const saved = await repository.compareAndSave({ planId: current.planId, revision: baseRevision, dbVersion }, { itinerary, dbVersion });
      return { status: saved ? 'saved' : 'revision_conflict' };
    },
    async validateDraft() { const current = await loadCurrent(); return validate(current.itinerary, current); },
    async previewDraft() { const current = await loadCurrent(); return validate(current.itinerary, current, { previewOpening: true }); },
  };
}
