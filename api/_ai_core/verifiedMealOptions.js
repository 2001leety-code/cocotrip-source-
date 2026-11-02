import { canServeMeal } from '../_shared/meal-venue.js';
import { createHash } from 'node:crypto';
import { dietaryEvidenceFor } from '../_shared/dietary-trust.js';
import { isRowCityConsistent } from '../_shared/food-row-provenance.js';

// Server-only contract. Adapters must use server-owned DB, opening information and routes.
// No online adapter or payment/editor integration is enabled by this module.
export const MEAL_STAY_MIN = 60;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integerMin = (value) => Number.isInteger(value) && value >= 0 && value <= 1440;
const failedValidation = (check) => ({ status: ['information_unknown', 'route_failed'].includes(check?.status) ? check.status : 'validation_failed', ...(check?.reason ? { reason: check.reason } : {}) });
const point = (row) => row && typeof row.lat === 'number' && typeof row.lng === 'number'
  && Number.isFinite(row.lat) && Number.isFinite(row.lng) && Math.abs(row.lat) <= 90 && Math.abs(row.lng) <= 180;
export const restaurantIdentity = (row) => digest([row.placeId || null, row.city, row.name, row.address, row.lat, row.lng]);
const distance = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
};
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const segment = (route) => ({ ...(route.segment || {}), est_min: route.durationMin, duration_min: route.durationMin, evidence_id: route.evidenceId });
const failure = (status, reason, diagnostics = {}) => ({ status, reason, options: [], baselineId: null, selectedId: null, diagnostics });

// This contract verifies religious/lifestyle restrictions, not medical safety.
// Uncollected medical information stays absent; it is never converted to [].
export function mealRequirementIssue(requirements) {
  if (!requirements || !Array.isArray(requirements.dietary)) return 'dietary_input_missing';
  if (requirements.healthConditionMentioned || requirements.medicalInputMalformed
      || (requirements.allergies !== undefined && (!Array.isArray(requirements.allergies) || requirements.allergies.length))) return 'allergy_evidence_required';
  return null;
}

function safetyOf(row, requirements) {
  const evidence = [];
  for (const diet of requirements.dietary) {
    if (!['halal', 'vegan', 'vegetarian'].includes(String(diet).toLowerCase())) return { status: 'information_unknown', reason: 'unsupported_diet' };
    const item = dietaryEvidenceFor(row, diet);
    if (!item) return { status: 'no_match', reason: 'dietary_evidence_missing' };
    evidence.push(item);
  }
  // Automated false allergen flags are not evidence of cross-contamination safety.
  if (mealRequirementIssue(requirements)) return { status: 'information_unknown', reason: 'allergy_evidence_required' };
  return { status: 'eligible', evidence };
}

/** Build up to three individually feasible alternatives. Repeats are never excluded for variety.
 * Inputs and callbacks are a server contract; never expose callbacks or trust decisions to a client.
 * The caller supplies an explicit computation budget, not a customer distance/time policy.
 */
