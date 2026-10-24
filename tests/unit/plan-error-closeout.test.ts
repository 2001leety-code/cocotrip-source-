/**
 * 저장 직전 게이트 실패 시 streaming plan 문서 즉시 error 마감 (2026-10-23, spec r3).
 *
 * 잠근 사고: handlerCore catch 는 422 응답·쿠폰 복구·발급권 해제·알림을 했지만 streaming
 *   skeleton 문서는 'streaming' 으로 남아 plan-streaming-sweep(30분)까지 손님 화면이 "생성 중".
 *
 * 함께 잠그는 것:
 *   - 순서: 응답 → 쿠폰 복구 → 마감 → 발급권 해제 → 알림 (해제가 issuance.claim 을 비우므로 마감이 먼저).
 *   - worker 로 인계된 뒤(dispatch 성공) 응답만 실패하면 쿠폰·마감·해제를 하지 않는다 — worker 가
 *     플랜을 계속 만드는데 쿠폰이 복구되면 재사용 구멍이 된다.
 *   - 같은 planId 를 다른 attempt 가 재선점했으면 마감하지 않는다(claim_mismatch).
 *
 * Firestore 는 tests/helpers/fake-firestore.js (낙관적 재시도 재현) — 실 Firestore·결제 호출 없음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

const h = vi.hoisted(() => ({
  order: [] as string[],
  restore: vi.fn(),
  alert: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('../../api/_ai_core/paymentGate.js', () => ({ restoreAiPlanCoupon: h.restore }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: h.alert }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: h.capture }));

const { closeStreamingPlanOnFailure, runHandlerFailureCleanup } = await import('../../api/_ai_core/planCloseout.js');
const { createIssuanceContext, PLAN_ISSUANCE_STATUS } = await import('../../api/_shared/plan-issuance.js');
const { tryBlockModeInngestPath } = await import('../../api/_ai_core/backgroundPipelines.js');

type FakeDb = ReturnType<typeof createFakeFirestore>;
type Res = {
  headersSent: boolean;
  statusCode?: number;
  body?: string;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};

const PLAN_ID = 'plan-1';
const PLAN_PATH = `plans/${PLAN_ID}`;
const ORDER_PATH = 'plan_issued_orders/ORDER-1';
const CLAIM = { orderId: 'ORDER-1', attemptId: 'att-1', planId: PLAN_ID };
const COUPON = { uid: 'u1', code: 'FREE-AI' };
const STREAMING_DOC = { planId: PLAN_ID, status: 'streaming', _streaming_in_progress: true, _streaming_started_at: 1, uid: 'u1' };
const ISSUING_DOC = { status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: 'att-1', planId: PLAN_ID };

/** finalItineraryGate.buildDuplicateGateError 와 같은 모양 — 저장 직전 게이트가 던지는 422. */
function gateError() {
  const e = new Error('Duplicate stops found in your itinerary (임진각×2). To keep quality, we did not save this plan.') as Error & { code: string; statusCode: number };
  e.code = 'DUPLICATE_STOP_VIOLATION';
  e.statusCode = 422;
  return e;
}

function makeRes(): Res {
  const res: Res = {
    headersSent: false,
    writeHead(status) { res.statusCode = status; res.headersSent = true; },
    end(body) { res.body = body; h.order.push('response'); },
  };
  return res;
}

