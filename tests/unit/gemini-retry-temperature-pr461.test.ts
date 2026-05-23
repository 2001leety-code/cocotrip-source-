/**
 * PR #461 — Audit X-H2 regression slot.
 *
 * Pre-fix: api/_ai_core/geminiPipeline.js created a single `model` at
 * temperature 0.5 and reused it for the initial call AND the 4 retry
 * sites (dietary-3pass / pattern-3pass / dietary-legacy / pattern-legacy).
 * Each retry had the same variance as the initial call, so a Gemini
 * pass that failed validation often produced the same kind of failure
 * on the retry — wasting an extra Gemini Pro call. Under load this
 * pushed us closer to the Gemini quota, and on a noisy day a single
 * user could burn 3 Gemini Pro calls (initial + dietary retry +
 * pattern retry) without producing a valid plan.
 *
 * Post-fix:
 *  1. `buildModel(apiKey, temperature?)` accepts an optional temperature
 *     override so the same factory can produce both models.
 *  2. `runGeminiPipeline` builds an additional `retryModel` at
 *     temperature 0.1. Combined with the reinforced prompts that
 *     already exist (dietary / pattern), the retry is deterministic
 *     enough that the first retry usually fixes the violation — fewer
 *     2nd retries fired, fewer quota burns per user.
 *  3. `recordRetryAttempt(retryType)` keeps a per-instance sliding
 *     5-minute window. If any retry type fires more than 10 times in
 *     the window, an admin Telegram alert is sent once per window so
 *     the operator can investigate a prompt regression or upstream
 *     outage before quota is exhausted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/geminiPipeline.js'),
  'utf8',
);

// Capture throttledTelegramAlert invocations before importing the SUT
// so recordRetryAttempt's alert path is observable.
const alertCalls: any[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: any) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

// Capture GoogleGenerativeAI.getGenerativeModel calls so we can assert
// the temperature passed for each model build. Mock must be a class
// constructor — the SUT calls `new GoogleGenerativeAI(apiKey)`.
const { genModelCalls } = vi.hoisted(() => ({ genModelCalls: [] as any[] }));
vi.mock('@google/generative-ai', () => {
  class MockGenAI {
    constructor(_apiKey: string) { /* noop */ }
    getGenerativeModel(opts: any) {
      genModelCalls.push(opts);
      return { generateContent: async () => ({ response: { text: () => '{}' } }) };
    }
  }
  return { GoogleGenerativeAI: MockGenAI };
});

import {
  buildModel,
  recordRetryAttempt,
  __resetRetryWindowForTests,
} from '../../api/_ai_core/geminiPipeline.js';

describe('PR #461 X-H2 — buildModel accepts temperature override', () => {
  beforeEach(() => {
    genModelCalls.length = 0;
  });

  it('default call uses temperature 0.5 (preserves pre-PR default)', () => {
    buildModel('fake-key');
    expect(genModelCalls.length).toBe(1);
    expect(genModelCalls[0].generationConfig.temperature).toBe(0.5);
  });

  it('override 0.1 produces a deterministic retry model', () => {
    buildModel('fake-key', 0.1);
    expect(genModelCalls.length).toBe(1);
    expect(genModelCalls[0].generationConfig.temperature).toBe(0.1);
  });

  it('override 0 (boundary) is honored (NOT coerced to default)', () => {
    buildModel('fake-key', 0);
    expect(genModelCalls.length).toBe(1);
    expect(genModelCalls[0].generationConfig.temperature).toBe(0);
  });

  it('non-number override falls back to default 0.5', () => {
    buildModel('fake-key', 'high' as unknown as number);
    expect(genModelCalls.length).toBe(1);
    expect(genModelCalls[0].generationConfig.temperature).toBe(0.5);
  });

  it('still configures thinkingBudget/maxOutputTokens/responseMimeType', () => {
    buildModel('fake-key', 0.1);
    const cfg = genModelCalls[0].generationConfig;
    expect(cfg.thinkingConfig.thinkingBudget).toBe(32000);
    // P164 (2026-05-23): 32000 → 12000. 실측 plan JSON 2-5K 토큰 — 12K = 2x safety.
    // 32K 할당은 generation overhead. -15~25% Gemini gen time.
    expect(cfg.maxOutputTokens).toBe(12000);
    expect(cfg.responseMimeType).toBe('application/json');
  });
});

