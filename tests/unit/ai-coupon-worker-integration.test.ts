import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

// Actual dispatch/worker/savePlan/persister/coupon transactions; no Inngest
// transport, providers, meal selection, or real Firestore/auth evidence here.
const h = vi.hoisted(() => {
  const state = { db: null as ReturnType<typeof createFakeFirestore> | null };
  const db = { collection: (...a: Parameters<ReturnType<typeof createFakeFirestore>['collection']>) => state.db!.collection(...a), runTransaction: (...a: Parameters<ReturnType<typeof createFakeFirestore>['runTransaction']>) => state.db!.runTransaction(...a) };
  return { state, db, save: vi.fn(), route: vi.fn(async () => {}), food: vi.fn(async () => []), notify: vi.fn(async () => {}) };
});
vi.mock('../../api/_inngest/client.js', () => ({
  inngest: { createFunction: (options: { onFailure: unknown }, fn: unknown) => ({ fn, onFailureFn: options.onFailure }) },
  isInngestConfigured: () => false, INNGEST_EVENTS: { PLAN_AI_COMPLETE: 'plan/ai.complete' },
}));
vi.mock('../../api/_ai_core/firestoreAdmin.js', () => ({ initAdminDb: () => h.db }));
vi.mock('../../api/_ai_core/postResponsePipeline.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/_ai_core/postResponsePipeline.js')>();
  return { ...actual, runRouteEnrichment: h.route, applyRecommendedRestaurants: h.food,
    savePlan: async (...args: Parameters<typeof actual.savePlan>) => { h.save(...args); return actual.savePlan(...args); } };
});
vi.mock('../../api/_ai_core/backgroundPipelines.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/_ai_core/backgroundPipelines.js')>(), triggerPass3BackgroundIfPending: () => {},
}));
vi.mock('../../api/_ai_core/emailNotifier.js', () => ({ sendNotificationEmail: h.notify, recordLeadToSheets: h.notify }));
vi.mock('../../api/_plan-ready-push.js', () => ({ sendPlanCreatedTelegram: h.notify, sendPlanReadyPush: h.notify }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: h.notify }));

import { buildPlanAiCompletePayload } from '../../api/_ai_core/inngestDispatch.js';
import { processPlanAfterAI } from '../../api/_inngest/functions/processPlanAfterAI.js';
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

const uid = 'worker-coupon-owner', code = 'SYNTHETIC-WORKER', couponPath = `users/${uid}/coupons/worker`;
const owner = { planOwnerUid: uid, verifiedHistoryUid: uid, forceGuestToken: false };
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const sourceFiles = ['api/_shared/ai-coupon-persistence.js', 'api/_ai_core/paymentGate.js',
  'api/_ai_core/handlerCore.js', 'api/_ai_core/planCloseout.js', 'api/_ai_core/planPersister.js',
  'api/_shared/plan-persistence-guard.js', 'api/_ai_core/backgroundPipelines.js',
  'api/_ai_core/inngestDispatch.js', 'api/_inngest/functions/processPlanAfterAI.js'];
const hashes = () => Object.fromEntries(sourceFiles.map(path => [path,
  createHash('sha256').update(readFileSync(path)).digest('hex')]));
let beforeHashes: Record<string, string>;
const bodyFor = () => ({ uid, aiCouponCode: code, startDate: '2099-01-10', language: 'en',
  pax: 2, durationDays: 1, styles: ['culture'], regions: ['busan'], vehicle: 'sedan' });
const itinerary = () => ({ tour_title: 'Synthetic worker day', regions: ['busan'], days: [{
  day: 1, city: 'busan', theme: 'Culture', stops: [
    { name: 'Museum', category: 'attraction', start_time: '10:00', stay_min: 60, address: 'Busan' },
    { name: 'Lunch', category: 'food', start_time: '12:00', stay_min: 60, address: 'Busan' },
    { name: 'Park', category: 'attraction', start_time: '14:00', stay_min: 60, address: 'Busan' },
    { name: 'Dinner', category: 'food', start_time: '18:00', stay_min: 60, address: 'Busan' },
  ],
}] });