export async function buildVerifiedMealOptions(input, adapters) {
  const { rows, requirements, meal, itinerary, revision, dbVersion, visitedIds = [], maxRouteCalls } = input;
  const requirementIssue = mealRequirementIssue(requirements);
  if (requirementIssue) return failure('information_unknown', requirementIssue);
  if (!Array.isArray(rows) || !dbVersion || !revision || !meal?.id || !Array.isArray(itinerary?.days)) return failure('information_unknown', 'server_context_missing');
  const previous = meal.previous || meal.hotelAnchor;
  const next = meal.next || meal.hotelAnchor;
  if (!point(previous) || !point(next) || !integerMin(meal.readyMin) || !integerMin(meal.latestStartMin)
      || !integerMin(meal.windowFrom) || !integerMin(meal.nextDeadlineMin) || !integerMin(meal.activityDeadlineMin)
      || !integerMin(meal.bufferMin) || !Number.isInteger(maxRouteCalls) || maxRouteCalls < 2) return failure('information_unknown', 'schedule_or_budget_missing');
  if (typeof adapters?.route !== 'function' || typeof adapters?.opening !== 'function' || typeof adapters?.validateItinerary !== 'function') return failure('information_unknown', 'verification_adapter_missing');
  const diagnostics = { eligible: 0, unknown: 0, closed: 0, routeFailed: 0, infeasible: 0, routeCalls: 0, budgetExhausted: false };
  const seen = new Set();
  const pool = [];
  for (const row of rows) {
    if (!row || row.city !== meal.city || !isRowCityConsistent(row) || !canServeMeal(row)) continue;
    const safety = safetyOf(row, requirements);
    if (safety.status === 'information_unknown') { diagnostics.unknown++; continue; }
    if (safety.status !== 'eligible') continue;
    if (!point(row)) { diagnostics.unknown++; continue; }
    const id = restaurantIdentity(row);
    if (seen.has(id)) continue;
    seen.add(id);
    pool.push({ row, id, evidence: safety.evidence, proximity: distance(previous, row) + distance(row, next) });
  }
  diagnostics.eligible = pool.length;
  // Distance orders the city pool; no unapproved km radius or travel limit is introduced.
  pool.sort((a, b) => Number(b.id === input.baselineRestaurantId) - Number(a.id === input.baselineRestaurantId) || a.proximity - b.proximity || a.id.localeCompare(b.id));
  const options = [];
  const referenceOptions = [];
  const previewOpening = input.previewOpening === true;
  const allowUnconfirmedOpening = input.allowUnconfirmedOpening === true; // Server-only read preview; never accepted by checkout.
  for (const item of pool) {
    if (options.length + referenceOptions.length === 3) break;
    if (diagnostics.routeCalls + 2 > maxRouteCalls) { diagnostics.budgetExhausted = true; break; }
    let inbound, outbound, opening, validation;
    let phase = 'route';
    try {
      diagnostics.routeCalls++;
      inbound = await adapters.route({ from: previous, to: item.row, departMin: meal.readyMin });
      if (inbound?.status !== 'verified' || !finite(inbound.durationMin) || !inbound.evidenceId) { diagnostics.routeFailed++; continue; }
      inbound = { ...inbound, durationMin: Math.ceil(inbound.durationMin) };
      const startMin = Math.max(meal.readyMin + inbound.durationMin + meal.bufferMin, meal.windowFrom);
      const endMin = startMin + MEAL_STAY_MIN;
      if (startMin > meal.latestStartMin || endMin > meal.activityDeadlineMin || endMin >= 1440) { diagnostics.infeasible++; continue; }
      phase = 'opening';
      opening = await adapters.opening({ row: item.row, date: meal.date, startMin, endMin });
      if (opening?.status === 'closed') { diagnostics.closed++; continue; }
      const openingKnown = opening?.status === 'verified_open' && opening.sourceUrl && opening.checkedAt;
      if (!openingKnown && (!previewOpening || opening?.status !== 'unknown')) { diagnostics.unknown++; continue; }
      phase = 'route';
      diagnostics.routeCalls++;
      outbound = await adapters.route({ from: item.row, to: next, departMin: endMin });
      if (outbound?.status !== 'verified' || !finite(outbound.durationMin) || !outbound.evidenceId) { diagnostics.routeFailed++; continue; }
      outbound = { ...outbound, durationMin: Math.ceil(outbound.durationMin) };
      if (endMin + outbound.durationMin + meal.bufferMin > meal.nextDeadlineMin) { diagnostics.infeasible++; continue; }
      const replacement = {
        name: item.row.name, display_name: item.row.nameEn || item.row.name, address: item.row.address,
        lat: item.row.lat, lng: item.row.lng, category: 'food', stay_min: MEAL_STAY_MIN,
        start_time: hhmm(startMin), end_time: hhmm(endMin), verified: true,
        dietary_tags: item.row.tag ? [item.row.tag] : [],
        ...(item.row.googleMapsUrl ? { googleMapsUrl: item.row.googleMapsUrl } : {}),
        transit_from_prev: segment(inbound), travelFromPrev: null,
        meal_slot_id: meal.id, restaurant_id: item.id, dietary_evidence: item.evidence,
      };
      const proposed = clone(itinerary);
      const day = proposed.days.find((d) => Number(d.day) === Number(meal.day));
      const index = day?.stops?.findIndex((s) => s.meal_slot_id === meal.id);
      if (!day || index === undefined || index < 0) return failure('information_unknown', 'meal_slot_missing', diagnostics);
      // Keep only slot identity/order, never the old restaurant's hours, links, tips or route.
      const old = day.stops[index];
      if (old.reservation_required && (old.restaurant_id !== item.id || old.start_time !== replacement.start_time || old.stay_min !== MEAL_STAY_MIN)) {
        diagnostics.infeasible++; continue;
      }
      day.stops[index] = old.reservation_required ? { ...old, ...replacement }
        : { order: old.order, plan_stop_id: old.plan_stop_id, ...replacement };
      if (day.stops[index + 1]) {
        day.stops[index + 1].transit_from_prev = segment(outbound);
        day.stops[index + 1].travelFromPrev = null;
      }
      // Must revalidate the whole itinerary, including downstream meals, fixed bookings and departure.
      phase = 'validation';
      validation = await adapters.validateItinerary(proposed, { requirements, meal, revision, dbVersion });
      if ((!previewOpening && validation?.status !== 'verified') || (previewOpening && !['verified', 'opening_unconfirmed'].includes(validation?.status)) || !validation.evidenceId) {
        if (validation?.status === 'information_unknown') diagnostics.unknown++;
        else if (validation?.status === 'route_failed') diagnostics.routeFailed++;
        else diagnostics.infeasible++;
        continue;
      }
      const referenceOnly = !openingKnown || validation.status === 'opening_unconfirmed';
      (referenceOnly && !allowUnconfirmedOpening ? referenceOptions : options).push({
        openingStatus: openingKnown ? 'verified_open' : 'unknown', referenceOnly: referenceOnly && !allowUnconfirmedOpening,
        openingSourceUrl: opening.sourceUrl || null, openingCheckedAt: opening.checkedAt || null,
        id: item.id, name: replacement.display_name, baseline: options.length === 0, mealId: meal.id,
        startMin, endMin, inboundMin: inbound.durationMin, outboundMin: outbound.durationMin,
        evidence: item.evidence, verificationStatus: item.evidence.map((e) => e.verification_status).join(', ') || 'DB listing',
        sourceUrl: opening.sourceUrl, checkedAt: opening.checkedAt,
        repeatReason: visitedIds.includes(item.id) ? 'verified_repeat' : null,
        rowFingerprint: digest(item.row), itinerary: proposed,
        evidenceIds: [inbound.evidenceId, outbound.evidenceId, validation.evidenceId],
      });
    } catch { if (phase === 'route') diagnostics.routeFailed++; else diagnostics.unknown++; }
  }
  if (!options.length && referenceOptions.length) return { ...failure('information_unknown', 'opening_information', diagnostics), referenceOptions };
  if (!options.length) {
    if (diagnostics.unknown) return failure('information_unknown', 'verification_information_missing', diagnostics);
    if (diagnostics.routeFailed) return failure('route_failed', 'route_verification_failed', diagnostics);
    if (diagnostics.budgetExhausted) return failure('information_unknown', 'computation_budget_exhausted', diagnostics);
    return failure('no_match', 'no_feasible_verified_restaurant', diagnostics);
  }
  return { referenceOptions, status: 'feasible', baselineId: options[0].id, selectedId: null, options, diagnostics,
    revision, dbVersion, inputFingerprint: digest({ requirements, meal, itinerary, revision, dbVersion }) };
}

