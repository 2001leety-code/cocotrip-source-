/**
 * P267 (2026-05-29) — runGeminiStreaming chunk-level usageMetadata fallback.
 *
 * Root cause (P266 진단):
 *   - prod plan faab8777 (legacy 1-pass 다도시) 의 Inngest event payload 의
 *     itinerary._cache_metadata = undefined → buildPlanAiCompletePayload 의
 *     null spread → ctx.cacheMetadata 미포함 → P266 fix chain layer 3/4/5 silent skip.
 *   - Vercel logs 의 [P195 CACHE_METRICS] log 0건 → logCacheMetrics total=0 skip.
 *   - 즉 extractCacheMetadata(finalResponse) = {0,0,0} = finalResponse.usageMetadata=null.
 *   - 외부 사례: Google AI Forum #79312 — 2.5-pro-preview streaming final chunk usageMetadata=null bug.
 *
 * P267 fix:
 *   1. chunk loop 안에서 chunk.usageMetadata not null 이면 lastChunkUsageMetadata 저장
 *   2. final response usageMetadata=null/0 이면 lastChunkUsageMetadata fallback
 *   3. catch (final await throw) 도 chunk-level fallback
 *
 * 회귀 차단:
 *   - 정상 final response (usageMetadata 있음) = 기존 동작 (cacheMetadata = final 값)
 *   - final null + chunk 있음 = chunk fallback
 *   - final null + chunk null = {0,0,0} (legacy 동작)
 *   - final throw + chunk 있음 = chunk fallback
 *   - final throw + chunk null = {0,0,0} + warning log
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/geminiPipeline.js'),
  'utf8',
);

import { runGeminiStreaming, extractCacheMetadata } from '../../api/_ai_core/geminiPipeline.js';

/** Mock Gemini model with controllable stream chunks + final response */
function makeMockModel({ chunks, finalResponse, finalThrow }: any) {
  return {
    generateContentStream: vi.fn(async () => ({
      stream: (async function* () {
        for (const c of chunks) yield c;
      })(),
      response: finalThrow ? Promise.reject(finalThrow) : Promise.resolve(finalResponse),
    })),
  };
}

const baseArgs = { model: null as any, systemPrompt: 'sys', userMessage: 'usr', language: 'ko' };

describe('P267 — runGeminiStreaming chunk-level usageMetadata fallback', () => {
  it('happy path: final response usageMetadata 있음 → final 값 사용', async () => {
    const model = makeMockModel({
      chunks: [
        { candidates: [{ content: { parts: [{ text: '{"days":' }] } }] },
        { candidates: [{ content: { parts: [{ text: '[]}' }] } }] },
      ],
      finalResponse: { usageMetadata: { cachedContentTokenCount: 5000, promptTokenCount: 20000, candidatesTokenCount: 3000 } },
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata.cached).toBe(5000);
    expect(result.cacheMetadata.total).toBe(20000);
    expect(result.cacheMetadata.output).toBe(3000);
  });

  it('Pro streaming bug: final usageMetadata=null + chunk usageMetadata 있음 → chunk fallback', async () => {
    const model = makeMockModel({
      chunks: [
        { candidates: [{ content: { parts: [{ text: '{"days":' }] } }] },
        { candidates: [{ content: { parts: [{ text: '[]}' }] } }], usageMetadata: { cachedContentTokenCount: 8000, promptTokenCount: 25000, candidatesTokenCount: 4000 } },
      ],
      finalResponse: { usageMetadata: null },  // Pro streaming bug
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata.cached).toBe(8000);
    expect(result.cacheMetadata.total).toBe(25000);
    expect(result.cacheMetadata.output).toBe(4000);
  });

  it('Pro streaming bug: final usageMetadata={} (empty) → chunk fallback', async () => {
    const model = makeMockModel({
      chunks: [
        { usageMetadata: { cachedContentTokenCount: 100, promptTokenCount: 5000, candidatesTokenCount: 2000 } },
        { candidates: [{ content: { parts: [{ text: '{"days":[]}' }] } }] },
      ],
      finalResponse: { usageMetadata: {} },  // total=0
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata.total).toBe(5000);  // chunk fallback
  });

  it('final usageMetadata 있고 chunk 도 있음 → final 우선 (back-compat)', async () => {
    const model = makeMockModel({
      chunks: [
        { usageMetadata: { cachedContentTokenCount: 1, promptTokenCount: 1, candidatesTokenCount: 1 } },
        { candidates: [{ content: { parts: [{ text: '{"days":[]}' }] } }] },
      ],
      finalResponse: { usageMetadata: { cachedContentTokenCount: 9000, promptTokenCount: 30000, candidatesTokenCount: 5000 } },
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata.total).toBe(30000);  // final 우선
  });

  it('final await throw + chunk usageMetadata 있음 → chunk fallback (catch)', async () => {
    const model = makeMockModel({
      chunks: [
        { usageMetadata: { cachedContentTokenCount: 200, promptTokenCount: 8000, candidatesTokenCount: 1500 } },
        { candidates: [{ content: { parts: [{ text: '{"days":[]}' }] } }] },
      ],
      finalThrow: new Error('response timeout'),
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata.cached).toBe(200);
    expect(result.cacheMetadata.total).toBe(8000);
    expect(result.cacheMetadata.output).toBe(1500);
  });

  it('final null + chunk null = {0,0,0} (legacy 동작 유지)', async () => {
    const model = makeMockModel({
      chunks: [
        { candidates: [{ content: { parts: [{ text: '{"days":[]}' }] } }] },
      ],
      finalResponse: { usageMetadata: null },
    });
    const result = await runGeminiStreaming({ ...baseArgs, model });
    expect(result.cacheMetadata).toEqual({ cached: 0, total: 0, output: 0 });
  });
});

describe('P267 — source-level invariants (R-P267 lint)', () => {
  it('lastChunkUsageMetadata 변수 정의', () => {
    expect(src).toMatch(/let\s+lastChunkUsageMetadata\s*=\s*null/);
  });

  it('chunk loop 안 usageMetadata 저장 코드 존재', () => {
    expect(src).toMatch(/if\s*\(chunk\?\.usageMetadata\)\s*lastChunkUsageMetadata\s*=\s*chunk\.usageMetadata/);
  });

  it('final usageMetadata=null/0 시 chunk fallback 분기 존재', () => {
    expect(src).toMatch(/cacheMetadata\.total\s*===\s*0\s*&&\s*lastChunkUsageMetadata/);
  });

  it('catch 분기에서도 chunk-level fallback (final throw 우회)', () => {
    expect(src).toMatch(/console\.warn\([^)]*streaming cache metadata extract failed[\s\S]*?if\s*\(lastChunkUsageMetadata\)/);
  });

  it('source label 분기 (streaming-final / streaming-chunk-fallback)', () => {
    expect(src).toMatch(/source\s*=\s*['"]chunk-fallback['"]/);
    expect(src).toMatch(/logCacheMetrics\(`streaming-\$\{source\}`/);
  });
});
