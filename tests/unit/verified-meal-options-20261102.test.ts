import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildVerifiedMealOptions, prepareMealSelection, commitMealSelection, verifyMealDraftForCheckout } from '../../api/_ai_core/verifiedMealOptions.js';

const row = (n: number, extra = {}) => ({ name: `Restaurant ${n}`, nameEn: `Restaurant ${n}`, city: 'seoul', address: 'Seoul restaurant',
  lat: 37.55 + n / 1000, lng: 126.98, tag: 'halal', verification_status: 'halal_certified', ...extra });
const requirements = { dietary: ['Halal'], allergies: [] };
const fixture = () => ({ rows: [row(1), row(2), row(3), row(4)], requirements, revision: 'r1', dbVersion: 'db1', maxRouteCalls: 20,
  meal: { id: 'lunch1', day: 1, city: 'seoul', date: '2026-12-01', readyMin: 660, windowFrom: 720, latestStartMin: 840,
    nextDeadlineMin: 960, activityDeadlineMin: 1000, bufferMin: 5,
    previous: { lat: 37.55, lng: 126.97 }, next: { lat: 37.56, lng: 126.99 } },
  itinerary: { days: [{ day: 1, stops: [{ name: 'Visit', start_time: '10:00' }, { name: 'Baseline', meal_slot_id: 'lunch1' }, { name: 'Airport', start_time: '16:00' }] }] } });
const adapters = () => ({ route: vi.fn(async () => ({ status: 'verified', durationMin: 20, evidenceId: 'route-fixture' })),
  opening: vi.fn(async () => ({ status: 'verified_open', sourceUrl: 'https://example.test/hours', checkedAt: '2026-11-02' })),
  validateItinerary: vi.fn(async () => ({ status: 'verified', evidenceId: 'whole-day-fixture' })) });

