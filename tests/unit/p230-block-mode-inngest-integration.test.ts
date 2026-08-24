/**
 * P230 (2026-05-27): block-mode + Inngest 통합 회귀 차단.
 *
 * Root cause:
 *   block-mode (P128/P167) 가 itinerary 를 미리 생성하면 shouldUseStreaming() 이
 *   false 반환 (`return isStreamingEnabled() && !itinerary && plannerMode !== '3pass'`)
 *   → streamingPlanId 가 null → tryDispatchOrFallback (P226) 의 가드
 *   `if (!args.streamingPlanId) return false` 가 Inngest dispatch 차단 → inline
 *   routeEnrich (20s) 진행 → block-mode + block_mode HTTP latency 26.6s.
 *
 * Fix:
 *   1. backgroundPipelines.js 에 tryInitBlockModeForInngest 추가 — block-mode
 *      itinerary 를 _streaming_in_progress=true skeleton 으로 Firestore 저장 +
 *      streamingPlanId 확보.
 *   2. backgroundPipelines.js 에 tryBlockModeInngestPath 추가 — skeleton init +
 *      dispatch + early response 단일 helper. handlerCore P129 500L cap 보호.
 *   3. handlerCore.js 가 block-mode + Inngest 활성 시 tryBlockModeInngestPath
 *      호출 → 성공 시 즉시 return. 실패 시 streamingPlanId 만 받아 inline path
 *      가 같은 planId 재사용 (savePlan planIdOverride).
 *
 * 기대 결과:
 *   - PLANNER_INNGEST_ENABLED=true + block-mode 사용 → Inngest dispatch 진행
 *     → worker durable (routeEnrich + persist + _inngest_status='ready' 보장)
 *   - HTTP latency 회복 (skeleton save + dispatch ≈ 3-5s, block-mode latency 무관)
 *   - Inngest 미설정 / dispatch 실패 → 기존 block-mode inline 흐름 100% (회귀 0)
 *   - P226 의 streamingPlanId 가드 유지 (non-streaming legacy 보호)
 *   - P222 회귀 회피 (PLANNER_STREAMING_EARLY_RESPONSE ENV 무관하게 block-mode +
 *     Inngest 시는 항상 early response)
 *
 * 본 test 는 핵심 helper 의 함수 동작 + 정적 소스 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ── 2026-08-24 (planner-trust) test helper — mocked adminDb that captures every
//   .collection('plans').doc(id).set(data, opts) call so we can assert exactly
//   what would have landed in the PUBLIC Firestore doc a guest's onSnapshot reads.
function makeMockAdminDb() {
  const calls: Array<{ id: string; data: Record<string, unknown>; opts: Record<string, unknown> | undefined }> = [];
  return {
    calls,
    collection: () => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>, opts?: Record<string, unknown>) => {
          calls.push({ id, data, opts });
          return {};
        },
      }),
    }),
  };
}

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const BG_PATH = path.join(ROOT, 'api/_ai_core/backgroundPipelines.js');
const HANDLER_PATH = path.join(ROOT, 'api/_ai_core/handlerCore.js');
const bgSrc = readFileSync(BG_PATH, 'utf-8');
const handlerSrc = readFileSync(HANDLER_PATH, 'utf-8');

describe('P230 block-mode + Inngest 통합 회귀 차단', () => {

  // ── 정적 소스 검증 ─────────────────────────────────────────────────────

  it('P230-A1: tryInitBlockModeForInngest 가 backgroundPipelines.js 에 존재', () => {
    expect(bgSrc).toMatch(/export\s+async\s+function\s+tryInitBlockModeForInngest\s*\(/);
  });

  it('P230-A2: tryBlockModeInngestPath 가 backgroundPipelines.js 에 존재', () => {
    expect(bgSrc).toMatch(/export\s+async\s+function\s+tryBlockModeInngestPath\s*\(/);
  });

  it('P230-A3: handlerCore 가 tryBlockModeInngestPath 호출 (block-mode + !streamingPlanId 조건)', () => {
    // block-mode 가 itinerary 만들면 streamingPlanId 는 null (P169 skeleton init 안 됨)
    // → tryBlockModeInngestPath 호출해서 skeleton + dispatch 진행해야 함.
    expect(handlerSrc).toMatch(/tryBlockModeInngestPath\s*\(/);
    expect(handlerSrc).toMatch(/blockModeUsed\s*&&\s*!streamingPlanId/);
  });

  it('P230-A4: handlerCore 의 legacy dispatchOrInlineForHandlerCore 호출이 block-mode 제외', () => {
    // !blockModeUsed 가드 — block-mode 는 P230 path 가 처리. legacy streaming 만 본 호출 진입.
    const legacyDispatchGuard = /if\s*\(\s*!blockModeUsed\s*&&\s*await\s+dispatchOrInlineForHandlerCore/;
    expect(legacyDispatchGuard.test(handlerSrc)).toBe(true);
  });

  it('P230-A5: tryInitBlockModeForInngest 가 _streaming_in_progress 유지 (savePlanSkeleton 재사용)', () => {
    // savePlanSkeleton 호출 + itinerary merge 패턴 검사 (block-mode 결과를 skeleton 위에 덮어씀)
    expect(bgSrc).toMatch(/savePlanSkeleton\s*\(/);
    // tryInitBlockModeForInngest 함수 본문에 _streaming_skeleton + merge:true 패턴 (전체 파일 검사 + 함수 시작 위치 확인)
    const fnStart = bgSrc.indexOf('export async function tryInitBlockModeForInngest');
    expect(fnStart).toBeGreaterThan(0);
    // 함수 시작 후 ~3000 chars 범위 (함수 본문 크기)
    const fnBody = bgSrc.slice(fnStart, fnStart + 3500);
    expect(fnBody).toMatch(/_streaming_skeleton/);
    expect(fnBody).toMatch(/merge:\s*true/);
  });

  it('P230-A6: tryBlockModeInngestPath 가 가드 미통과 시 null 반환 (회귀 0)', () => {
    const fnStart = bgSrc.indexOf('export async function tryBlockModeInngestPath');
    expect(fnStart).toBeGreaterThan(0);
    // 함수 시작 후 ~2500 chars 범위 (함수 본문)
    const fnBody = bgSrc.slice(fnStart, fnStart + 2500);
    // !isInngestEnabled 또는 !blockModeUsed 또는 !itinerary 시 return null
    expect(fnBody).toMatch(/return\s+null/);
    // 가드 패턴 검증
    expect(fnBody).toMatch(/!blockModeUsed|!itinerary|!isInngestEnabled/);
  });

  it('P230-A7: P230 코멘트 (root cause + fix) 가 backgroundPipelines.js 에 존재', () => {
    expect(bgSrc).toMatch(/P230/);
    expect(bgSrc).toMatch(/block-mode.*Inngest/);
  });

  // ── 런타임 동작 검증 ──────────────────────────────────────────────────

  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
      INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
      PLANNER_INNGEST_ENABLED: process.env.PLANNER_INNGEST_ENABLED,
    };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('P230-B1: tryBlockModeInngestPath — !blockModeUsed 시 null 반환', async () => {
    const { tryBlockModeInngestPath } = await import('../../api/_ai_core/backgroundPipelines.js');
    const result = await tryBlockModeInngestPath({
      adminDb: null,
      isInngestEnabled: true,
      blockModeUsed: false,  // ← 핵심
      itinerary: { days: [] },
      uid: 'test', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
      guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
      dispatchFn: async () => true,
      sendEarlyResponse: () => {},
      buildDebug: () => null,
    });
    expect(result).toBe(null);
  });

  it('P230-B2: tryBlockModeInngestPath — !itinerary 시 null 반환', async () => {
    const { tryBlockModeInngestPath } = await import('../../api/_ai_core/backgroundPipelines.js');
    const result = await tryBlockModeInngestPath({
      adminDb: null,
      isInngestEnabled: true,
      blockModeUsed: true,
      itinerary: null,  // ← 핵심
      uid: 'test', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
      guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
      dispatchFn: async () => true,
      sendEarlyResponse: () => {},
      buildDebug: () => null,
    });
    expect(result).toBe(null);
  });

  it('P230-B3: tryBlockModeInngestPath — isInngestEnabled false 시 null 반환 (silent fail 차단)', async () => {
    const { tryBlockModeInngestPath } = await import('../../api/_ai_core/backgroundPipelines.js');
    const result = await tryBlockModeInngestPath({
      adminDb: null,
      isInngestEnabled: false,  // ← 핵심
      blockModeUsed: true,
      itinerary: { days: [] },
      uid: 'test', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
      guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
      dispatchFn: async () => true,
      sendEarlyResponse: () => {},
      buildDebug: () => null,
    });
    expect(result).toBe(null);
  });

  it('P230-B4: tryInitBlockModeForInngest — adminDb 없으면 null 반환', async () => {
    const { tryInitBlockModeForInngest } = await import('../../api/_ai_core/backgroundPipelines.js');
    const result = await tryInitBlockModeForInngest({
      adminDb: null,  // ← 핵심
      uid: 'test', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
      guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
      itinerary: { days: [] },
    });
    expect(result).toBe(null);
  });

  it('P230-B5: tryInitBlockModeForInngest — itinerary 없으면 null 반환', async () => {
    const { tryInitBlockModeForInngest } = await import('../../api/_ai_core/backgroundPipelines.js');
    const result = await tryInitBlockModeForInngest({
      adminDb: { collection: () => ({}) },
      uid: 'test', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
      guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
      itinerary: null,  // ← 핵심
    });
    expect(result).toBe(null);
  });

  it('P230-B6: P226 의 streamingPlanId 가드는 유지 (P226 회귀 차단)', async () => {
    // P226 가드 (inngestDispatch.js) — streamingPlanId 없으면 false. P230 는 이 가드를
    // 통과하기 위해 skeleton init 후 streamingPlanId 확보. 가드 자체 회귀 없는지 검사.
    const dispatchSrc = readFileSync(path.join(ROOT, 'api/_ai_core/inngestDispatch.js'), 'utf-8');
    expect(dispatchSrc).toMatch(/if\s*\(\s*!args\.streamingPlanId\s*\)\s*return\s+false/);
  });

  it('P230-B7: handlerCore — P230 path 가 try block 안 (catch 의 sentry context 안전)', () => {
    // tryBlockModeInngestPath 호출이 try 블록 안에 있어야 함 (await 시 throw → catch 가 처리).
    // import 위치 무시 — `await tryBlockModeInngestPath(` 호출 패턴만 검색.
    const tryStart = handlerSrc.indexOf('  try {');
    const callMatch = handlerSrc.match(/await\s+tryBlockModeInngestPath\s*\(/);
    expect(callMatch).not.toBeNull();
    const callPos = callMatch ? handlerSrc.indexOf(callMatch[0]) : -1;
    const catchPos = handlerSrc.indexOf('} catch (error)');
    expect(tryStart).toBeGreaterThan(0);
    expect(callPos).toBeGreaterThan(tryStart);
    expect(callPos).toBeLessThan(catchPos);
  });

  // ── 2026-08-24 (planner-trust) — real behavioral proof: PUBLIC Firestore doc
  //   written by tryInitBlockModeForInngest must have itinerary.days === [] until
  //   the terminal gates run, for BOTH PLANNER_SKELETON_IN_WORKER values. The raw
  //   block-mode itinerary must still be reachable internally (skeletonCtx /
  //   savePlanSkeleton doc) — proving we sanitized the write, not the pipeline.

  describe('P230-C: tryInitBlockModeForInngest — public doc sanitization (real adminDb capture)', () => {
    const rawItinerary = {
      tour_title: 'Real Trip (unvetted)',
      days: [
        { day: 1, stops: [{ name: 'Stop A', display_name: 'Stop A' }] },
        { day: 2, stops: [{ name: 'Stop B', display_name: 'Stop B' }] },
      ],
    };
    const ORIG_FLAG = process.env.PLANNER_SKELETON_IN_WORKER;
    afterEach(() => {
      if (ORIG_FLAG === undefined) delete process.env.PLANNER_SKELETON_IN_WORKER;
      else process.env.PLANNER_SKELETON_IN_WORKER = ORIG_FLAG;
    });

    it('P230-C1: PLANNER_SKELETON_IN_WORKER=false (legacy branch) — public merge write has itinerary.days=[] even though input itinerary.days is non-empty', async () => {
      delete process.env.PLANNER_SKELETON_IN_WORKER;
      const { tryInitBlockModeForInngest } = await import('../../api/_ai_core/backgroundPipelines.js');
      const adminDb = makeMockAdminDb();
      const result = await tryInitBlockModeForInngest({
        adminDb, uid: 'u1', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
        guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
        itinerary: rawItinerary,
      });
      expect(result).not.toBeNull();
      // Two .set() calls expected: (1) savePlanSkeleton's initial empty-skeleton set,
      // (2) the merge that used to carry raw itinerary — now must be sanitized.
      const mergeCall = adminDb.calls.find((c) => c.opts && c.opts.merge === true);
      expect(mergeCall).toBeDefined();
      expect(mergeCall!.data.itinerary.days).toEqual([]);
      expect(mergeCall!.data.itinerary.tour_title).toBeNull();
      expect(mergeCall!.data._block_mode_used).toBe(true);
      // No captured .set() call anywhere should carry the real non-empty days —
      // proves the fix, not just the merge call in isolation.
      for (const c of adminDb.calls) {
        expect((c.data.itinerary?.days || []).length).toBe(0);
      }
    });

    it('P230-C2: PLANNER_SKELETON_IN_WORKER=true (P231 stub branch) — stub write carries no itinerary field at all, real data only in returned skeletonCtx (internal)', async () => {
      process.env.PLANNER_SKELETON_IN_WORKER = 'true';
      const { tryInitBlockModeForInngest } = await import('../../api/_ai_core/backgroundPipelines.js');
      const adminDb = makeMockAdminDb();
      const result = await tryInitBlockModeForInngest({
        adminDb, uid: 'u1', email: 'x@y.z', area: 'seoul', startDate: '2026-06-01',
        guestName: 'G', pax: 2, language: 'en', vehicle: 'staria_8', durationDays: 3, body: {},
        itinerary: rawItinerary,
      });
      expect(result).not.toBeNull();
      // Only one .set() call (the stub) — must not include an itinerary field at all,
      // i.e. no path for a client onSnapshot to see raw days pre-gate.
      expect(adminDb.calls.length).toBe(1);
      expect(adminDb.calls[0].data.itinerary).toBeUndefined();
      // The real itinerary is NOT lost — it must still flow through skeletonCtx
      // (internal Inngest event payload, never public-doc-written directly here).
      expect(result!.skeletonCtx).toBeDefined();
      expect(result!.skeletonCtx.blockModeItinerary).toBe(rawItinerary);
      expect(result!.skeletonCtx.blockModeItinerary.days.length).toBe(2);
    });
  });
});