/** A draft is a server-owned snapshot, never a client receipt or a payment authorization. */
export async function prepareMealSelection({ draft, baseRevision, mealId, candidateId }, adapters) {
  if (!draft || draft.revision !== baseRevision) return { status: 'revision_conflict' };
  const current = await adapters.loadCurrent();
  if (!current || !draft.planId || current.planId !== draft.planId || current.revision !== baseRevision || current.dbVersion !== draft.dbVersion) return { status: 'revision_conflict' };
  const built = await adapters.rebuild(current, mealId);
  if (built.status !== 'feasible') return built;
  const option = built.options.find((item) => item.id === candidateId);
  if (!option) return { status: 'candidate_unavailable' };
  const check = await adapters.validateItinerary(option.itinerary, current);
  if ((check?.status !== 'verified' && !(check?.status === 'opening_unconfirmed' && current.mealDraftBinding?.openingNoticeVersion === 'meal-opening-unconfirmed-v1')) || !check.evidenceId) return failedValidation(check);
  // No auto-adjustment policy is assumed. Any unrelated stop/time/order change requires confirmation.
  const stripMeal = (itinerary) => itinerary.days.map((day) => ({ day: day.day, city: day.city, stops: day.stops.filter((s) => s.meal_slot_id !== mealId).map((s) => ({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, plan_stop_id: s.plan_stop_id, start_time: s.start_time, end_time: s.end_time, stay_min: s.stay_min, travel_min: s.transit_from_prev?.est_min })) }));
  const requiresConfirmation = digest(stripMeal(current.itinerary)) !== digest(stripMeal(option.itinerary));
  const proposal = { planId: current.planId, baseRevision, dbVersion: current.dbVersion, mealId, candidateId, itinerary: option.itinerary,
    evidenceId: check.evidenceId, requiresConfirmation, selectedId: candidateId };
  return { status: requiresConfirmation ? 'confirmation_required' : 'ready', proposal, proposalId: digest(proposal) };
}