beforeEach(() => {
  beforeHashes = hashes();
  h.state.db = createFakeFirestore({ [couponPath]: { code, productScope: 'ai-plan', type: 'free', isUsed: false, maxDays: 3 } });
  vi.clearAllMocks(); h.route.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('Network forbidden'); }));
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw Error('Socket forbidden'); });
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fetch).not.toHaveBeenCalled(); expect(net.Socket.prototype.connect).not.toHaveBeenCalled();
  expect(hashes()).toEqual(beforeHashes);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function payload(body: ReturnType<typeof bodyFor> & { revisionOf?: string } = bodyFor()) {
  const gate = await enforcePaymentAndRevision(body, h.db, 'synthetic@example.invalid', uid, owner);
  const consumed = gate.consumedCoupon;
  const id = consumed?.binding.planId || 'verified-revision-worker-plan';
  const data = buildPlanAiCompletePayload({
    body, itinerary: itinerary(), streamingPlanId: id, consumedCoupon: consumed,
    couponBindingRequired: !gate.isRevision, uid, verifiedHistoryUid: uid, forceGuestToken: false,
    area: 'busan', regions: ['busan'], language: 'en', guestName: 'Synthetic', pax: 2,
    styles: ['culture'], duration: '1 day', durationDays: 1, startDate: body.startDate,
    vehicle: 'sedan', dietPrefs: [], plannerMode: 'legacy', email: '',
    skeletonCtx: { uid, email: '', area: 'busan', startDate: body.startDate, guestName: 'Synthetic',
      pax: 2, language: 'en', vehicle: 'sedan', priceKRW: 0, priceUSD: 0, body },
  });
  return JSON.parse(JSON.stringify(data)); // Real event/step transport shape, not shared binding references.
}
async function run(data: ReturnType<typeof buildPlanAiCompletePayload>, afterStep: (name: string) => void = () => {}) {
  return processPlanAfterAI.fn({ event: { data: JSON.parse(JSON.stringify(data)) }, logger,
    step: { run: async (name: string, fn: () => Promise<unknown>) => { const value = await fn(); afterStep(name); return value; } } });
}
const failWorker = (data: ReturnType<typeof buildPlanAiCompletePayload>) => processPlanAfterAI.onFailureFn({
  event: { data: { event: { data } } }, error: Object.assign(new Error('Synthetic deterministic route failure'), { code: 'ROUTE_DAY_INFEASIBLE' }),
});
function couponUnchanged(before: ReturnType<ReturnType<typeof createFakeFirestore>['__get']>) { expect(h.state.db.__get(couponPath)).toEqual(before); }
const withoutWorkerTelemetry = (root: ReturnType<ReturnType<typeof createFakeFirestore>['__get']>) => {
  const copy = { ...root }; for (const key of ['_inngest_status', '_inngest_completed_at', '_inngest_elapsed_ms']) delete copy[key]; return copy;
};

