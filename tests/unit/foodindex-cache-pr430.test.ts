/**
 * PR #430 — Audit X-C4 regression slot.
 *
 * Pre-fix: api/_ai_core/geminiPipeline.js had loadFoodIndex() that did
 * `fs.readFileSync` + `JSON.parse` on the 1.27 MB _food_index.json file
 * on every single AI-planner invocation. With p50 ~50-150ms of pure
 * blocking IO/CPU on the hot path AND thundering-herd cost on cold
 * start, the planner endpoint paid a needless tax. The function's own
 * comment claimed to "avoid reading twice per request" but never
 * actually cached.
 *
 * Post-fix: module-scope cache with in-flight promise. The 1.27 MB
 * parse happens once per warm Vercel instance, all subsequent calls
 * return the cached value. Concurrent cold-start callers share a
 * single load.
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('PR #430 X-C4 — loadFoodIndex caches the 1.27 MB JSON', () => {
  beforeEach(async () => {
    const mod = await import('../../api/_ai_core/geminiPipeline.js');
    (mod as unknown as { __resetFoodIndexCacheForTests: () => void })
      .__resetFoodIndexCacheForTests();
  });

  it('exports a test-reset hook so the cache can be cleared between scenarios', async () => {
    const mod = await import('../../api/_ai_core/geminiPipeline.js');
    expect(typeof (mod as unknown as { __resetFoodIndexCacheForTests?: unknown })
      .__resetFoodIndexCacheForTests).toBe('function');
  });

  it('returns the same reference on subsequent calls (identity == cache hit)', async () => {
    // ESM doesn't let us spy on `fs.readFileSync`, but identity equality
    // is the cleaner proof anyway: a fresh `JSON.parse` would produce a
    // new object each time. If `result1 === result2` then we know we
    // didn't re-parse.
    const mod = await import('../../api/_ai_core/geminiPipeline.js');
    const result1 = await mod.loadFoodIndex();
    const result2 = await mod.loadFoodIndex();
    expect(Array.isArray(result1) || (typeof result1 === 'object' && result1 !== null)).toBe(true);
    expect(result1).toBe(result2); // identity-equal — same reference
  });

  it('concurrent cold-start callers share the in-flight promise (no torn cache)', async () => {
    const mod = await import('../../api/_ai_core/geminiPipeline.js');
    // Fresh cache (beforeEach) → three simultaneous calls hit the loading
    // path. They MUST all resolve to the same reference; if the cache
    // were torn (two parses → two objects → cache last-write-wins) the
    // first two callers would get different references from the third.
    const [a, b, c] = await Promise.all([
      mod.loadFoodIndex(),
      mod.loadFoodIndex(),
      mod.loadFoodIndex(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('PR #430 X-C4 — source-level guarantees', () => {
  it('the cache variables are declared at module scope', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(process.cwd(), 'api/_ai_core/geminiPipeline.js'),
      'utf8',
    );
    expect(src).toMatch(/let\s+_foodIndexCache\s*=\s*null/);
    expect(src).toMatch(/let\s+_foodIndexLoading\s*=\s*null/);
  });

  it('the cached-value early return is present', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(process.cwd(), 'api/_ai_core/geminiPipeline.js'),
      'utf8',
    );
    expect(src).toMatch(/if\s*\(\s*_foodIndexCache\s*!==\s*null\s*\)\s*return\s+_foodIndexCache/);
  });
});
