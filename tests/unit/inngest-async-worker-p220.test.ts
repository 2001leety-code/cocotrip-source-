/**
 * P220 (2026-05-26): Inngest async worker 도입 (architecture).
 *
 * 3 AI second opinion 합의 fix #6 (가장 큰 변경). Vercel 300s timeout 회피 +
 * Firestore gRPC DEADLINE_EXCEEDED 자동 retry + 27분 routeEnrich hang 차단.
 *
 * 흐름:
 *   기존: handlerCore.js inline → Gemini + routeEnrich + persistPlan 한 invocation.
 *   P220: streaming + Inngest 활성화 시 → routeEnrich+persist 는 Inngest worker (별 invocation).
 *
 * 안전장치:
 *   - INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY 누락 → shouldDispatchToInngest() = false → inline fallback.
 *   - PLANNER_INNGEST_ENABLED 토글 = false (기본) → 운영자가 ramp 결정.
 *   - publishPlanAiComplete throw → handlerCore catch → inline fallback (silent fail 차단).
 *
 * assertion 9종:
 *   1. isInngestConfigured() — ENV 둘 다 있으면 true
 *   2. isInngestConfigured() — 한 쪽 누락이면 false (silent fail 차단)
 *   3. shouldDispatchToInngest() — ENV + PLANNER_INNGEST_ENABLED=true → true
 *   4. shouldDispatchToInngest() — ENV 있어도 PLANNER_INNGEST_ENABLED=false → false (ramp 안전)
 *   5. shouldDispatchToInngest() — ENV 없으면 토글과 무관하게 false
 *   6. INNGEST_EVENTS.PLAN_AI_COMPLETE event name = 'plan/ai.complete' (worker fn trigger 와 일치)
 *   7. inngest client.id = 'cocotrip' (Inngest dashboard 식별)
 *   8. handlerCore.js — shouldDispatchToInngest + publishPlanAiComplete import 존재
 *   9. handlerCore.js — inngestDispatched 변수 + try/catch inline fallback 패턴 존재
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('P220 isInngestConfigured — ENV 검사 (silent fail 차단)', () => {
  // env 백업 + restore — test isolation.
  const ORIG_EVENT = process.env.INNGEST_EVENT_KEY;
  const ORIG_SIGNING = process.env.INNGEST_SIGNING_KEY;
  const ORIG_ENABLED = process.env.PLANNER_INNGEST_ENABLED;

  afterEach(() => {
    if (ORIG_EVENT === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = ORIG_EVENT;
    if (ORIG_SIGNING === undefined) delete process.env.INNGEST_SIGNING_KEY;
    else process.env.INNGEST_SIGNING_KEY = ORIG_SIGNING;
    if (ORIG_ENABLED === undefined) delete process.env.PLANNER_INNGEST_ENABLED;
    else process.env.PLANNER_INNGEST_ENABLED = ORIG_ENABLED;
  });

  it('assertion 1: 두 ENV 모두 set → isInngestConfigured() = true', async () => {
    process.env.INNGEST_EVENT_KEY = 'test-event-key-xyz';
    process.env.INNGEST_SIGNING_KEY = 'test-signing-key-abc';
    // 모듈은 ENV 를 read time 으로 검사 (top-level 가 아니라 함수 안에서) → re-import 불필요.
    const { isInngestConfigured } = await import('../../api/_inngest/client.js');
    expect(isInngestConfigured()).toBe(true);
  });

  it('assertion 2: SIGNING_KEY 만 있고 EVENT_KEY 누락 → false (round-trip 불완전)', async () => {
    delete process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_SIGNING_KEY = 'only-signing-key';
    const { isInngestConfigured } = await import('../../api/_inngest/client.js');
    expect(isInngestConfigured()).toBe(false);
  });

  it('assertion 2b: EVENT_KEY 만 있고 SIGNING_KEY 누락 → false', async () => {
    process.env.INNGEST_EVENT_KEY = 'only-event-key';
    delete process.env.INNGEST_SIGNING_KEY;
    const { isInngestConfigured } = await import('../../api/_inngest/client.js');
    expect(isInngestConfigured()).toBe(false);
  });
});

describe('P220 shouldDispatchToInngest — toggle ramp 안전', () => {
  const ORIG_EVENT = process.env.INNGEST_EVENT_KEY;
  const ORIG_SIGNING = process.env.INNGEST_SIGNING_KEY;
  const ORIG_ENABLED = process.env.PLANNER_INNGEST_ENABLED;

  afterEach(() => {
    if (ORIG_EVENT === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = ORIG_EVENT;
    if (ORIG_SIGNING === undefined) delete process.env.INNGEST_SIGNING_KEY;
    else process.env.INNGEST_SIGNING_KEY = ORIG_SIGNING;
    if (ORIG_ENABLED === undefined) delete process.env.PLANNER_INNGEST_ENABLED;
    else process.env.PLANNER_INNGEST_ENABLED = ORIG_ENABLED;
  });

  it('assertion 3: ENV 둘 다 set + PLANNER_INNGEST_ENABLED=true → dispatch true', async () => {
    process.env.INNGEST_EVENT_KEY = 'k1';
    process.env.INNGEST_SIGNING_KEY = 'k2';
    process.env.PLANNER_INNGEST_ENABLED = 'true';
    const { shouldDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');
    expect(shouldDispatchToInngest()).toBe(true);
  });

  it('assertion 4: ENV 있어도 PLANNER_INNGEST_ENABLED=false → dispatch false (ramp 안전 default)', async () => {
    process.env.INNGEST_EVENT_KEY = 'k1';
    process.env.INNGEST_SIGNING_KEY = 'k2';
    process.env.PLANNER_INNGEST_ENABLED = 'false';
    const { shouldDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');
    expect(shouldDispatchToInngest()).toBe(false);
  });

  it('assertion 4b: PLANNER_INNGEST_ENABLED 미정 → dispatch false (default OFF)', async () => {
    process.env.INNGEST_EVENT_KEY = 'k1';
    process.env.INNGEST_SIGNING_KEY = 'k2';
    delete process.env.PLANNER_INNGEST_ENABLED;
    const { shouldDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');
    expect(shouldDispatchToInngest()).toBe(false);
  });

  it('assertion 5: ENV 누락 → 토글 true 라도 dispatch false (silent fail 차단)', async () => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
    process.env.PLANNER_INNGEST_ENABLED = 'true';
    const { shouldDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');
    expect(shouldDispatchToInngest()).toBe(false);
  });
});

describe('P220 Inngest event + client config', () => {
  it('assertion 6: INNGEST_EVENTS.PLAN_AI_COMPLETE = "plan/ai.complete"', async () => {
    const { INNGEST_EVENTS } = await import('../../api/_inngest/client.js');
    expect(INNGEST_EVENTS.PLAN_AI_COMPLETE).toBe('plan/ai.complete');
  });

  it('assertion 7: inngest client id = "cocotrip" (dashboard 식별)', async () => {
    const { inngest } = await import('../../api/_inngest/client.js');
    expect(inngest).toBeDefined();
    // Inngest SDK v4: client.id 또는 client.name 노출.
    const id = (inngest as any).id || (inngest as any).appId || (inngest as any).name;
    expect(id).toBe('cocotrip');
  });
});

describe('P220 handlerCore.js — Inngest 분기 + inline fallback 패턴', () => {
  const handlerCorePath = resolve(__dirname, '../../api/_ai_core/handlerCore.js');

  it('assertion 8: handlerCore 가 inngestDispatch.js 모듈 import 함', () => {
    const src = readFileSync(handlerCorePath, 'utf8');
    expect(/from\s+['"]\.\/inngestDispatch\.js['"]/.test(src)).toBe(true);
    expect(/dispatchOrInlineForHandlerCore/.test(src)).toBe(true);
  });

  it('assertion 9: handlerCore — dispatch + early return 패턴 (silent fail 차단 by helper)', () => {
    const src = readFileSync(handlerCorePath, 'utf8');
    // dispatchOrInlineForHandlerCore(...) 호출 후 if (...) return — early return 분기.
    expect(/dispatchOrInlineForHandlerCore\s*\(/.test(src)).toBe(true);
    // log 는 dispatchOrInlineForHandlerCore 내부에서 (tryDispatchAndLog 호출) → handler 자체에는 없을 수 있음.
    // inngestDispatch.js 에 P220 dispatched 문자열 존재 검증으로 대체.
    const dispatchSrc = readFileSync(resolve(__dirname, '../../api/_ai_core/inngestDispatch.js'), 'utf8');
    expect(/P220 dispatched/.test(dispatchSrc)).toBe(true);
  });

  it('assertion 9b: inngestDispatch.js 모듈에 fallback 코멘트 + tryDispatchOrFallback 함수 존재', () => {
    const dispatchPath = resolve(__dirname, '../../api/_ai_core/inngestDispatch.js');
    const src = readFileSync(dispatchPath, 'utf8');
    expect(/tryDispatchOrFallback/.test(src)).toBe(true);
    expect(/Inngest dispatch failed/i.test(src)).toBe(true);
    expect(/silent fail/i.test(src)).toBe(true);
  });

  it('assertion 10: P220 주석 + architecture change 명시', () => {
    const src = readFileSync(handlerCorePath, 'utf8');
    expect(/P220/.test(src)).toBe(true);
  });
});

describe('P220 worker function — event trigger + step.run id 명세', () => {
  const workerPath = resolve(__dirname, '../../api/_inngest/functions/processPlanAfterAI.js');

  it('assertion 11: worker fn 이 plan/ai.complete event 로 trigger', () => {
    const src = readFileSync(workerPath, 'utf8');
    expect(/event:\s*['"]plan\/ai\.complete['"]/.test(src)).toBe(true);
  });

  it('assertion 12: 6 step.run id 모두 정의 (routeEnrich / backfillsAndTmoney / recommendedRestaurants / computePricing / persistPlan)', () => {
    const src = readFileSync(workerPath, 'utf8');
    expect(/step\.run\(['"]routeEnrich['"]/.test(src)).toBe(true);
    expect(/step\.run\(['"]backfillsAndTmoney['"]/.test(src)).toBe(true);
    expect(/step\.run\(['"]recommendedRestaurants['"]/.test(src)).toBe(true);
    expect(/step\.run\(['"]computePricing['"]/.test(src)).toBe(true);
    expect(/step\.run\(['"]persistPlan['"]/.test(src)).toBe(true);
  });

  it('assertion 13: _inngest_status="ready" Firestore mark (PlanDetailPage onSnapshot 자동 갱신용)', () => {
    const src = readFileSync(workerPath, 'utf8');
    expect(/_inngest_status:\s*['"]ready['"]/.test(src)).toBe(true);
  });
});

describe('P220 inngest.js — Vercel serve handler 진입점', () => {
  const servePath = resolve(__dirname, '../../api/inngest.js');

  it('assertion 14: serve handler 가 inngest/node 에서 import + maxDuration 명시', () => {
    const src = readFileSync(servePath, 'utf8');
    expect(/from\s+['"]inngest\/node['"]/.test(src)).toBe(true);
    expect(/serve\s*\(/.test(src)).toBe(true);
    expect(/maxDuration\s*=\s*300/.test(src)).toBe(true);
  });

  it('assertion 15: processPlanAfterAI 가 functions 배열에 등록됨', () => {
    const src = readFileSync(servePath, 'utf8');
    expect(/processPlanAfterAI/.test(src)).toBe(true);
    expect(/functions:\s*\[/.test(src)).toBe(true);
  });
});