/** catch 안의 Promise.resolve().then(알림) 이 돌 때까지. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function cleanup(db: FakeDb, over: Record<string, unknown>) {
  return runHandlerFailureCleanup({
    req: { method: 'POST' }, res: makeRes(), adminDb: db, error: gateError(), issuance: createIssuanceContext(),
    consumedCouponInfo: null, planPersisted: false, streamingPlanId: null, stage: 'finalGate', plannerMode: 'legacy',
    ...over,
  });
}

beforeEach(() => {
  h.order.length = 0;
  h.restore.mockReset().mockImplementation(async () => { h.order.push('coupon'); });
  h.alert.mockReset().mockImplementation(async () => { h.order.push('alert'); });
  h.capture.mockReset().mockResolvedValue(undefined);
});

describe('runHandlerFailureCleanup — 게이트 실패 시 마감', () => {
  it('게이트 422 + streaming 문서 → error 마감, 응답 422 그대로, 순서 = 응답 → 쿠폰 → 마감 → 해제 → 알림', async () => {
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC, [ORDER_PATH]: ISSUING_DOC });
    const issuance = createIssuanceContext();
    issuance.claim = { ...CLAIM };
    // 순서 증거: 쿠폰 복구 시점엔 아직 streaming, 해제 시점엔 이미 error 여야 한다.
    h.restore.mockImplementation(async () => { h.order.push(`coupon(plan=${db.__get(PLAN_PATH).status})`); });
    const realRelease = issuance.releaseIfUnused.bind(issuance);
    issuance.releaseIfUnused = async (...args: Parameters<typeof realRelease>) => {
      h.order.push(`release(plan=${db.__get(PLAN_PATH).status})`);
      return realRelease(...args);
    };
    const res = makeRes();
    const error = gateError();

    // 순서 검증용으로 무료쿠폰과 유료 claim 을 함께 둔다(각 정리 단계가 다 돈다).
    await runHandlerFailureCleanup({
      req: { method: 'POST' }, res, adminDb: db, error, issuance, consumedCouponInfo: COUPON,
      planPersisted: false, streamingPlanId: PLAN_ID, stage: 'finalGate', plannerMode: 'block_mode',
    });
    await flush();

    expect(h.order).toEqual(['response', 'coupon(plan=streaming)', 'release(plan=error)', 'alert']);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body as string)).toEqual({
      ok: false,
      error: 'Planner failed',
      code: 'DUPLICATE_STOP_VIOLATION',
      details: error.message,
      stackHead: (error.stack || '').slice(0, 500),
    });
    expect(h.restore).toHaveBeenCalledWith(db, 'u1', 'FREE-AI');
    expect(db.__get(PLAN_PATH)).toMatchObject({
      status: 'error',
      _streaming_in_progress: false,
      _streaming_error: 'handler_catch',
      _streaming_error_code: 'DUPLICATE_STOP_VIOLATION',
      _streaming_error_message: error.message.slice(0, 300),
      _streaming_failed_stage: 'finalGate',
    });
    expect(typeof db.__get(PLAN_PATH)._streaming_failed_at).toBe('number'); // serverTimestamp 가 실제로 적용됨
    expect(db.__get(ORDER_PATH)).toBeUndefined(); // 발급권 해제 → 같은 결제로 재시도 가능
    expect(issuance.claim).toBe(null);
  });

  // 2026-10-24 (식이 준수 r1): 종단 게이트가 만든 날짜·끼니·사유(e.details)가 응답과 실패 문서에 그대로 남는다.
  it('종단 끼니 실패 → HTTP 응답 failureDetails + streaming 문서 _streaming_error_details (details=message 는 그대로)', async () => {
    const { buildFinalGateError, FINAL_GATE_MEAL_CODE } = await import('../../api/_ai_core/finalItineraryGate.js');
    const issue = 'Day 2 (출국일): departure_time=10:00 이른 출국 — 조식(06-10시) 누락 (B-MEAL, P137)';
    const error = buildFinalGateError({ code: FINAL_GATE_MEAL_CODE, zeroFoodDays: [], requiredMealIssues: [issue], violations: [] }, ['Vegan'], 'post_response');
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC });
    const res = makeRes();
    await cleanup(db, { res, error, streamingPlanId: PLAN_ID });
    await flush();
    const body = JSON.parse(res.body as string);
    expect(res.statusCode).toBe(422);
    expect(body).toMatchObject({ code: FINAL_GATE_MEAL_CODE, details: error.message, failureDetails: [issue] });
    expect(db.__get(PLAN_PATH)).toMatchObject({ status: 'error', _streaming_error_code: FINAL_GATE_MEAL_CODE, _streaming_error_details: [issue] });
  });

  it('streamingPlanId 없음 → Firestore 호출 0 (응답·알림은 그대로)', async () => {
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC });
    const res = makeRes();
    await cleanup(db, { res });
    await flush();
    expect(db.__stats).toMatchObject({ transactions: 0, reads: 0, writes: 0 });
    expect(res.statusCode).toBe(422);
    expect(h.order).toEqual(['response', 'alert']);
  });

  it('마감 helper 안에서 Firestore 가 던져도 응답·해제·알림 영향 0', async () => {
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC, [ORDER_PATH]: ISSUING_DOC });
    const realTx = db.runTransaction;
    let first = true;
    db.runTransaction = async (fn, opts) => {
      if (first) { first = false; throw new Error('14 UNAVAILABLE: firestore down'); } // 첫 트랜잭션 = 마감
      return realTx(fn, opts);
    };
    const issuance = createIssuanceContext();
    issuance.claim = { ...CLAIM };
    const res = makeRes();

    await expect(cleanup(db, { res, issuance, streamingPlanId: PLAN_ID })).resolves.toBeUndefined();
    await flush();

    expect(res.statusCode).toBe(422);
    expect(db.__get(PLAN_PATH).status).toBe('streaming'); // 못 닫음 → sweep 이 정리
    expect(db.__get(ORDER_PATH)).toBeUndefined();         // 해제는 그대로 됨
    expect(h.order).toEqual(['response', 'alert']);
  });
});

describe('runHandlerFailureCleanup — worker 인계 경계 (블록 모드)', () => {
  let savedFlag: string | undefined;
  beforeEach(() => {
    savedFlag = process.env.PLANNER_SKELETON_IN_WORKER;
    process.env.PLANNER_SKELETON_IN_WORKER = 'true'; // stub 문서를 fake Firestore 에 바로 쓴다
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.PLANNER_SKELETON_IN_WORKER;
    else process.env.PLANNER_SKELETON_IN_WORKER = savedFlag;
  });

  const blockArgs = (db: FakeDb) => ({
    adminDb: db, isInngestEnabled: true, blockModeUsed: true, itinerary: { days: [] },
    uid: 'u1', email: 'g@example.com', area: 'seoul', startDate: '2026-11-20', guestName: 'G', pax: 2,
    language: 'en', vehicle: 'staria_8', durationDays: 2, body: { aiCouponCode: 'FREE-AI' }, handlerStart: Date.now(),
  });

  it('무료쿠폰 + dispatch 성공 + 응답 예외 → 인계는 응답 전에 기록, 쿠폰 복구 0 · worker 문서 그대로 · 해제 안 함', async () => {
    const db = createFakeFirestore();
    const issuance = createIssuanceContext();
    const steps: string[] = [];

    const err = await tryBlockModeInngestPath({
      ...blockArgs(db),
      reservedPlanId: issuance.reservedPlanId(),
      dispatchFn: async () => true,
      onDispatched: () => { steps.push('handoff'); issuance.handOff(); },
      buildDebug: () => { steps.push('debug'); return null; },
      sendEarlyResponse: () => { throw new Error('socket hang up'); },
    }).catch((e: Error) => e);

    expect((err as Error).message).toBe('socket hang up');
    expect(steps).toEqual(['handoff', 'debug']);
    expect(issuance.handedToWorker).toBe(true);

    const [stubPath] = Object.keys(db.__dump());
    const workerDoc = db.__get(stubPath);
    expect(workerDoc).toMatchObject({ status: 'streaming', _streaming_in_progress: true });
    const txBefore = db.__stats.transactions;
    const releaseSpy = vi.spyOn(issuance, 'releaseIfUnused');

    // handlerCore 는 이 경로에서 streamingPlanId 를 못 받지만, 받았더라도 닫으면 안 된다.
    await cleanup(db, { error: err, issuance, consumedCouponInfo: COUPON, streamingPlanId: stubPath.split('/')[1], stage: 'init' });
    await flush();

    expect(h.restore).not.toHaveBeenCalled();
    expect(db.__get(stubPath)).toEqual(workerDoc);
    expect(db.__stats.transactions).toBe(txBefore);
    expect(await releaseSpy.mock.results[0].value).toBe(false);
  });

  it('dispatch 실패 → 인계 안 함 → 직접 처리 중 게이트 실패 시 쿠폰 복구·마감·해제 모두 실행', async () => {
    const db = createFakeFirestore({ [ORDER_PATH]: ISSUING_DOC });
    const issuance = createIssuanceContext();
    issuance.claim = { ...CLAIM };
    const onDispatched = vi.fn(() => issuance.handOff());

    // dispatch 예외는 tryDispatchOrFallback 이 false 로 바꾼다 → 같은 skeleton 으로 직접 처리.
    const blkInn = await tryBlockModeInngestPath({
      ...blockArgs(db),
      reservedPlanId: issuance.reservedPlanId(),
      dispatchFn: async () => false,
      onDispatched,
      buildDebug: () => null,
      sendEarlyResponse: () => {},
    });
    expect(blkInn).toMatchObject({ dispatched: false, streamingPlanId: PLAN_ID });
    expect(onDispatched).not.toHaveBeenCalled();
    expect(issuance.handedToWorker).toBe(false);

    await cleanup(db, { issuance, consumedCouponInfo: COUPON, streamingPlanId: blkInn!.streamingPlanId });
    await flush();

    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(db.__get(PLAN_PATH)).toMatchObject({ status: 'error', _streaming_error_code: 'DUPLICATE_STOP_VIOLATION', _streaming_failed_stage: 'finalGate' });
    expect(db.__get(ORDER_PATH)).toBeUndefined();
  });
});

describe('closeStreamingPlanOnFailure — 쓰기 조건', () => {
  const call = (db: FakeDb, issuanceClaim: typeof CLAIM | null = null) =>
    closeStreamingPlanOnFailure({ adminDb: db, planId: PLAN_ID, error: gateError(), stage: 'finalGate', issuanceClaim });

  it.each([
    ['ready (저장 성공)', { ...STREAMING_DOC, status: 'ready', _streaming_in_progress: false }],
    ['이미 error (sweep 이 먼저 닫음)', { ...STREAMING_DOC, status: 'error', _streaming_in_progress: false, _streaming_error: 'streaming_timeout_sweep_p292' }],
    ['status streaming 인데 진행 플래그 없음', { ...STREAMING_DOC, _streaming_in_progress: false }],
  ])('%s → 쓰기 0, not_streaming', async (_label, doc) => {
    const db = createFakeFirestore({ [PLAN_PATH]: doc });
    await expect(call(db)).resolves.toEqual({ closed: false, reason: 'not_streaming' });
    expect(db.__get(PLAN_PATH)).toEqual(doc);
    expect(db.__stats.writes).toBe(0);
  });

  it('문서 없음 → 쓰기 0, missing (문서를 새로 만들지 않는다)', async () => {
    const db = createFakeFirestore();
    await expect(call(db)).resolves.toEqual({ closed: false, reason: 'missing' });
    expect(db.__dump()).toEqual({});
  });

  it('다른 attempt 가 같은 planId 를 재선점 → 쓰기 0, claim_mismatch', async () => {
    // takeover 는 planId 를 유지하고 attemptId 만 바꾼다 — 새 attempt 가 이 문서를 만들고 있다.
    const db = createFakeFirestore({
      [PLAN_PATH]: STREAMING_DOC,
      [ORDER_PATH]: { ...ISSUING_DOC, attemptId: 'att-2', takenOverAt: '2026-10-23T00:00:00.000Z' },
    });
    await expect(call(db, CLAIM)).resolves.toEqual({ closed: false, reason: 'claim_mismatch' });
    expect(db.__get(PLAN_PATH)).toEqual(STREAMING_DOC);
    expect(db.__stats.writes).toBe(0);
  });

  it('claim 일치 → 마감', async () => {
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC, [ORDER_PATH]: ISSUING_DOC });
    await expect(call(db, CLAIM)).resolves.toEqual({ closed: true });
    expect(db.__get(PLAN_PATH).status).toBe('error');
  });

  it('트랜잭션 도중 ready 전환 → 재시도에서 ready 를 보고 쓰기 0', async () => {
    const db = createFakeFirestore({ [PLAN_PATH]: STREAMING_DOC });
    db.__beforeCommit = ({ attempt }: { attempt: number }) => {
      if (attempt === 1) db.__patch(PLAN_PATH, { status: 'ready', _streaming_in_progress: false }); // 저장이 막 끝남
    };
    await expect(call(db)).resolves.toEqual({ closed: false, reason: 'not_streaming' });
    expect(db.__stats.retries).toBe(1);
    expect(db.__get(PLAN_PATH)).toMatchObject({ status: 'ready', _streaming_in_progress: false });
    expect(db.__get(PLAN_PATH)._streaming_error).toBeUndefined();
  });

  it('adminDb 없음 → throw 하지 않고 reason error', async () => {
    const r = await closeStreamingPlanOnFailure({ adminDb: null, planId: PLAN_ID, error: gateError(), stage: 'finalGate', issuanceClaim: null });
    expect(r).toMatchObject({ closed: false, reason: 'error' });
  });
});

describe('handlerCore 배선 (소스)', () => {
  const src = readFileSync(resolve(process.cwd(), 'api/_ai_core/handlerCore.js'), 'utf8');
  const tryPos = src.search(/^ {2}try \{$/m); // handler 본체 try (withStep 안의 try 는 들여쓰기가 더 깊다)

  it('streamingPlanId 는 handler 상단 let 하나 — catch 가 읽는다(try 안 재선언 금지)', () => {
    const decls = [...src.matchAll(/let\s+streamingPlanId\b/g)];
    expect(decls).toHaveLength(1);
    expect(decls[0].index).toBeLessThan(tryPos);
  });

  it('저장 직전 게이트를 finalGate 단계로 감싼다 (실패 단계가 routeEnrich 로 남지 않게)', () => {
    expect(src).toMatch(/await\s+withStep\(\s*'finalGate',\s*\(\)\s*=>\s*applyRecommendedRestaurants\(/);
  });

  it('catch 는 runHandlerFailureCleanup 에 streamingPlanId·currentStep·issuance 를 넘긴다', () => {
    const catchSrc = src.slice(src.indexOf('} catch (error) {'));
    expect(catchSrc).toMatch(/await\s+runHandlerFailureCleanup\(\{[\s\S]*\bstreamingPlanId\b[\s\S]*stage:\s*currentStep[\s\S]*\}\)/);
    expect(catchSrc).toMatch(/\bissuance\b/);
  });

  it('블록 모드 인계는 onDispatched 로 응답 전에 기록한다', () => {
    expect(src).toMatch(/onDispatched:\s*\(\)\s*=>\s*issuance\.handOff\(\)/);
  });
});
