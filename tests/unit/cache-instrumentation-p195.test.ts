/**
 * P195 (2026-05-25): Gemini implicit cache instrumentation 회귀 테스트.
 *
 * 배경:
 *   - Gemini 2.5+ 부터 implicit caching 자동 활성화 (2025-05, Google Developer Blog)
 *   - usageMetadata.cachedContentTokenCount 가 cache hit token 수 노출
 *   - Phase 0 PR = explicit caching 도입 전 prod hit rate 측정 instrumentation
 *
 * 측정 결과 (1주일 prod log [P195 CACHE_METRICS] grep) 에 따라:
 *   - hit rate > 70%: explicit caching 도입 ROI 낮음 → P-pattern 보류
 *   - hit rate < 30%: explicit caching Phase 1 PR 진행
 *
 * assertion 7종:
 *   1. extractCacheMetadata: 정상 response → cached/total/output 정확 추출
 *   2. extractCacheMetadata: usageMetadata 없는 response → 모두 0
 *   3. extractCacheMetadata: response null/undefined → 모두 0 (안전)
 *   4. accumulateCacheMetadata: null/null → 0/0/0 (안전)
 *   5. accumulateCacheMetadata: 3 호출 누적 (retry 시나리오) → sum 정확
 *   6. buildAdminDebug: cacheMetadata 매개변수 → _debug 에 cachedInputTokens/cacheHitRate 노출
 *   7. buildAdminDebug: cacheMetadata null → _debug 에 0 값 노출 (안전 fallback)
 */
import { describe, it, expect } from 'vitest';
import { extractCacheMetadata, accumulateCacheMetadata } from '../../api/_ai_core/geminiPipeline.js';
import { buildAdminDebug } from '../../api/_ai_core/debugInfo.js';

describe('P195 extractCacheMetadata — Gemini SDK response 추출', () => {
  it('assertion 1: 정상 usageMetadata 가 있는 response → cached/total/output 정확 추출', () => {
    const mockResponse = {
      usageMetadata: {
        promptTokenCount: 10000,
        cachedContentTokenCount: 7500,
        candidatesTokenCount: 5000,
      },
    };
    const cm = extractCacheMetadata(mockResponse);
    expect(cm).toEqual({ cached: 7500, total: 10000, output: 5000 });
  });

  it('assertion 2: usageMetadata 없는 response → 모두 0 (안전 fallback)', () => {
    const mockResponse = {};
    const cm = extractCacheMetadata(mockResponse);
    expect(cm).toEqual({ cached: 0, total: 0, output: 0 });
  });

  it('assertion 3: response null/undefined → 모두 0 (안전 fallback)', () => {
    expect(extractCacheMetadata(null)).toEqual({ cached: 0, total: 0, output: 0 });
    expect(extractCacheMetadata(undefined)).toEqual({ cached: 0, total: 0, output: 0 });
  });

  it('assertion 3b: cachedContentTokenCount 만 없는 case (implicit cache miss) → cached=0, 나머지 정상', () => {
    const mockResponse = {
      usageMetadata: {
        promptTokenCount: 10000,
        candidatesTokenCount: 5000,
        // cachedContentTokenCount 누락 — implicit cache miss 시 SDK 가 필드 안 보낼 수 있음
      },
    };
    const cm = extractCacheMetadata(mockResponse);
    expect(cm).toEqual({ cached: 0, total: 10000, output: 5000 });
  });
});

describe('P195 accumulateCacheMetadata — 누적 합산', () => {
  it('assertion 4: null acc + null next → 0/0/0 (안전)', () => {
    expect(accumulateCacheMetadata(null, null)).toEqual({ cached: 0, total: 0, output: 0 });
  });

  it('assertion 4b: null acc + 정상 next → next 값 그대로', () => {
    const next = { cached: 5000, total: 10000, output: 3000 };
    expect(accumulateCacheMetadata(null, next)).toEqual({ cached: 5000, total: 10000, output: 3000 });
  });

  it('assertion 4c: 정상 acc + null next → acc 값 그대로 (skip)', () => {
    const acc = { cached: 1000, total: 2000, output: 500 };
    expect(accumulateCacheMetadata(acc, null)).toEqual({ cached: 1000, total: 2000, output: 500 });
  });

  it('assertion 5: 3 호출 누적 (legacy + dietary retry + pattern retry) → sum 정확', () => {
    let acc = { cached: 0, total: 0, output: 0 };
    acc = accumulateCacheMetadata(acc, { cached: 7500, total: 10000, output: 5000 });
    acc = accumulateCacheMetadata(acc, { cached: 8000, total: 10500, output: 5200 });
    acc = accumulateCacheMetadata(acc, { cached: 6000, total: 9800, output: 4800 });
    expect(acc).toEqual({ cached: 21500, total: 30300, output: 15000 });
  });
});

