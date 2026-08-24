/**
 * P231 (2026-05-27): skeleton-in-worker 회귀 차단.
 *
 * 배경:
 *   HTTP 응답 경로에서 Firestore full skeleton 저장 (1-2s) 이 latency 의 핵심.
 *   PLANNER_SKELETON_IN_WORKER=true 시 stub doc (150ms) 만 저장 + full skeleton
 *   파라미터를 Inngest 이벤트 payload 에 포함 → worker Step 0 가 full skeleton 저장.
 *   ENV off (default) = 기존 동작 100% 유지.
 *
 * 핵심 불변식:
 *   1. isSkeletonInWorkerEnabled export 존재 (backgroundPipelines.js)
 *   2. tryInitStreamingSkeleton 에 isSkeletonInWorkerEnabled() 분기 존재
 *   3. tryInitBlockModeForInngest 에 isSkeletonInWorkerEnabled() 분기 존재
 *   4. 'skeleton-write' step.run 존재 (processPlanAfterAI.js)
 *   5. ctx.skeletonCtx 조건 분기 존재 (processPlanAfterAI.js)
 *   6. inngestDispatch.js buildPlanAiCompletePayload 에 skeletonCtx 존재
 *   7. ENV off 시 skeletonCtx undefined → 기존 동작 100% 유지
 *
 * 비유: "접수 창구가 접수증만 발행 (빠름), 뒤에서 담당자가 풀 서류 작성 (worker Step 0)"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');

const BG_PATH = path.join(ROOT, 'api/_ai_core/backgroundPipelines.js');
const WORKER_PATH = path.join(ROOT, 'api/_inngest/functions/processPlanAfterAI.js');
const DISPATCH_PATH = path.join(ROOT, 'api/_ai_core/inngestDispatch.js');
const HANDLER_PATH = path.join(ROOT, 'api/_ai_core/handlerCore.js');

const bgSrc = readFileSync(BG_PATH, 'utf-8');
const workerSrc = readFileSync(WORKER_PATH, 'utf-8');
const dispatchSrc = readFileSync(DISPATCH_PATH, 'utf-8');
const handlerSrc = readFileSync(HANDLER_PATH, 'utf-8');

// ── 2026-08-24 (planner-trust) — real runtime harness for processPlanAfterAI.js.
//   inngest.createFunction({...}, handler) returns an InngestFunction whose raw
//   handler is exposed as `.fn` — calling it directly with a fake {event, step,
//   logger} bypasses all Inngest queueing/retry machinery and lets us assert on
//   the actual Firestore writes without a live Inngest server.
//   vi.hoisted() is required because vi.mock() factories are hoisted above plain
//   const declarations — the mock adminDb must exist before that hoisting point.
const { mockAdminDb, mockCalls, pipelineMocks } = vi.hoisted(() => {
  const mockCalls: Array<{ id: string; data: Record<string, unknown>; opts: Record<string, unknown> | undefined }> = [];
  const mockAdminDb = {
    collection: () => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>, opts?: Record<string, unknown>) => {
          mockCalls.push({ id, data, opts });
          return {};
        },
      }),
    }),
  };
  const pipelineMocks = {
    runRouteEnrichment: vi.fn(async () => {}),
    applyBackfillsAndTmoney: vi.fn((itin: unknown) => itin),
    applyRecommendedRestaurants: vi.fn(async () => []),
    computePricing: vi.fn(() => ({ priceKRW: 100000, priceUSD: 75 })),
    savePlan: vi.fn(async () => ({ planId: 'plan-abc', planUrl: '/my-plans/plan-abc' })),
  };
  return { mockAdminDb, mockCalls, pipelineMocks };
});

vi.mock('../../api/_ai_core/firestoreAdmin.js', () => ({ initAdminDb: () => mockAdminDb }));
vi.mock('../../api/_ai_core/postResponsePipeline.js', () => pipelineMocks);
vi.mock('../../api/_ai_core/backgroundPipelines.js', () => ({
  triggerPass3BackgroundIfPending: vi.fn(),
}));
vi.mock('../../api/_ai_core/planPersister.js', () => ({ savePlanSkeleton: vi.fn() }));
vi.mock('../../api/_shared/plan-issuance.js', () => ({ releasePlanIssuance: vi.fn(async () => ({ released: false })) }));
vi.mock('../../api/_ai_core/vehicleAndPrice.js', () => ({ VEHICLE_LABELS: { staria_8: 'Staria (8)' } }));
vi.mock('../../api/_ai_core/emailNotifier.js', () => ({
  sendNotificationEmail: vi.fn(async () => {}),
  recordLeadToSheets: vi.fn(async () => {}),
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_plan-ready-push.js', () => ({
  sendPlanCreatedTelegram: vi.fn(),
  sendPlanReadyPush: vi.fn(async () => {}),
}));

// ── 정적 소스 검증 ────────────────────────────────────────────────────────────

describe('P231 skeleton-in-worker 정적 소스 검증', () => {

  // backgroundPipelines.js

  it('P231-A1: isSkeletonInWorkerEnabled export 존재', () => {
    expect(bgSrc).toMatch(/export function isSkeletonInWorkerEnabled/);
  });

  it('P231-A2: PLANNER_SKELETON_IN_WORKER ENV 참조 존재 (rollback 안전)', () => {
    expect(bgSrc).toMatch(/PLANNER_SKELETON_IN_WORKER/);
  });

  it('P231-A3: tryInitStreamingSkeleton 에 isSkeletonInWorkerEnabled() 분기 존재', () => {
    // stub 저장 분기가 있어야 함
    expect(bgSrc).toMatch(/isSkeletonInWorkerEnabled\(\)/);
  });

  it('P231-A4: tryInitStreamingSkeleton 반환값에 skeletonCtx 포함 가능', () => {
    // skeletonCtx 를 반환값으로 사용
    expect(bgSrc).toMatch(/skeletonCtx/);
  });

  it('P231-A5: tryInitBlockModeForInngest 에도 isSkeletonInWorkerEnabled() 분기 존재', () => {
    // block-mode 경로에서도 stub 저장 분기
    const blockModeFnIdx = bgSrc.indexOf('export async function tryInitBlockModeForInngest');
    const blockModeFnSrc = bgSrc.slice(blockModeFnIdx, blockModeFnIdx + 2000);
    expect(blockModeFnSrc).toMatch(/isSkeletonInWorkerEnabled\(\)/);
  });

  it('P231-A6: _p231_stub 필드로 stub doc 식별 가능 (디버그)', () => {
    expect(bgSrc).toMatch(/_p231_stub/);
  });

  // processPlanAfterAI.js (Inngest worker)

  it('P231-B1: \'skeleton-write\' step.run 존재 (Step 0)', () => {
    expect(workerSrc).toMatch(/'skeleton-write'/);
  });

  it('P231-B2: ctx.skeletonCtx 조건 분기 존재 (ENV off 시 skip)', () => {
    expect(workerSrc).toMatch(/ctx\.skeletonCtx/);
  });

  it('P231-B3: savePlanSkeleton import 존재', () => {
    expect(workerSrc).toMatch(/savePlanSkeleton/);
  });

  it('P231-B4: skeleton-write 실패 시 non-fatal 처리 존재', () => {
    // skeleton-write 실패해도 routeEnrich + persistPlan 은 계속.
    // step.run('skeleton-write', ...) 본문이 길어 4000 char 로 slice.
    const skWriteIdx = workerSrc.indexOf("'skeleton-write'");
    const skWriteSrc = workerSrc.slice(skWriteIdx, skWriteIdx + 4000);
    expect(skWriteSrc).toMatch(/catch\s*\(/);
    expect(skWriteSrc).toMatch(/non-fatal/);
  });

  it('P231-B5: blockModeItinerary 조건 분기 존재 (block-mode vs legacy streaming)', () => {
    // block-mode 는 itinerary days 미리 채움, legacy streaming 은 빈 days
    expect(workerSrc).toMatch(/blockModeItinerary/);
  });

  // inngestDispatch.js

  it('P231-C1: buildPlanAiCompletePayload 에 skeletonCtx spread 존재', () => {
    expect(dispatchSrc).toMatch(/skeletonCtx/);
  });

  it('P231-C2: skeletonCtx 없으면 payload 에 미포함 (backward compat)', () => {
    // `...(skeletonCtx ? { skeletonCtx } : {})` conditional spread 패턴 확인
    expect(dispatchSrc).toMatch(/skeletonCtx\s*\?/);
    expect(dispatchSrc).toMatch(/skeletonCtx.*:\s*\{\s*\}/);
  });

  it('P231-C3: dispatchOrInlineForHandlerCore 가 skeletonCtx 파라미터 수용', () => {
    // `skeletonCtx: skeletonCtx || undefined` (object property colon syntax) 패턴 확인
    expect(dispatchSrc).toMatch(/skeletonCtx:\s*skeletonCtx\s*\|\|\s*undefined/);
  });

  // handlerCore.js

  it('P231-D1: handlerCore 가 skeletonCtx 변수 선언', () => {
    expect(handlerSrc).toMatch(/let\s+skeletonCtx\s*=/);
  });

  it('P231-D2: handlerCore 가 sk.skeletonCtx 로 skeletonCtx 설정', () => {
    expect(handlerSrc).toMatch(/sk\.skeletonCtx/);
  });

  it('P231-D3: handlerCore 가 dispatchOrInlineForHandlerCore 에 skeletonCtx 전달', () => {
    expect(handlerSrc).toMatch(/dispatchOrInlineForHandlerCore\([^)]*skeletonCtx/s);
  });

  it('P231-D4: block-mode dispatch 경로 (blkInn) 에서 skeletonCtx 전달', () => {
    // tryBlockModeInngestPath 의 실제 호출부 (2번째 이후 출현) 에서 skeletonCtx 전달 확인.
    // 첫 출현은 import 주석이므로 lastIndexOf 사용.
    const blkInnIdx = handlerSrc.lastIndexOf('tryBlockModeInngestPath');
    const blkInnSrc = handlerSrc.slice(blkInnIdx, blkInnIdx + 1500);
    // dispatchFn 에 skeletonCtx: spCtx 전달 패턴
    expect(blkInnSrc).toMatch(/skeletonCtx:\s*spCtx/);
  });

});

// ── 런타임 로직 검증 (정적) ─────────────────────────────────────────────────
// backgroundPipelines.js 가 geminiPipeline.js (Google AI SDK) transitive import 있어
// vitest 환경에서 dynamic import 불가. isSkeletonInWorkerEnabled 로직을 소스에서 검증.

describe('P231 isSkeletonInWorkerEnabled ENV 로직 정적 검증', () => {

  it('P231-E1: isSkeletonInWorkerEnabled 가 PLANNER_SKELETON_IN_WORKER === \'true\' 확인', () => {
    // 함수 본문에 === 'true' 비교 로직 포함
    const fnIdx = bgSrc.indexOf('export function isSkeletonInWorkerEnabled');
    const fnSrc = bgSrc.slice(fnIdx, fnIdx + 300);
    expect(fnSrc).toMatch(/PLANNER_SKELETON_IN_WORKER/);
    expect(fnSrc).toMatch(/['"]true['"]/);
  });

  it('P231-E2: isSkeletonInWorkerEnabled 가 기본 false 를 보장 (기존 동작 100% 유지)', () => {
    // `|| ''` 패턴 = ENV 없으면 빈 문자열 = !== 'true' → false
    const fnIdx = bgSrc.indexOf('export function isSkeletonInWorkerEnabled');
    const fnSrc = bgSrc.slice(fnIdx, fnIdx + 300);
    expect(fnSrc).toMatch(/\|\|\s*['"]{2}/); // || '' 패턴
  });

});

// ── Inngest event payload 구조 검증 (정적 소스) ──────────────────────────────
// 참고: inngestDispatch.js 가 inngest SDK 를 transitive import 하므로
//   동적 import 가 vitest 환경에서 패키지 해석 실패. 정적 소스 검증으로 대체.

describe('P231 buildPlanAiCompletePayload skeletonCtx 정적 검증', () => {

  it('P231-F1: skeletonCtx 있을 때 ctx 에 spread 하는 패턴 존재', () => {
    // `...(skeletonCtx ? { skeletonCtx } : {})` 또는 직접 할당 패턴 확인
    expect(dispatchSrc).toMatch(/skeletonCtx.*\?.*\{.*skeletonCtx.*\}.*:/s);
  });

  it('P231-F2: buildPlanAiCompletePayload 함수 본문에서 skeletonCtx 디스트럭처링', () => {
    const fnIdx = dispatchSrc.indexOf('export function buildPlanAiCompletePayload');
    const fnSrc = dispatchSrc.slice(fnIdx, fnIdx + 2000);
    // 파라미터 디스트럭처링에 skeletonCtx 포함
    expect(fnSrc).toMatch(/skeletonCtx/);
  });

  it('P231-F3: dispatchOrInlineForHandlerCore 파라미터에 skeletonCtx 존재', () => {
    const fnIdx = dispatchSrc.indexOf('export async function dispatchOrInlineForHandlerCore');
    const fnSrc = dispatchSrc.slice(fnIdx, fnIdx + 1000);
    expect(fnSrc).toMatch(/skeletonCtx/);
  });

});

// ── 2026-08-24 (planner-trust) — real runtime proof for processPlanAfterAI.js
//   Step 0 ("skeleton-write"). Invokes the actual InngestFunction handler (`.fn`)
//   with a mocked `step.run` (executes the callback immediately, no queueing) and
//   a mocked adminDb that captures every .set() call. Proves:
//     1. the PUBLIC doc written by Step 0 always has itinerary.days === []
//        even when a real block-mode itinerary (non-empty days) is present in
//        ctx.skeletonCtx.blockModeItinerary.
//     2. the pipeline was NOT neutered — Step 1 (routeEnrich) and Step 5
//        (persistPlan) still received the real, non-empty-days itinerary via
//        event.data.itinerary (internal only, never public-doc-written raw).
describe('P231 Step 0 (skeleton-write) — real invocation, public doc sanitization', () => {
  const realItinerary = {
    tour_title: 'Real Trip (unvetted)',
    days: [
      { day: 1, stops: [{ name: 'Stop A', display_name: 'Stop A' }] },
      { day: 2, stops: [{ name: 'Stop B', display_name: 'Stop B' }] },
    ],
  };

  function makeStep() {
    // step.run(id, cb) normally queues a durable step; for this unit test we just
    // want the callback's Firestore side-effects, so invoke it immediately.
    return { run: async (_id: string, cb: () => unknown) => cb() };
  }
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  beforeEach(() => {
    mockCalls.length = 0;
    vi.clearAllMocks();
  });

  it('P231-G1: skeletonCtx present (P231 ON path) — public skeleton-write has itinerary.days=[], real days only reach internal pipeline', async () => {
    const { processPlanAfterAI } = await import('../../api/_inngest/functions/processPlanAfterAI.js');
    const eventData = {
      planId: 'plan-abc',
      itinerary: realItinerary, // gated top-level itinerary — internal only, flows to Step1-5
      ctx: {
        apiKey: 'k', body: {}, hotel_address: null, arrival_airport: null, departure_airport: null, pax: 2,
        recommendedZone: null, recommendedZoneAddress: null, hotelAddressFromBody: null, hotelByCity: null,
        area: 'seoul', dietPrefs: [], regions: [], vehicle: 'staria_8', durationDays: 3,
        uid: 'u1', guestName: 'G', styles: [], duration: 3, startDate: '2026-06-01', email: null,
        specialRequest: null, mobility: null, language: 'en',
        plannerMode: 'block_mode', abReason: null, abBucket: null, blocksUsed: [],
        streamingPlanId: 'plan-abc',
        isAdminBypass: false, identifierForBucketing: null,
        skeletonCtx: {
          uid: 'u1', email: null, area: 'seoul', startDate: '2026-06-01', guestName: 'G', pax: 2, language: 'en',
          vehicle: 'staria_8', priceKRW: 100000, priceUSD: 75, body: {},
          blockModeItinerary: realItinerary, // ← the raw content that used to leak
          forceGuestToken: false,
        },
      },
    };

    const result = await (processPlanAfterAI as unknown as { fn: (args: unknown) => Promise<unknown> }).fn({ event: { data: eventData }, step: makeStep(), logger });

    // (1) The Step 0 public write must have empty days, despite non-empty input.
    const skeletonWriteCall = mockCalls.find((c) => c.id === 'plan-abc' && c.data._p231_stub === false);
    expect(skeletonWriteCall).toBeDefined();
    expect(skeletonWriteCall!.data.itinerary.days).toEqual([]);
    expect(skeletonWriteCall!.data.itinerary.tour_title).toBeNull();
    expect(skeletonWriteCall!.data._block_mode_used).toBe(true);

    // No .set() call captured anywhere (skeleton-write OR the trailing status mark)
    // may carry non-empty days — this is the invariant the fix guarantees.
    for (const c of mockCalls) {
      expect((c.data.itinerary?.days || []).length).toBe(0);
    }

    // (2) Internal pipeline was NOT neutered — Step 1/Step 5 got the real itinerary.
    expect(pipelineMocks.runRouteEnrichment).toHaveBeenCalledTimes(1);
    expect(pipelineMocks.runRouteEnrichment.mock.calls[0][0]).toBe(realItinerary);
    expect(pipelineMocks.runRouteEnrichment.mock.calls[0][0].days.length).toBe(2);

    expect(pipelineMocks.savePlan).toHaveBeenCalledTimes(1);
    const persistArgs = pipelineMocks.savePlan.mock.calls[0][1];
    expect(persistArgs.itinerary.days.length).toBe(2);
    expect(persistArgs.itinerary).toBe(realItinerary);

    expect(result.planId).toBe('plan-abc');
  });

  it('P231-G2: skeletonCtx absent (P231 OFF / legacy path) — Step 0 skipped entirely, no premature public write, pipeline still processes real itinerary', async () => {
    const { processPlanAfterAI } = await import('../../api/_inngest/functions/processPlanAfterAI.js');
    const eventData = {
      planId: 'plan-def',
      itinerary: realItinerary,
      ctx: {
        apiKey: 'k', body: {}, hotel_address: null, arrival_airport: null, departure_airport: null, pax: 2,
        recommendedZone: null, recommendedZoneAddress: null, hotelAddressFromBody: null, hotelByCity: null,
        area: 'seoul', dietPrefs: [], regions: [], vehicle: 'staria_8', durationDays: 3,
        uid: 'u1', guestName: 'G', styles: [], duration: 3, startDate: '2026-06-01', email: null,
        specialRequest: null, mobility: null, language: 'en',
        plannerMode: 'block_mode', abReason: null, abBucket: null, blocksUsed: [],
        streamingPlanId: 'plan-def',
        isAdminBypass: false, identifierForBucketing: null,
        // skeletonCtx intentionally absent — this is what PLANNER_SKELETON_IN_WORKER=false
        // produces upstream (backgroundPipelines.js never sets skeletonCtx in that case).
      },
    };

    await (processPlanAfterAI as unknown as { fn: (args: unknown) => Promise<unknown> }).fn({ event: { data: eventData }, step: makeStep(), logger });

    // No 'skeleton-write'-shaped call (identified by the _p231_stub key) at all.
    const skeletonWriteCall = mockCalls.find((c) => Object.prototype.hasOwnProperty.call(c.data, '_p231_stub'));
    expect(skeletonWriteCall).toBeUndefined();

    // Pipeline still ran on the real itinerary — proves Step 0 skip doesn't neuter Steps 1-5.
    expect(pipelineMocks.runRouteEnrichment).toHaveBeenCalledTimes(1);
    expect(pipelineMocks.runRouteEnrichment.mock.calls[0][0]).toBe(realItinerary);
    expect(pipelineMocks.savePlan).toHaveBeenCalledTimes(1);
    expect(pipelineMocks.savePlan.mock.calls[0][1].itinerary.days.length).toBe(2);
  });
});
