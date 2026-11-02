import { describe, it, expect, vi } from 'vitest';
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: vi.fn(async () => ({ ok: false })) }));
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: vi.fn(async () => []) }));
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }) } }));
import { createPlanMealOptionsHandler } from '../../api/plan-meal-options.js';
import { attachMealOptionState, validateMealPlan, mealRequirements } from '../../api/_ai_core/mealPlanIntegration.js';
const fixtureRows = () => [1,2].map((n) => ({ name: `Fixture ${n}`, nameEn: `Fixture ${n}`, address: 'Seoul fixture', city: 'seoul',
  lat: 37.55 + n / 1000, lng: 126.99, tag: 'halal', verification_status: 'halal_certified',
  opening_evidence: [{ date: '2026-12-01', from: '10:00', to: '16:00', source_url: 'https://example.test/hours', checked_at: '2026-11-02' }] }));
function setup(protectedAirport = false, inputOverrides = {}, checkRateLimit = async () => ({ ok: true }), openingNoticeVersion = '') {
  const rows = fixtureRows();
  let plan = { uid: 'owner', isPublic: true, mealDraftBinding: { openingNoticeVersion }, mealOptionsRevision: 'r1', input: { dietary: ['Halal'], area: 'seoul',
    tour_end_time: '16:00', meal_windows: { lunch: { from: '11:00', to: '15:00' }, dinner: null } },
    itinerary: { days: [{ day: 1, city: 'seoul', date: '2026-12-01', stops: [
      { name: 'Museum', category: 'culture', start_time: '10:00', stay_min: 60, lat: 37.55, lng: 126.98 },
      { name: 'Fixture 1', display_name: 'Fixture 1', category: 'food', start_time: '12:00', stay_min: 60, lat: rows[0].lat, lng: rows[0].lng, verified: true,
        dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }], dietary_tags: ['halal'], transit_from_prev: { est_min: 20 } },
      { name: 'Gallery', category: 'culture', start_time: '15:00', stay_min: 30, lat: 37.56, lng: 126.99, transit_from_prev: { est_min: 20 } },
    ] }] } };
  if (protectedAirport) {
    Object.assign(plan.input, { departure_time: '21:00', departure_airport: 'ICN_T1' });
    plan.itinerary.days[0].stops.push({ name: 'Airport', category: 'travel', start_time: '18:00', stay_min: 0,
      lat: 37.4602, lng: 126.4407, _departure_airport_stop: true } as never);
  }
  Object.assign(plan.input, inputOverrides);
  attachMealOptionState(plan.itinerary, rows);
  let writes = 0, tail = Promise.resolve();
  const snapshot = () => ({ exists: true, data: () => structuredClone(plan) });
  const ref = { get: vi.fn(async () => snapshot()) };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: (action) => {
    const next = tail.then(() => action({ get: async () => snapshot(), update: (_ref, patch) => { plan = { ...plan, ...structuredClone(patch) }; writes++; } }));
    tail = next.then(() => undefined, () => undefined); return next;
  } };
  const route = vi.fn(async () => ({ status: 'verified', durationMin: 20, evidenceId: 'fixture-route', segment: { method: 'bus' } }));
  const handler = createPlanMealOptionsHandler({ db, checkRateLimit, loadRows: async () => rows, route, authenticate: async (req) => ({ ok: req.headers.authorization === 'owner', uid: 'owner' }) });
  async function call(body, owner = true) {
    let status = 0, json;
    await handler({ method: 'POST', body: { planId: 'p1', ...body }, headers: { authorization: owner ? 'owner' : '' } },
      { writeHead: (n) => { status = n; }, end: (text) => { json = JSON.parse(text); } });
    return { httpStatus: status, ...json };
  }
  return { rows, route, call, current: () => structuredClone(plan), writes: () => writes };
}
describe('actual meal API + actual validators + transactional memory repository', () => {
  it('blocks rate protection failures before route verification or writes', async () => {
    const guard = vi.fn(async () => ({ ok: false, status: 503, reason: 'rate_limit_unavailable' }));
    const s = setup(false, {}, guard); const result = await s.call({ action: 'load' });
    expect(result.httpStatus).toBe(503); expect(result.status).toBe('rate_limit_unavailable');
    expect(s.route).not.toHaveBeenCalled(); expect(s.writes()).toBe(0);
  });
  it('generates slot metadata, loads real candidates, previews and atomically stores a selection', async () => {
    const s = setup(); const loaded = await s.call({ action: 'load' });
    expect(loaded.httpStatus).toBe(200); expect(loaded.meals[0].status).toBe('feasible');
    expect(loaded.meals[0].options).toHaveLength(2);
    const command = { mealId: loaded.meals[0].mealId, candidateId: loaded.meals[0].options[1].id, baseRevision: loaded.revision };
    const preview = await s.call({ ...command, action: 'preview' });
    expect(['ready', 'confirmation_required']).toContain(preview.status);
    expect(s.writes()).toBe(0);
    const saved = await s.call({ ...command, action: 'commit', proposalId: preview.proposalId, confirmedProposalId: preview.proposalId });
    expect(saved.status).toBe('saved'); expect(s.writes()).toBe(1);
    expect(saved.plan.planId).toBe('p1');
    expect(saved.plan.itinerary).toEqual(s.current().itinerary);
    expect(s.current().itinerary.days[0].stops[1].restaurant_id).toBe(command.candidateId);
    expect(s.current().itinerary.days[0].stops[1].stay_min).toBe(60);
    const reloaded = await s.call({ action: 'load' });
    expect(reloaded.meals[0].selectedId).toBe(command.candidateId);
    expect(reloaded.meals[0].baselineId).toBe(command.candidateId);
    const edit = await s.call({ action: 'edit', days: s.current().itinerary.days, baseRevision: saved.revision });
    expect(edit.status).toBe('saved');
  });
  it('allows each independently verified restaurant revisit, while rejecting duplicate slot identity and attractions', async () => {
    const s = setup(); const plan = s.current();
    plan.input.tour_end_time = '21:00';
    const second = structuredClone(plan.itinerary.days[0].stops[1]);
    second.start_time = '18:00'; second.plan_stop_id += '-repeat'; second.meal_slot_id += '-repeat';
    plan.itinerary.days[0].stops.push(second);
    expect(await validateMealPlan(plan, s.rows, async () => ({ status: 'verified_open' }))).toEqual({ status: 'verified', evidenceId: expect.any(String) });
    second.meal_slot_id = plan.itinerary.days[0].stops[1].meal_slot_id;
    expect(await validateMealPlan(plan, s.rows)).toMatchObject({ status: 'validation_failed', reason: 'duplicate_stop_identity' });
    second.meal_slot_id += '-repeat';
    plan.itinerary.days[0].stops[2].name = plan.itinerary.days[0].stops[0].name;
    expect((await validateMealPlan(plan, s.rows)).status).toBe('validation_failed');
  });
  it('shares read-only candidates but denies preview or commit without ownership', async () => {
    const s = setup(); expect((await s.call({ action: 'load' }, false)).httpStatus).toBe(200);
    expect((await s.call({ action: 'preview' }, false)).httpStatus).toBe(403); expect(s.writes()).toBe(0);
  });
  it('opening data missing returns route-checked references but cannot be committed', async () => {
    const s = setup(); for (const row of s.rows) row.opening_evidence = [];
    const loaded = await s.call({ action: 'load' });
    expect(loaded.meals[0].status).toBe('information_unknown');
    expect(loaded.meals[0].options).toEqual([]);
    expect(loaded.meals[0].referenceOptions).toHaveLength(2);
    expect(loaded.meals[0].referenceOptions[0]).toMatchObject({ openingStatus: 'unknown', referenceOnly: true, inboundMin: 20, outboundMin: 20 });
    expect((await s.call({ action: 'commit', baseRevision: 'r1', mealId: loaded.meals[0].mealId, candidateId: 'forged', proposalId: 'forged' })).status).toBe('information_unknown');
    expect(s.writes()).toBe(0);
  });
  it('retains disclosed unknown opening through selection and edit but still refuses known closure', async () => {
    const s = setup(false, {}, async () => ({ ok: true }), 'meal-opening-unconfirmed-v1');
    for (const row of s.rows) row.opening_evidence = [];
    const loaded = await s.call({ action: 'load' });
    expect(loaded.meals[0].status).toBe('feasible');
    expect(loaded.meals[0].options[1].openingStatus).toBe('unknown');
    const command = { mealId: loaded.meals[0].mealId, candidateId: loaded.meals[0].options[1].id, baseRevision: loaded.revision };
    const preview = await s.call({ ...command, action: 'preview' });
    expect(['ready', 'confirmation_required']).toContain(preview.status);
    expect((await s.call({ ...command, action: 'commit', proposalId: preview.proposalId, confirmedProposalId: preview.proposalId })).status).toBe('saved');
    expect(s.current().itinerary.days[0].stops[1].opening_status).toBe('unknown');
    const revision = s.current().mealOptionsRevision;
    expect((await s.call({ action: 'edit', days: s.current().itinerary.days, baseRevision: revision })).status).toBe('saved');
    for (const row of s.rows) row.opening_evidence = [{ date: '2026-12-01', closed: true, source_url: 'https://example.test/hours', checked_at: '2026-11-02' } as never];
    expect((await s.call({ action: 'validate_draft' })).status).toBe('validation_failed');
  });
  it('malformed opening evidence never becomes verified opening', async () => {
    const s = setup(); for (const row of s.rows) row.opening_evidence = [null as never];
    const loaded = await s.call({ action: 'load' });
    expect(loaded.httpStatus).toBe(200); expect(loaded.meals[0].status).toBe('information_unknown');
    expect(loaded.meals[0].options).toEqual([]); expect(s.writes()).toBe(0);
  });
  it('fresh route validation refuses client-forged zero travel before edit writes', async () => {
    const s = setup(); const days = s.current().itinerary.days;
    days[0].stops[1].start_time = '11:01'; days[0].stops[1].transit_from_prev = { est_min: 0 };
    const result = await s.call({ action: 'edit', days, baseRevision: 'r1' });
    expect(result.status).toBe('validation_failed'); expect(s.route).toHaveBeenCalled(); expect(s.writes()).toBe(0);
  });
  it('two simultaneous commits cannot write the same base revision twice', async () => {
    const s = setup(); const loaded = await s.call({ action: 'load' });
    const command = { mealId: loaded.meals[0].mealId, candidateId: loaded.meals[0].options[1].id, baseRevision: loaded.revision };
    const p = await s.call({ ...command, action: 'preview' });
    const results = await Promise.all([1,2].map(() => s.call({ ...command, action: 'commit', proposalId: p.proposalId, confirmedProposalId: p.proposalId })));
    expect(results.filter((r) => r.status === 'saved')).toHaveLength(1); expect(s.writes()).toBe(1);
  });
  it('server reconstruction refuses forged airport coordinates or removed meal identities and internal flags', async () => {
    const s = setup(); const days = s.current().itinerary.days;
    days[0].stops = days[0].stops.filter((stop) => stop.category !== 'food');
    delete days[0]._day1PlacementSolved; delete days[0]._routeMealRemoved;
    expect((await s.call({ action: 'edit', days, baseRevision: 'r1' })).status).toBe('validation_failed');
    expect(s.writes()).toBe(0);
  });
  it('protected airport geometry cannot be altered while retaining its name and time', async () => {
    const s = setup(true); const days = s.current().itinerary.days;
    days[0].stops[3].lat = 37.55; days[0].stops[3].lng = 126.98;
    expect(await s.call({ action: 'edit', days, baseRevision: 'r1' })).toMatchObject({ status: 'validation_failed', reason: 'protected_stop_changed' });
    expect(s.writes()).toBe(0); expect(s.route).not.toHaveBeenCalled();
  });
  it('pre-payment validation uses actual itinerary and opening facts without writes', async () => {
    const s = setup(); expect((await s.call({ action: 'validate_draft' })).status).toBe('verified'); expect(s.writes()).toBe(0);
    s.rows[0].opening_evidence[0].closed = true;
    expect((await s.call({ action: 'validate_draft' })).status).toBe('validation_failed'); expect(s.writes()).toBe(0);
  });
  it('returns a full snapshot to the owner but denies it to a public viewer', async () => {
    const s = setup();
    const owner = await s.call({ action: 'snapshot' });
    expect(owner).toMatchObject({ httpStatus: 200, ok: true, plan: { planId: 'p1' } });
    expect(owner.plan.itinerary).toEqual(s.current().itinerary);
    expect((await s.call({ action: 'snapshot' }, false)).httpStatus).toBe(403);
    expect(s.writes()).toBe(0);
  });
  it('recomputes end_time from edited start and stay in the canonical saved plan', async () => {
    const s = setup(); const days = s.current().itinerary.days;
    days[0].stops[0].start_time = '09:45'; days[0].stops[0].stay_min = 45;
    days[0].stops[0].end_time = '23:59';
    const result = await s.call({ action: 'edit', days, baseRevision: 'r1' });
    expect(result).toMatchObject({ status: 'saved', plan: { planId: 'p1' } });
    expect(result.plan.itinerary.days[0].stops[0]).toMatchObject({ start_time: '09:45', stay_min: 45, end_time: '10:30' });
    expect(result.plan.itinerary).toEqual(s.current().itinerary);
  });
  it('rejects activity before arrival readiness without a write', async () => {
    const s = setup(false, { arrival_time: '10:00', arrival_airport: 'ALREADY' });
    const days = s.current().itinerary.days;
    days[0].stops[0].start_time = '09:59';
    expect(await s.call({ action: 'edit', days, baseRevision: 'r1' })).toMatchObject({ status: 'validation_failed', reason: 'outside_activity_window' });
    expect(s.writes()).toBe(0);
  });
  it('rejects activity at or after the tour end without a write', async () => {
    const s = setup(); const days = s.current().itinerary.days;
    days[0].stops[2].start_time = '16:00';
    expect(await s.call({ action: 'edit', days, baseRevision: 'r1' })).toMatchObject({ status: 'validation_failed', reason: 'outside_activity_window' });
    expect(s.writes()).toBe(0);
  });

  it('allows lodging bookends before readiness and after tour end', async () => {
    const s = setup(false, { arrival_time: '10:00', arrival_airport: 'ALREADY' });
    const days = s.current().itinerary.days;
    days[0].stops.unshift({ name: 'Hotel departure', category: 'lodging', start_time: '09:30', stay_min: 0, lat: 37.55, lng: 126.98, _userAdded: true });
    days[0].stops.push({ name: 'Hotel return', category: 'lodging', start_time: '16:30', stay_min: 0, lat: 37.55, lng: 126.98, _userAdded: true });
    const result = await s.call({ action: 'edit', days, baseRevision: 'r1' });
    expect(result.status).toBe('saved');
    expect(result.plan.itinerary.days[0].stops[0]).toMatchObject({ category: 'lodging', start_time: '09:30' });
    expect(result.plan.itinerary.days[0].stops.at(-1)).toMatchObject({ category: 'lodging', start_time: '16:30' });
  });

});

