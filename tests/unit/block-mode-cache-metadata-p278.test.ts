/**
 * P278 (2026-05-29): block_mode plan _cache_metadata persist sleeper bug fix 회귀 차단.
 *
 * Root cause: P266 chain (PR #665-#667) 가 legacy 경로의 _cache_metadata 만 fix.
 *   block_mode 경로 (handlerCore.js:295 tryRunBlockMode → blockMode.js 의 selectBlocksWithGemini
 *   / selectBlocksMultiCity) 가 Gemini 호출하지만 usageMetadata 추출 + itinerary._cache_metadata
 *   attach 안 함 → handlerCore:400 의 `itinerary?._cache_metadata` 가 null → P266 chain layer 2-5
 *   silent skip → Firestore plans 중 block_mode 46/100 = _cache_metadata 0%.
 *
 * Fix: blockMode.js 의 2 Gemini call site (selectBlocksWithGemini line ~197, selectBlocksMultiCity
 *   line ~810) 에서 cacheMetadata 추출 + return 에 포함. runBlockModePipeline / runBlockModeMultiCity
 *   가 itinerary._cache_metadata 에 attach.
 *
 * 회귀 시: block_mode plan 의 _cache_metadata 0% 회귀 → P266 chain 측정 coverage 50% (legacy 만).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P278 block_mode _cache_metadata persist (P266 chain layer 1 호환)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/blockMode.js');
  const src = readFileSync(srcPath, 'utf8');

  it('selectBlocksWithGemini — cacheMetadata 추출 + return 에 포함', () => {
    // result.response.usageMetadata 추출
    expect(src).toMatch(/result\?\.response\?\.usageMetadata/);
    // cachedContentTokenCount / promptTokenCount / candidatesTokenCount 추출
    expect(src).toContain('cachedContentTokenCount');
    expect(src).toContain('promptTokenCount');
    expect(src).toContain('candidatesTokenCount');
    // selectBlocksWithGemini return 에 cacheMetadata 포함 (2 spot — safe fallback + cleaned)
    const cacheMetadataReturns = src.match(/return\s+\{\s*day_selections[^}]*cacheMetadata\s*\}/g) || [];
    expect(cacheMetadataReturns.length).toBeGreaterThanOrEqual(3); // 2 spot in selectBlocksWithGemini + 1 spot in selectBlocksMultiCity
  });

  it('runBlockModePipeline — itinerary._cache_metadata attach (P266 chain layer 1)', () => {
    // selections.cacheMetadata 를 itinerary._cache_metadata 에 attach
    expect(src).toMatch(/itinerary\._cache_metadata\s*=\s*selections\.cacheMetadata/);
    // 두 spot — runBlockModePipeline + runBlockModeMultiCity
    const attachMatches = src.match(/itinerary\._cache_metadata\s*=\s*selections\.cacheMetadata/g) || [];
    expect(attachMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('P278 reference + sleeper bug 명시 (P266 chain 측정 누락)', () => {
    expect(src).toContain('P278');
    expect(src).toContain('sleeper bug');
    expect(src).toContain('P266 chain');
    // block_mode 46/100 분포 명시
    expect(src).toContain('46');
  });

  it('cacheMetadata 추출 기본값 (usageMetadata null 시 0)', () => {
    // usageMetadata 없을 때 { cached: 0, total: 0, output: 0 } 반환
    expect(src).toMatch(/if\s*\(!um\)\s*return\s+\{\s*cached:\s*0,\s*total:\s*0,\s*output:\s*0\s*\}/);
  });
});