describe('verified restaurant options: offline server contract', () => {
  it('keeps three independently checked candidates, a baseline and an explicit unselected state without mutating input', async () => {
    const input = fixture(); const before = structuredClone(input); const a = adapters();
    const result = await buildVerifiedMealOptions(input, a);
    expect(result).toMatchObject({ status: 'feasible', selectedId: null });
    expect(result.options).toHaveLength(3);
    expect(result.baselineId).toBe(result.options[0].id);
    expect(result.options.every((o) => o.endMin - o.startMin === 60 && o.inboundMin === 20 && o.outboundMin === 20)).toBe(true);
    expect(a.validateItinerary).toHaveBeenCalledTimes(3);
    expect(a.route).toHaveBeenCalledTimes(6);
    expect(input).toEqual(before);
  });
  it('allows one candidate and an already visited restaurant with an evidence-based reason', async () => {
    const input = { ...fixture(), rows: [row(1)] };
    const first = await buildVerifiedMealOptions(input, adapters());
    const repeat = await buildVerifiedMealOptions({ ...input, visitedIds: [first.options[0].id] }, adapters());
    expect(repeat.options).toHaveLength(1);
    expect(repeat.options[0].repeatReason).toBe('verified_repeat');
  });
  it('does not treat missing opening evidence as open or as a missing restaurant', async () => {
    const a = adapters(); a.opening.mockResolvedValue({ status: 'unknown' } as never);
    const result = await buildVerifiedMealOptions(fixture(), a);
    expect(result).toMatchObject({ status: 'information_unknown', options: [] });
    expect(a.validateItinerary).not.toHaveBeenCalled();
  });
  it('preview preserves unknown hours and requires whole-plan nonopening checks', async () => {
    const a = adapters(); a.opening.mockResolvedValue({ status: 'unknown' } as never);
    a.validateItinerary.mockResolvedValue({ status: 'opening_unconfirmed', evidenceId: 'schedule-fixture' } as never);
    const result = await buildVerifiedMealOptions({ ...fixture(), previewOpening: true }, a);
    expect(result).toMatchObject({ status: 'information_unknown', options: [], baselineId: null });
    expect(result.referenceOptions).toHaveLength(3);
    expect(result.referenceOptions.every(option => option.referenceOnly && option.openingStatus === 'unknown')).toBe(true);
    a.validateItinerary.mockResolvedValue({ status: 'validation_failed', reason: 'airport_arrival_buffer' } as never);
    expect(await buildVerifiedMealOptions({ ...fixture(), previewOpening: true }, a)).toMatchObject({ options: [] });
  });
  it('reports route failure separately and never substitutes zero travel', async () => {
    const a = adapters(); a.route.mockResolvedValue({ status: 'failed' } as never);
    expect(await buildVerifiedMealOptions(fixture(), a)).toMatchObject({ status: 'route_failed', options: [] });
    expect(a.opening).not.toHaveBeenCalled();
  });
  it('rejects incompatible dietary evidence, cross-city restaurants and airport deadline overruns', async () => {
    const input = fixture();
    expect(await buildVerifiedMealOptions({ ...input, rows: [row(1, { verification_status: 'unverified' }), row(2, { city: 'busan' })] }, adapters())).toMatchObject({ status: 'no_match' });
    expect(await buildVerifiedMealOptions({ ...input, meal: { ...input.meal, nextDeadlineMin: 780 } }, adapters())).toMatchObject({ status: 'no_match' });
  });
  it('supports the existing nonmedical contract without asserting allergy safety', async () => {
    expect(await buildVerifiedMealOptions({ ...fixture(), requirements: { dietary: ['Halal'] } }, adapters())).toMatchObject({ status: 'feasible' });
    expect(await buildVerifiedMealOptions({ ...fixture(), requirements: { dietary: ['Halal'], allergies: ['nuts'] } }, adapters())).toMatchObject({ status: 'information_unknown' });
  });
  it.each([null, 'nuts', ['nuts']])('blocks explicit unsupported medical information %j before routing', async (allergies) => {
    const a = adapters();
    expect(await buildVerifiedMealOptions({ ...fixture(), requirements: { dietary: ['Halal'], allergies } }, a)).toMatchObject({ status: 'information_unknown', reason: 'allergy_evidence_required' });
    expect(a.route).not.toHaveBeenCalled();
  });
  it('blocks a retained medical request even without a medical array', async () => {
    const a = adapters();
    expect(await buildVerifiedMealOptions({ ...fixture(), requirements: { dietary: ['Halal'], healthConditionMentioned: true } }, a)).toMatchObject({ status: 'information_unknown' });
    expect(a.route).not.toHaveBeenCalled();
  });
  it('never converts search exhaustion or downstream meal failure to a valid option', async () => {
    const a = adapters(); a.route.mockResolvedValue({ status: 'failed' } as never);
    expect(await buildVerifiedMealOptions({ ...fixture(), maxRouteCalls: 2 }, a)).toMatchObject({ options: [] });
    const b = adapters(); b.validateItinerary.mockResolvedValue({ status: 'failed', reason: 'later dinner cannot fit' } as never);
    expect(await buildVerifiedMealOptions(fixture(), b)).toMatchObject({ status: 'no_match', options: [] });
  });
  it('retains explicit previous/next anchors and clears stale restaurant fields and routes', async () => {
    const input = fixture();
    Object.assign(input.meal, { hotelAnchor: { lat: 35, lng: 129 } });
    Object.assign(input.itinerary.days[0].stops[1], { end_time: '23:59', googleMapsUrl: 'https://old.test', tip: 'Old menu', transit_from_prev: { est_min: 999 } });
    const a = adapters(); const result = await buildVerifiedMealOptions(input, a);
    expect(a.route.mock.calls[0][0].from).toEqual(input.meal.previous);
    const stops = result.options[0].itinerary.days[0].stops;
    expect(stops[1].end_time).toBe('13:00');
    expect(stops[1].googleMapsUrl).toBeUndefined(); expect(stops[1].tip).toBeUndefined();
    expect(stops[1].transit_from_prev.est_min).toBe(20);
    expect(stops[2].transit_from_prev.est_min).toBe(20);
  });
  it('preserves whole-itinerary unknown and route-failure classifications', async () => {
    const a = adapters();
    a.validateItinerary.mockResolvedValue({ status: 'information_unknown' } as never);
    expect(await buildVerifiedMealOptions(fixture(), a)).toMatchObject({ status: 'information_unknown' });
    a.validateItinerary.mockResolvedValue({ status: 'route_failed' } as never);
    expect(await buildVerifiedMealOptions(fixture(), a)).toMatchObject({ status: 'route_failed' });
  });
  it('rounds verified fractional route durations up and refuses fractional schedule minutes', async () => {
    const a = adapters(); a.route.mockResolvedValue({ status: 'verified', durationMin: 0.5, evidenceId: 'fraction-fixture' });
    const input = fixture(); input.meal.readyMin = 720; input.meal.bufferMin = 0;
    const result = await buildVerifiedMealOptions(input, a);
    expect(result.options[0].inboundMin).toBe(1);
    expect(result.options[0].itinerary.days[0].stops[1].start_time).toBe('12:01');
    expect(await buildVerifiedMealOptions({ ...input, meal: { ...input.meal, readyMin: 720.5 } }, a)).toMatchObject({ status: 'information_unknown' });
  });
  it('real DB without opening information stays unknown using an offline opening adapter', async () => {
    const rows = JSON.parse(readFileSync('api/_food_index.json', 'utf8'));
    const a = adapters(); a.opening.mockResolvedValue({ status: 'unknown' } as never);
    const result = await buildVerifiedMealOptions({ ...fixture(), rows, maxRouteCalls: 5000 }, a);
    expect(result).toMatchObject({ status: 'information_unknown', options: [] });
    expect(result.diagnostics.unknown).toBeGreaterThan(0);
  });
});

