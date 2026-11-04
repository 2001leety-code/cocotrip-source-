/**
 * 첫날 도착 PR2 r3 11번 — Inngest worker: 결정론 422(허용 사유 코드)는 NonRetriableError 로 바로 실패, onFailure 가
 *   사유 코드·상세를 저장하고 무료 AI 쿠폰을 되살린다. 코드 없는 일반 실패는 종전대로(재시도·쿠폰 유지).
 *   step 오류는 설치된 SDK 의 실제 serializeError → JSON → StepError 로 왕복시킨 뒤 onFailure 에 넘긴다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { mockAdminDb, sets, pipelineMocks, restoreAiPlanCoupon } = vi.hoisted(() => {
  const sets: Array<{ id: string; data: Record<string, unknown> }> = [];
  const mockAdminDb = { collection: () => ({ doc: (id: string) => ({ set: async (data: Record<string, unknown>) => { sets.push({ id, data }); return {}; } }) }) };
  const pipelineMocks = {
    runRouteEnrichment: vi.fn(async () => {}),
    applyBackfillsAndTmoney: vi.fn((itin: unknown) => itin),
    applyRecommendedRestaurants: vi.fn(async () => []),
    computePricing: vi.fn(() => ({ priceKRW: 100000, priceUSD: 75 })),
    savePlan: vi.fn(async () => ({ planId: 'plan-abc', planUrl: '/my-plans/plan-abc' })),
    arrivalRestDayFromCtx: vi.fn(() => false),
  };
  return { mockAdminDb, sets, pipelineMocks, restoreAiPlanCoupon: vi.fn(async () => {}) };
});

vi.mock('../../api/_ai_core/firestoreAdmin.js', () => ({ initAdminDb: () => mockAdminDb }));
vi.mock('../../api/_ai_core/postResponsePipeline.js', () => pipelineMocks);
vi.mock('../../api/_ai_core/paymentGate.js', () => ({ restoreAiPlanCoupon }));
vi.mock('../../api/_ai_core/backgroundPipelines.js', () => ({ triggerPass3BackgroundIfPending: vi.fn() }));
vi.mock('../../api/_ai_core/planPersister.js', () => ({ savePlanSkeleton: vi.fn() }));
vi.mock('../../api/_shared/plan-issuance.js', () => ({ releasePlanIssuance: vi.fn(async () => ({ released: false })) }));
vi.mock('../../api/_ai_core/emailNotifier.js', () => ({ sendNotificationEmail: vi.fn(async () => {}), recordLeadToSheets: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_plan-ready-push.js', () => ({ sendPlanCreatedTelegram: vi.fn(), sendPlanReadyPush: vi.fn(async () => {}) }));

import { processPlanAfterAI, failFastOnPlanCode } from '../../api/_inngest/functions/processPlanAfterAI.js';
import { routeDayInfeasibleError } from '../../api/_ai_core/agents/RouteAgent.js';
import { buildFinalGateError, FINAL_GATE_MEAL_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { buildPlanAiCompletePayload } from '../../api/_ai_core/inngestDispatch.js';
// @ts-expect-error — 설치된 Inngest SDK 내부 모듈(실제 직렬화 왕복)
import { serializeError } from '../../node_modules/inngest/helpers/errors.js';
// @ts-expect-error — 설치된 Inngest SDK 내부 모듈
import { StepError } from '../../node_modules/inngest/components/StepError.js';

type Fn = { fn: (a: unknown) => Promise<unknown>; onFailureFn: (a: unknown) => Promise<unknown> };
const worker = processPlanAfterAI as unknown as Fn;
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const ctx = { body: {}, area: 'seoul', dietPrefs: [], regions: ['seoul'], language: 'en', plannerMode: 'legacy', consumedCoupon: { uid: 'u1', code: 'AI-FREE-1', consumptionId: 'cons-A' } };
const eventData = { planId: 'plan-abc', itinerary: { days: [] }, ctx };

/** Inngest 처럼: step 콜백이 던진 오류를 실제 SDK 로 직렬화 → StepError(함수·onFailure 가 받는 모양). */
async function runUntilStepFails() {
  let thrown: unknown;
  const step = { run: async (id: string, cb: () => unknown) => { try { return await cb(); } catch (e) { thrown = e; throw new StepError(id, JSON.parse(JSON.stringify(serializeError(e)))); } } };
  const fnErr = await worker.fn({ event: { data: eventData }, step, logger }).then(() => null, (e: unknown) => e);
  return { thrown: thrown as Error & { cause?: Record<string, unknown> }, fnErr };
}

beforeEach(() => { sets.length = 0; vi.clearAllMocks(); });