/** Repository must atomically compare revision and save; no write happens before fresh validation. */
export async function commitMealSelection(command, adapters) {
  const fresh = await prepareMealSelection(command, adapters);
  if (!['ready', 'confirmation_required'].includes(fresh.status)) return fresh;
  if (command.proposalId !== fresh.proposalId) return { status: 'proposal_changed' };
  if (fresh.proposal.requiresConfirmation && command.confirmedProposalId !== fresh.proposalId) return fresh;
  const saved = await adapters.compareAndSave({ planId: fresh.proposal.planId, revision: fresh.proposal.baseRevision, dbVersion: fresh.proposal.dbVersion }, clone(fresh.proposal));
  return saved ? { status: 'saved', selectedId: fresh.proposal.selectedId } : { status: 'revision_conflict' };
}

/** Checkout integration must consume this exact server draft revision, not regenerate after payment.
 * This contract does not authorize or perform a charge. The current PayPal flow is not wired here.
 */
export async function verifyMealDraftForCheckout(draft, adapters) {
  if (!draft?.planId || !draft.revision || !draft.dbVersion || !Array.isArray(draft.meals) || !draft.meals.length) return { status: 'draft_incomplete' };
  const current = await adapters.loadCurrent();
  if (!current || current.planId !== draft.planId || current.revision !== draft.revision || current.dbVersion !== draft.dbVersion) return { status: 'revision_conflict' };
  for (const meal of draft.meals) {
    if (meal.status !== 'feasible' || !meal.options?.some((option) => option.id === meal.baselineId)) return { status: 'draft_incomplete' };
    const stop = current.itinerary?.days?.flatMap((day) => day.stops || []).find((item) => item.meal_slot_id === meal.mealId);
    if (!stop || stop.restaurant_id !== meal.baselineId || stop.stay_min !== MEAL_STAY_MIN) return { status: 'draft_changed' };
    const rebuilt = await adapters.rebuild(current, meal.mealId);
    if (rebuilt.status !== 'feasible') return { status: 'draft_changed', reason: rebuilt.status };
    const baseline = rebuilt.options.find((option) => option.id === meal.baselineId);
    if (!baseline || digest(baseline.itinerary) !== digest(current.itinerary)) return { status: 'draft_changed' };
  }
  const checked = await adapters.validateItinerary(current.itinerary, current);
  if (checked?.status !== 'verified' || !checked.evidenceId) return failedValidation(checked);
  return { status: 'verified_draft', planId: draft.planId, revision: current.revision, dbVersion: current.dbVersion,
    fingerprint: digest({ itinerary: current.itinerary, requirements: current.requirements, meals: draft.meals }), evidenceId: checked.evidenceId };
}