describe('religious/lifestyle contract does not collect medical absence', () => {
  it('preserves omission, canonical empty precedence and supported aliases', () => {
    expect(mealRequirements({ input: { dietaryRestrictions: ['Halal'] } })).toMatchObject({ dietary: ['Halal'], allergies: undefined, healthConditionMentioned: false });
    expect(mealRequirements({ input: { dietaryRestrictions: [], allergies: ['Halal'] } })).toMatchObject({ dietary: [], allergies: [], healthConditionMentioned: false });
    expect(mealRequirements({ input: { planner_intent_v1: { allergies: ['Halal'] } } })).toMatchObject({ dietary: ['Halal'], allergies: [], healthConditionMentioned: false });
    expect(mealRequirements({ input: { dietPrefs: ['Seafood'], allergies: ['Halal'] } })).toMatchObject({ dietary: ['Halal'], healthConditionMentioned: false });
    expect(mealRequirements({ input: {} }).dietary).toBeUndefined();
  });
  it.each([
    { allergies: ['nuts'] }, { allergies: [['Halal']] }, { allergies: null }, { legacyAllergies: ['Halal', 'nuts'] },
    { planner_intent_v1: { allergies: ['nuts'] } }, { planner_intent_v1: { dietary: { allergies: ['nuts'] } } },
    { special_request: 'Severe peanut allergy' },
  ])('retains explicit unsupported requests before routing: %j', async (medical) => {
    const s = setup(false, { dietaryRestrictions: ['Halal'], ...medical });
    const result = await s.call({ action: 'load' });
    expect(result.meals[0].status).toBe('information_unknown'); expect(s.route).not.toHaveBeenCalled(); expect(s.writes()).toBe(0);
  });
});