describe('r3-11 — deterministic 422 in the worker: no retry, reason code stored, free coupon restored', () => {
  it.each([
    ['routeEnrich', 'ROUTE_DAY_INFEASIBLE', () => { pipelineMocks.runRouteEnrichment.mockRejectedValueOnce(routeDayInfeasibleError(['Day 2: Palace would start or end after midnight'])); }],
    ['recommendedRestaurants', FINAL_GATE_MEAL_CODE, () => { pipelineMocks.applyRecommendedRestaurants.mockRejectedValueOnce(buildFinalGateError({ code: FINAL_GATE_MEAL_CODE, violations: [], zeroFoodDays: [], requiredMealIssues: ['Day 1: dinner missing'] }, [], 'post_response')); }],
  ])('%s throws %s → NonRetriableError (real SDK round trip) → onFailure stores code + details and restores the coupon', async (_step, code, arrange) => {
    arrange();
    const { thrown, fnErr } = await runUntilStepFails();
    expect(thrown.name).toBe('NonRetriableError'); // engine: error?.name === "NonRetriableError" → retriable false
    expect(fnErr).toBeInstanceOf(StepError);
    expect(pipelineMocks.savePlan).not.toHaveBeenCalled();
    await worker.onFailureFn({ event: { data: { event: { data: eventData } } }, error: fnErr });
    const mark = sets.find((s) => s.id === 'plan-abc')!.data;
    expect(mark).toMatchObject({ status: 'error', _streaming_error_code: code });
    expect(Array.isArray(mark._streaming_error_details)).toBe(true);
    expect(restoreAiPlanCoupon).toHaveBeenCalledTimes(1);
    expect(restoreAiPlanCoupon).toHaveBeenCalledWith(mockAdminDb, 'u1', 'AI-FREE-1', 'cons-A'); // r4: 소비 ID 전달
  });
  it('a generic failure (no allow-listed code) is NOT wrapped (keeps retries) and does NOT restore the coupon', async () => {
    pipelineMocks.runRouteEnrichment.mockRejectedValueOnce(new Error('ODsay 500'));
    const { thrown, fnErr } = await runUntilStepFails();
    expect(thrown.name).toBe('Error');
    await worker.onFailureFn({ event: { data: { event: { data: eventData } } }, error: fnErr });
    expect('_streaming_error_code' in sets.find((s) => s.id === 'plan-abc')!.data).toBe(false);
    expect(restoreAiPlanCoupon).not.toHaveBeenCalled();
  });
  it('no coupon in ctx → nothing restored', async () => {
    const err = new StepError('routeEnrich', JSON.parse(JSON.stringify(serializeError(await failFastOnPlanCode(async () => { throw routeDayInfeasibleError(['Day 1: x']); }).catch((e: unknown) => e)))));
    await worker.onFailureFn({ event: { data: { event: { data: { ...eventData, ctx: { ...ctx, consumedCoupon: undefined } } } } }, error: err });
    expect(restoreAiPlanCoupon).not.toHaveBeenCalled();
  });
  it('dispatch payload carries consumedCoupon {uid, code} only when both are present; handlerCore passes it', () => {
    const base = { itinerary: { days: [] }, body: {}, abReason: null, abBucket: null };
    expect((buildPlanAiCompletePayload({ ...base, consumedCoupon: { uid: 'u1', code: 'C', consumptionId: 'cons-1', extra: 'x' } }) as { ctx: Record<string, unknown> }).ctx.consumedCoupon).toEqual({ uid: 'u1', code: 'C', consumptionId: 'cons-1' });
    expect('consumedCoupon' in (buildPlanAiCompletePayload({ ...base, consumedCoupon: null }) as { ctx: Record<string, unknown> }).ctx).toBe(false);
    expect(readFileSync(resolve(process.cwd(), 'api/_ai_core/handlerCore.js'), 'utf8')).toContain('consumedCoupon: consumedCouponInfo })) { issuance.handOff(); return; }');
  });
});


describe('Preview worker suppression before all business effects', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does not execute route steps or persist a directly invoked Preview job', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
    const step = { run: vi.fn(() => { throw new Error('Business work forbidden'); }) };
    expect(await worker.fn({ event: { data: eventData }, step, logger })).toMatchObject({ status: 'suppressed', ok: false });
    expect(step.run).not.toHaveBeenCalled(); expect(sets).toHaveLength(0);
    expect(pipelineMocks.savePlan).not.toHaveBeenCalled();
  });
  it('does not mutate plans/coupons or notify from a Preview failure callback', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true');
    expect(await worker.onFailureFn({ event: { data: { event: { data: eventData } } }, error: new Error('fixture') })).toMatchObject({ status: 'suppressed', ok: false });
    expect(sets).toHaveLength(0); expect(restoreAiPlanCoupon).not.toHaveBeenCalled();
  });
});