describe('PR #461 X-H2 — recordRetryAttempt sliding-window alert', () => {
  beforeEach(() => {
    alertCalls.length = 0;
    __resetRetryWindowForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('first retry: countInWindow=1, no alert', () => {
    const r = recordRetryAttempt('dietary-3pass');
    expect(r.countInWindow).toBe(1);
    expect(r.alerted).toBe(false);
    expect(alertCalls.length).toBe(0);
  });

  it('threshold not exceeded: 10 retries → no alert', () => {
    for (let i = 0; i < 10; i++) recordRetryAttempt('dietary-3pass');
    expect(alertCalls.length).toBe(0);
  });

  it('threshold exceeded: 11th retry within 5min → fires 1 alert', () => {
    for (let i = 0; i < 10; i++) recordRetryAttempt('dietary-3pass');
    const r = recordRetryAttempt('dietary-3pass');
    expect(r.countInWindow).toBe(11);
    expect(r.alerted).toBe(true);
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('gemini-retry-rate-high:dietary-3pass');
    expect(alertCalls[0].channel).toBe('admin');
    expect(alertCalls[0].severity).toBe('high');
    expect(alertCalls[0].message).toMatch(/Gemini retry storm/);
  });

  it('different retry types alert independently', () => {
    for (let i = 0; i < 11; i++) recordRetryAttempt('dietary-3pass');
    for (let i = 0; i < 11; i++) recordRetryAttempt('pattern-legacy');
    expect(alertCalls.length).toBe(2);
    expect(alertCalls.map((a) => a.key).sort()).toEqual([
      'gemini-retry-rate-high:dietary-3pass',
      'gemini-retry-rate-high:pattern-legacy',
    ]);
  });

  it('alert is dedup\'d within the same window (12th, 13th retry → still 1 alert)', () => {
    for (let i = 0; i < 13; i++) recordRetryAttempt('dietary-3pass');
    expect(alertCalls.length).toBe(1);
  });

  it('after window expires: counter resets, fresh threshold required', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
    for (let i = 0; i < 11; i++) recordRetryAttempt('pattern-3pass');
    expect(alertCalls.length).toBe(1);
    // Advance > 5 min: stale entries pruned. Counter should restart.
    vi.setSystemTime(new Date('2026-05-16T00:06:00Z'));
    const r = recordRetryAttempt('pattern-3pass');
    expect(r.countInWindow).toBe(1);
    // Alert window also rolls — 11 more retries can re-fire.
    for (let i = 0; i < 10; i++) recordRetryAttempt('pattern-3pass');
    expect(alertCalls.length).toBe(2);
  });
});

describe('PR #461 X-H2 — source-level invariants (retry sites use retryModel)', () => {
  it('declares the retry constants near buildModel', () => {
    expect(src).toMatch(/const\s+RETRY_TEMPERATURE\s*=\s*0\.1/);
    expect(src).toMatch(/const\s+RETRY_RATE_WINDOW_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
    expect(src).toMatch(/const\s+RETRY_RATE_THRESHOLD\s*=\s*10/);
  });

  it('runGeminiPipeline builds BOTH model and retryModel', () => {
    expect(src).toMatch(/const\s+model\s*=\s*buildModel\(apiKey\)\s*;/);
    expect(src).toMatch(/const\s+retryModel\s*=\s*buildModel\(apiKey,\s*RETRY_TEMPERATURE\)\s*;/);
  });

  it('all 4 retry sites call recordRetryAttempt with the canonical type names', () => {
    expect(src).toMatch(/recordRetryAttempt\(\s*['"]dietary-3pass['"]\s*\)/);
    expect(src).toMatch(/recordRetryAttempt\(\s*['"]pattern-3pass['"]\s*\)/);
    expect(src).toMatch(/recordRetryAttempt\(\s*['"]dietary-legacy['"]\s*\)/);
    expect(src).toMatch(/recordRetryAttempt\(\s*['"]pattern-legacy['"]\s*\)/);
  });

  it('3pass retry sites use pass1Intent(retryModel, ...) (NOT model)', () => {
    // 3pass dietary retry
    expect(src).toMatch(/pass1Intent\(\s*retryModel\s*,\s*reinforced\s*,\s*userMessage\)[\s\S]*?'pass1-retry'/);
    // 3pass pattern retry
    expect(src).toMatch(/pass1Intent\(\s*retryModel\s*,\s*reinforced\s*,\s*userMessage\)[\s\S]*?'pass1-retry-pattern'/);
  });

  it('legacy retry sites use retryModel.generateContent (NOT model.generateContent)', () => {
    // Count legacy-retry timeout labels — should match 2 retry sites
    const legacyRetryLabels = src.match(/'legacy-retry(?:-pattern)?'/g) || [];
    expect(legacyRetryLabels.length).toBe(2);
    // Each legacy retry block uses retryModel.generateContent
    const dietaryLegacyBlock = src.slice(
      src.indexOf('dietary-legacy'),
      src.indexOf("'legacy-retry'") + 200,
    );
    expect(dietaryLegacyBlock).toMatch(/retryModel\.generateContent/);
    const patternLegacyBlock = src.slice(
      src.indexOf('pattern-legacy'),
      src.indexOf("'legacy-retry-pattern'") + 200,
    );
    expect(patternLegacyBlock).toMatch(/retryModel\.generateContent/);
  });

  it('alert dedup key matches `gemini-retry-rate-high:${retryType}`', () => {
    expect(src).toMatch(/gemini-retry-rate-high:\$\{retryType\}/);
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
    expect(src).toMatch(/severity:\s*['"]high['"]/);
  });

  it('alert call is fire-and-forget (.catch swallow) — no pipeline latency impact', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\{[\s\S]*?gemini-retry-rate-high[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });
});
