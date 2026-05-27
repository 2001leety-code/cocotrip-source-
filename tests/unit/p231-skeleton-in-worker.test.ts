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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