describe('coupon dispatch to actual worker persistence (versioned fake DB, network denied)', () => {
  it('preserves consumed binding through JSON event, Step0 and actual savePlan final with no extra consumption', async () => {
    const data = await payload(), before = h.state.db.__get(couponPath), binding = before.aiPlanBinding;
    expect(data.ctx.consumedCoupon.binding).toEqual(binding);
    const steps: string[] = [];
    const result = await run(data, name => {
      steps.push(name);
      if (name === 'skeleton-write') expect(h.state.db.__get(`plans/${data.planId}`)).toMatchObject({
        status: 'streaming', uid, aiCouponBinding: binding, verifiedHistoryUid: uid, itinerary: { days: [] },
      });
    });
    expect(steps).toContain('persistPlan'); expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toMatchObject({ couponBinding: binding, couponBindingRequired: true });
    expect(result.planId).toBe(binding.planId);
    expect(h.state.db.__get(`plans/${data.planId}`)).toMatchObject({ status: 'ready', aiCouponBinding: binding, isFreeCoupon: true });
    expect(h.state.db.__get(`users/${uid}/plans/${data.planId}`)).toBeDefined(); couponUnchanged(before);
  });

  it('worker terminal failure before final restores exact consumption, and the old event cannot later finalize', async () => {
    const data = await payload(), binding = data.ctx.consumedCoupon.binding;
    h.route.mockRejectedValueOnce(Object.assign(new Error('blocked route'), { code: 'ROUTE_DAY_INFEASIBLE' }));
    await expect(run(data)).rejects.toThrow(); expect(h.save).not.toHaveBeenCalled();
    await failWorker(data);
    expect(h.state.db.__get(couponPath)).toMatchObject({ isUsed: false, consumptionId: null, aiPlanBinding: binding, aiPlanBindingState: 'restored' });
    await expect(run(data)).rejects.toThrow('AI_COUPON_CONFLICT');
    expect(h.state.db.__get(`plans/${data.planId}`).status).not.toBe('ready');
  });

  it('root success/list failure and onFailure preserve consumption; same event repairs list without overwriting edited ready root', async () => {
    const data = await payload(), before = h.state.db.__get(couponPath), db = h.state.db;
    const original = db.runTransaction.bind(db);
    db.runTransaction = (fn: Parameters<typeof original>[0]) => original(async tx => {
      let listing = false;
      const value = await fn({ ...tx, set(...args: Parameters<typeof tx.set>) {
        if (args[0].path.startsWith(`users/${uid}/plans/`)) listing = true;
        tx.set(...args);
      } });
      if (listing) throw Error('Synthetic list commit failure'); return value;
    });
    await expect(run(data)).rejects.toThrow('Synthetic list commit failure');
    expect(db.__get(`plans/${data.planId}`).status).toBe('ready');
    await failWorker(data); couponUnchanged(before);
    db.runTransaction = original;
    const root = db.__get(`plans/${data.planId}`);
    root.edited = true; root.editRevision = 1; root.lastEditedAt = '2099-01-11T00:00:00.000Z';
    root.itinerary.days[0].stops[0].name = 'Owner saved edit'; root.itinerary.tour_title = 'Owner saved title';
    db.__set(`plans/${data.planId}`, root);
    const result = await run(data, name => {
      if (name === 'skeleton-write') expect(db.__get(`plans/${data.planId}`)).toEqual(root);
    });
    expect(result.planId).toBe(data.planId);
    expect(withoutWorkerTelemetry(db.__get(`plans/${data.planId}`))).toEqual(withoutWorkerTelemetry(root));
    expect(db.__get(`users/${uid}/plans/${data.planId}`)).toEqual({
      planId: root.planId, status: root.status, createdAt: root.createdAt, tourTitle: 'Owner saved title',
      startDate: root.input.startDate, area: root.input.area, pax: root.input.pax,
    }); // Listing is intentionally only the canonical whitelist, not copied itinerary/token.
    couponUnchanged(before); expect(Object.keys(db.__dump()).filter(path => path.startsWith('plans/'))).toEqual([`plans/${data.planId}`]);
  });

  it('transports only the server verified revision exemption and preserves coupon/credit policy', async () => {
    const db = h.state.db, before = db.__get(couponPath);
    db.__set('plans/original-revision', { planId: 'original-revision', uid, status: 'ready', revisionCredits: 2, revisionCount: 0, input: {}, itinerary: itinerary() });
    const data = await payload({ ...bodyFor(), revisionOf: 'original-revision' });
    expect(data.ctx.couponBindingRequired).toBe(false); expect(data.ctx.consumedCoupon).toBeUndefined();
    await run(data);
    expect(h.save.mock.calls[0][1]).toMatchObject({ couponBinding: null, couponBindingRequired: false });
    expect(db.__get('plans/original-revision')).toMatchObject({ revisionCredits: 1, revisionCount: 1 });
    expect(db.__get(`plans/${data.planId}`)).toMatchObject({ status: 'ready', uid, isFreeCoupon: true, paymentSource: 'ai-coupon' });
    expect(db.__get(`plans/${data.planId}`).aiCouponBinding).toBeUndefined(); couponUnchanged(before);
  });
});
