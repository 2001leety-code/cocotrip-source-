/**
 * P268 (2026-05-29) — debugInfo.js#buildAdminDebug 의 itinerary._cache_metadata delete 제거.
 *
 * Root cause (P266 → P267 → P268 chain):
 *   - P267 fix 후 handler 가 cacheMetadata 추출 성공 (response _debug.totalInputTokens=33123 확인)
 *   - 근데 Inngest event payload ctx.cacheMetadata=null + itinerary._cache_metadata=undefined
 *   - 원인: handlerCore.js:343-347 의 streaming early response 시점에 buildAdminDebug 호출
 *           → debugInfo.js:42 의 delete itinerary._cache_metadata → pop
 *           → 이후 line 372 dispatchOrInlineForHandlerCore + line 394 savePlan 도달 시 undefined
 *           → P266 fix layer 1 (cacheMetadata: itinerary?._cache_metadata || null) silent skip
 *
 * P268 fix:
 *   - debugInfo.js:42 의 delete 제거
 *   - itinerary._cache_metadata 는 numeric only (cached/total/output) — PII 없음 → response 노출 안전
 *   - cacheMetadata 가 final layer (Inngest event + savePlan) 까지 살아있음 → P266 chain 완성
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const debugInfoSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/debugInfo.js'),
  'utf8',
);

import { buildAdminDebug } from '../../api/_ai_core/debugInfo.js';

describe('P268 — buildAdminDebug preserves itinerary._cache_metadata', () => {
  it('admin-bypass + cacheMetadata 있음: _debug 에 노출 + itinerary._cache_metadata 유지', () => {
    const itinerary: any = {
      tour_title: 'Test',
      days: [],
      _cache_metadata: { cached: 5000, total: 25000, output: 8000 },
    };
    const debug = buildAdminDebug({
      gate: { isAdminBypass: true },
      plannerMode: 'legacy',
      abDecision: { reason: 'test', bucket: null },
      identifierForBucketing: 'user-1',
      blockModeUsed: false,
      blocksUsed: [],
      useStreaming: true,
      itinerary,
    });

    expect(debug).toBeDefined();
    expect(debug!.cachedInputTokens).toBe(5000);
    expect(debug!.totalInputTokens).toBe(25000);
    expect(debug!.outputTokens).toBe(8000);
    expect(debug!.cacheHitRate).toBe(20);

    // P268 핵심: itinerary._cache_metadata 가 pop 되지 않고 유지됨
    expect(itinerary._cache_metadata).toBeDefined();
    expect(itinerary._cache_metadata.cached).toBe(5000);
    expect(itinerary._cache_metadata.total).toBe(25000);
  });

  it('non-admin-bypass: undefined 반환 + itinerary 변경 X', () => {
    const itinerary: any = {
      _cache_metadata: { cached: 1, total: 2, output: 3 },
    };
    const debug = buildAdminDebug({
      gate: { isAdminBypass: false },
      plannerMode: 'legacy',
      abDecision: { reason: 'test', bucket: 0 },
      identifierForBucketing: 'user-2',
      blockModeUsed: false,
      blocksUsed: [],
      useStreaming: false,
      itinerary,
    });
    expect(debug).toBeUndefined();
    // 일반 사용자: itinerary._cache_metadata 그대로 (변경 없음)
    expect(itinerary._cache_metadata).toEqual({ cached: 1, total: 2, output: 3 });
  });

  it('itinerary._cache_metadata 없음: cm fallback {0,0,0} + itinerary 변경 X', () => {
    const itinerary: any = { tour_title: 'No cache' };
    const debug = buildAdminDebug({
      gate: { isAdminBypass: true },
      plannerMode: 'legacy',
      abDecision: { reason: 'test', bucket: null },
      identifierForBucketing: 'user-3',
      blockModeUsed: false,
      blocksUsed: [],
      useStreaming: true,
      itinerary,
    });
    expect(debug!.cachedInputTokens).toBe(0);
    expect(debug!.totalInputTokens).toBe(0);
    expect(debug!.cacheHitRate).toBe(0);
    expect(itinerary._cache_metadata).toBeUndefined();
  });

  it('buildAdminDebug 2회 연속 호출: itinerary._cache_metadata 유지 (idempotent)', () => {
    const itinerary: any = {
      _cache_metadata: { cached: 1000, total: 10000, output: 2000 },
    };
    const args = {
      gate: { isAdminBypass: true },
      plannerMode: 'legacy',
      abDecision: { reason: 'test', bucket: null },
      identifierForBucketing: 'user-4',
      blockModeUsed: false,
      blocksUsed: [],
      useStreaming: true,
      itinerary,
    };
    const d1 = buildAdminDebug(args);
    const d2 = buildAdminDebug(args);

    expect(d1!.totalInputTokens).toBe(10000);
    expect(d2!.totalInputTokens).toBe(10000);
    // P268: 두 번째 호출도 cacheMetadata 정상 — delete 없음
    expect(itinerary._cache_metadata.total).toBe(10000);
  });
});

describe('P268 — source-level invariants (R-P268 lint)', () => {
  it('debugInfo.js: delete itinerary._cache_metadata 코드 제거', () => {
    expect(debugInfoSrc).not.toMatch(/delete\s+itinerary\._cache_metadata/);
  });

  it('debugInfo.js: itinerary._cache_metadata 읽기는 유지 (admin _debug 노출)', () => {
    expect(debugInfoSrc).toMatch(/itinerary\._cache_metadata/);
  });

  it('debugInfo.js: P268 lesson 주석 (chain 시점 issue 설명)', () => {
    expect(debugInfoSrc).toMatch(/P268/);
  });
});