describe('P195 buildAdminDebug — itinerary._cache_metadata pop + _debug 노출 (admin-bypass 한정)', () => {
  const baseArgs = {
    gate: { isAdminBypass: true },
    plannerMode: 'legacy',
    abDecision: { reason: 'admin-bypass-force-legacy', bucket: 'admin' },
    identifierForBucketing: 'admin@test',
    blockModeUsed: false,
    blocksUsed: [],
    useStreaming: false,
  };

  it('assertion 6: itinerary._cache_metadata → _debug 에 cachedInputTokens + cacheHitRate 노출 (P268: 보존)', () => {
    const itinerary: any = { _cache_metadata: { cached: 7500, total: 10000, output: 5000 }, days: [] };
    const debug = buildAdminDebug({ ...baseArgs, itinerary });
    expect(debug).toBeDefined();
    expect(debug!.cachedInputTokens).toBe(7500);
    expect(debug!.totalInputTokens).toBe(10000);
    expect(debug!.outputTokens).toBe(5000);
    expect(debug!.cacheHitRate).toBe(75.0);  // 7500/10000 = 75%
    // P268 (2026-05-29): delete 제거 — itinerary._cache_metadata 보존 (P266 chain 시점 issue fix).
    // 보존 이유: _cache_metadata 가 final layer (Inngest dispatch + savePlan) 까지 살아있어야
    // P266 fix layer 1 (cacheMetadata: itinerary?._cache_metadata || null) 작동.
    expect(itinerary._cache_metadata).toBeDefined();
    expect(itinerary._cache_metadata.cached).toBe(7500);
  });

  it('assertion 6b: cacheHitRate 0.1% 단위 round (75.12% → 75.1%)', () => {
    const itinerary: any = { _cache_metadata: { cached: 7512, total: 10000, output: 5000 } };
    const debug = buildAdminDebug({ ...baseArgs, itinerary });
    expect(debug!.cacheHitRate).toBe(75.1);
  });

  it('assertion 7: itinerary 에 _cache_metadata 없음 → _debug 에 0 값 (안전 fallback, 3pass 등)', () => {
    const itinerary: any = { days: [] };
    const debug = buildAdminDebug({ ...baseArgs, itinerary });
    expect(debug).toBeDefined();
    expect(debug!.cachedInputTokens).toBe(0);
    expect(debug!.totalInputTokens).toBe(0);
    expect(debug!.outputTokens).toBe(0);
    expect(debug!.cacheHitRate).toBe(0);
  });

  it('assertion 7b: itinerary 매개변수 누락 → _debug 에 0 값 (undefined 안전)', () => {
    const debug = buildAdminDebug(baseArgs);
    expect(debug).toBeDefined();
    expect(debug!.cachedInputTokens).toBe(0);
    expect(debug!.totalInputTokens).toBe(0);
    expect(debug!.cacheHitRate).toBe(0);
  });

  it('assertion 8: 일반 user (isAdminBypass=false) → undefined (보안 — _debug 일반 노출 X)', () => {
    const itinerary: any = { _cache_metadata: { cached: 7500, total: 10000, output: 5000 } };
    const debug = buildAdminDebug({
      ...baseArgs,
      gate: { isAdminBypass: false },
      itinerary,
    });
    expect(debug).toBeUndefined();
    // P195: 일반 user 호출 시 _cache_metadata 는 pop 하지 않음 (early return).
    expect(itinerary._cache_metadata).toBeDefined();
  });

  it('assertion 9: total=0 일 때 cacheHitRate=0 (division by zero 안전)', () => {
    const itinerary: any = { _cache_metadata: { cached: 0, total: 0, output: 0 } };
    const debug = buildAdminDebug({ ...baseArgs, itinerary });
    expect(debug!.cacheHitRate).toBe(0);
  });
});