describe('selection and pre-checkout revision contract: memory only', () => {
  async function setup() {
    const input = fixture(); const result = await buildVerifiedMealOptions(input, adapters());
    const current = { planId: 'p1', revision: 'r1', dbVersion: 'db1', requirements, itinerary: structuredClone(result.options[0].itinerary) };
    const draft = { ...current, meals: [{ ...result, mealId: 'lunch1' }] };
    const store = { loadCurrent: vi.fn(async () => structuredClone(current)), rebuild: vi.fn(async () => structuredClone(result)),
      validateItinerary: adapters().validateItinerary, compareAndSave: vi.fn(async () => true) };
    const command = { draft, baseRevision: 'r1', mealId: 'lunch1', candidateId: result.options[1].id };
    return { current, result, draft, store, command };
  }
  it('rebuilds and validates before one atomic compare-and-save, and refuses revision conflicts', async () => {
    const { store, command } = await setup();
    const preview = await prepareMealSelection(command, store);
    expect(store.compareAndSave).not.toHaveBeenCalled();
    expect(await commitMealSelection({ ...command, proposalId: preview.proposalId }, store)).toMatchObject({ status: 'saved' });
    expect(store.compareAndSave).toHaveBeenCalledTimes(1);
    expect(store.compareAndSave.mock.calls[0][0]).toEqual({ planId: 'p1', revision: 'r1', dbVersion: 'db1' });
    expect(await commitMealSelection({ ...command, baseRevision: 'stale', proposalId: preview.proposalId }, store)).toMatchObject({ status: 'revision_conflict' });
    expect(store.compareAndSave).toHaveBeenCalledTimes(1);
  });
  it('requires confirmation tied to the exact proposal for any unrelated itinerary change', async () => {
    const { store, command, result } = await setup();
    result.options[1].itinerary.days[0].stops[0].start_time = '09:30';
    const preview = await prepareMealSelection(command, store);
    expect(preview.status).toBe('confirmation_required');
    expect(await commitMealSelection({ ...command, proposalId: preview.proposalId }, store)).toMatchObject({ status: 'confirmation_required' });
    expect(store.compareAndSave).not.toHaveBeenCalled();
    expect(await commitMealSelection({ ...command, proposalId: preview.proposalId, confirmedProposalId: preview.proposalId }, store)).toMatchObject({ status: 'saved' });
  });
  it('rejects changed DB, changed proposals and validation failures before writing', async () => {
    const { store, command, current } = await setup();
    expect(await commitMealSelection({ ...command, proposalId: 'forged' }, store)).toMatchObject({ status: 'proposal_changed' });
    store.validateItinerary.mockResolvedValue({ status: 'failed' } as never);
    expect(await prepareMealSelection(command, store)).toMatchObject({ status: 'validation_failed' });
    store.loadCurrent.mockResolvedValue({ ...current, dbVersion: 'db2' });
    expect(await prepareMealSelection(command, store)).toMatchObject({ status: 'revision_conflict' });
    expect(store.compareAndSave).not.toHaveBeenCalled();
  });
  it('only one concurrent revision compare-and-save succeeds in a memory repository', async () => {
    const { store, command } = await setup(); let revision = 'r1';
    store.compareAndSave.mockImplementation(async (expected) => {
      if (revision !== expected.revision) return false;
      revision = 'r2'; return true;
    });
    const preview = await prepareMealSelection(command, store);
    const results = await Promise.all([1, 2].map(() => commitMealSelection({ ...command, proposalId: preview.proposalId }, store)));
    expect(results.map((r) => r.status).sort()).toEqual(['revision_conflict', 'saved']);
  });
  it('rejects checkout if the same restaurant is freshly feasible only at a different time', async () => {
    const { store, draft, result } = await setup();
    result.options[0].itinerary.days[0].stops[1].start_time = '13:00';
    expect(await verifyMealDraftForCheckout(draft, store)).toMatchObject({ status: 'draft_changed' });
  });
  it('binds confirmation hashes and atomic saves to the plan identity', async () => {
    const { store, command, current } = await setup();
    const original = await prepareMealSelection(command, store);
    store.loadCurrent.mockResolvedValue({ ...current, planId: 'p2' });
    const other = await prepareMealSelection({ ...command, draft: { ...command.draft, planId: 'p2' } }, store);
    expect(other.proposalId).not.toBe(original.proposalId);
    expect(await commitMealSelection({ ...command, draft: { ...command.draft, planId: 'p2' }, proposalId: original.proposalId }, store)).toMatchObject({ status: 'proposal_changed' });
    expect(store.compareAndSave).not.toHaveBeenCalled();
  });
  it('retains unknown or route failure from fresh final validation without writing', async () => {
    const { store, command, draft } = await setup();
    store.validateItinerary.mockResolvedValue({ status: 'information_unknown', reason: 'hours changed' } as never);
    expect(await prepareMealSelection(command, store)).toMatchObject({ status: 'information_unknown', reason: 'hours changed' });
    store.validateItinerary.mockResolvedValue({ status: 'route_failed', reason: 'provider unavailable' } as never);
    expect(await verifyMealDraftForCheckout(draft, store)).toMatchObject({ status: 'route_failed', reason: 'provider unavailable' });
    expect(store.compareAndSave).not.toHaveBeenCalled();
  });
  it('pre-checkout contract validates the exact baseline revision without charging or regenerating', async () => {
    const { store, draft } = await setup();
    expect(await verifyMealDraftForCheckout(draft, store)).toMatchObject({ status: 'verified_draft', planId: 'p1', revision: 'r1', dbVersion: 'db1' });
    expect(store.compareAndSave).not.toHaveBeenCalled();
    store.rebuild.mockResolvedValue({ status: 'information_unknown', options: [] } as never);
    expect(await verifyMealDraftForCheckout(draft, store)).toMatchObject({ status: 'draft_changed' });
  });
});
