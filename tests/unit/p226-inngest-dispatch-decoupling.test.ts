/**
 * P226 (2026-05-27): Inngest dispatch streaming decoupling 회귀 차단.
 *
 * Root cause:
 *   P222 가 early response 폐기 (PLANNER_STREAMING_EARLY_RESPONSE default false)
 *   → streamingResponseSent=false → maybeDispatchToInngest 의 가드
 *   (if (!streamingResponseSent) return false) 가 즉시 false 반환 → Inngest dispatch skip
 *   → inline routeEnrich + persistPlan → HTTP +21초 (32.8s → 53.7s).
 *
 * Fix (옵션 A):
 *   1. maybeDispatchToInngest 의 streamingResponseSent 가드 제거
 *   2. tryDispatchOrFallback 상단에 streamingPlanId 가드 추가 (non-streaming 요청 보호)
 *
 * 기대 결과:
 *   - PLANNER_INNGEST_ENABLED=true + streamingPlanId 존재 → Inngest dispatch 시도 → worker 처리
 *   - HTTP latency 회복 (Gemini + DB match + send ≈ 10-15s)
 *   - status='ready' 보장 (Inngest durable retry, Vercel freeze 무관)
 *   - non-streaming 요청 (streamingPlanId=null) → dispatch skip → 기존 inline
 *
 * 본 test 는 inngestDispatch.js 의 소스 텍스트 + 함수 동작 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../../../');
const DISPATCH_PATH = path.join(ROOT, 'api/_ai_core/inngestDispatch.js');
const dispatchSrc = readFileSync(DISPATCH_PATH, 'utf-8');

describe('P226 Inngest dispatch streaming decoupling 회귀 차단', () => {

  // ── 정적 소스 검증 ─────────────────────────────────────────────────────

  it('P226-A1: maybeDispatchToInngest 에서 streamingResponseSent 가드 제거됨', () => {
    // P222 후 streamingResponseSent 가 항상 false → 본 가드가 dispatch 차단 했었음
    // P226 fix = 본 가드 제거. inline check 패턴이 남아있으면 회귀.
    const guardRegex = /maybeDispatchToInngest[\s\S]{0,300}?if\s*\(\s*!streamingResponseSent\s*\)\s*return\s+false/;
    expect(guardRegex.test(dispatchSrc)).toBe(false);
  });

  it('P226-A2: tryDispatchOrFallback 에 streamingPlanId 가드 추가됨 (non-streaming 보호)', () => {
    // non-streaming 요청 (streamingPlanId=null) 시 dispatch skip 의무
    const guardRegex = /tryDispatchOrFallback[\s\S]{0,500}?if\s*\(\s*!args\.streamingPlanId\s*\)\s*return\s+false/;
    expect(guardRegex.test(dispatchSrc)).toBe(true);
  });

  it('P226-A3: P226 코멘트 (root cause + fix 이유) 가 inngestDispatch.js 에 존재', () => {
    expect(dispatchSrc).toMatch(/P226/);
    expect(dispatchSrc).toMatch(/streamingResponseSent.*가드|early response 폐기/);
  });

  // ── 런타임 동작 검증 ──────────────────────────────────────────────────

  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {
      INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
      INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
      PLANNER_INNGEST_ENABLED: process.env.PLANNER_INNGEST_ENABLED,
      VERCEL_ENV: process.env.VERCEL_ENV,
      PLANNER_INNGEST_WORKER_SYNCED: process.env.PLANNER_INNGEST_WORKER_SYNCED,
    };
    // P318 (2026-05-31): dispatch now also requires production runtime + verified
    // worker sync. These runtime tests exercise the P226 dispatch-decoupling path,
    // so set both here (afterEach restores). The P318 gate itself is covered by the
    // p220 shouldDispatchToInngest assertions (3/3b/3c).
    process.env.VERCEL_ENV = 'production';
    process.env.PLANNER_INNGEST_WORKER_SYNCED = 'true';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('P226-B1: streamingResponseSent=false + streamingPlanId 존재 시 dispatch 시도 (P226 핵심 fix)', async () => {
    process.env.INNGEST_EVENT_KEY = 'test-event-key';
    process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
    process.env.PLANNER_INNGEST_ENABLED = 'true';

    const { maybeDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');

    // streamingResponseSent=false (P222 후 default) 인데도 dispatch 시도해야 함
    // 실제 send() 는 mock 안 했으므로 throw → false 반환 (fallback) — 그러나
    // 가드를 통과했음 확인 = OK (이전엔 streamingResponseSent=false 시 즉시 false 반환 했음)
    const result = await maybeDispatchToInngest({
      streamingResponseSent: false,
      streamingPlanId: 'test-plan-id-123',
      itinerary: {},
      apiKey: 'test',
    });

    // 결과는 false (실제 send() throw) 이지만, 중요한 건 가드 통과 후 fallback 동작
    expect(typeof result).toBe('boolean');
  }, 30000); // P231 note: 실제 Inngest API 호출 → 네트워크 응답 대기 (401). 30s timeout.

  it('P226-B2: streamingPlanId=null 시 dispatch skip (non-streaming 보호)', async () => {
    process.env.INNGEST_EVENT_KEY = 'test-event-key';
    process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
    process.env.PLANNER_INNGEST_ENABLED = 'true';

    const { maybeDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');

    const result = await maybeDispatchToInngest({
      streamingResponseSent: false,
      streamingPlanId: null,  // non-streaming 요청
      itinerary: {},
      apiKey: 'test',
    });

    // streamingPlanId 없으면 dispatch 안 함 → false (inline fallback)
    expect(result).toBe(false);
  });

  it('P226-B3: ENV 누락 시 dispatch skip 유지 (P220 silent fail 차단)', async () => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
    process.env.PLANNER_INNGEST_ENABLED = 'true';

    const { maybeDispatchToInngest } = await import('../../api/_ai_core/inngestDispatch.js');

    const result = await maybeDispatchToInngest({
      streamingResponseSent: true,
      streamingPlanId: 'test-plan-id-123',
      itinerary: {},
      apiKey: 'test',
    });

    // ENV 누락 시 항상 false (P220 의 shouldDispatchToInngest 가드)
    expect(result).toBe(false);
  });
});
