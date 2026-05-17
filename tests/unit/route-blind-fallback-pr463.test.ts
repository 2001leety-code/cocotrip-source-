/**
 * PR #463 — Audit X-H4 regression slot.
 *
 * Pre-fix: api/_ai_core/agents/RouteAgent.js produced a flat 25min /
 * 5km "blind fallback" transit_from_prev whenever both prev/curr
 * stops lacked coordinates AND Gemini hadn't pre-filled est_min.
 * It console.warn'd but did NOT mark the result with an explicit
 * flag, so routeEnrichment.js's summary log couldn't tell apart
 * "real 25min transit" from "we have no idea, defaulted to 25."
 * The user-visible symptom was every stop showing "car · 25분 ·
 * 5km" — clearly bogus to a human, invisible to operators.
 *
 * Post-fix:
 *  1. RouteAgent annotates the blind-fallback transit_from_prev
 *     with `source: 'blind_25_no_coords'` and `_blind_fallback: true`.
 *  2. routeEnrichment aggregates the per-plan blind ratio after
 *     RouteAgent returns. When >40% of transit-bearing stops are
 *     blind AND there are at least 5 such stops (filters arrival-
 *     day single-transit edge cases), an admin Telegram alert
 *     fires once per region per 5-min window. The alert lists the
 *     ratio, hotel_address (a frequent geocoding-failure cause),
 *     and a short triage guide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const enrichSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/routeEnrichment.js'),
  'utf8',
);
const agentSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);

describe('PR #463 X-H4 — RouteAgent annotates blind-fallback transits', () => {
  it('declares the isBlindFallback boolean from the 4-input fallback chain', () => {
    expect(agentSrc).toMatch(
      /const\s+isBlindFallback\s*=\s*\n?\s*!transit\.publicTransit\?\.duration\s*&&\s*\n?\s*!transit\.drivingMin\s*&&\s*\n?\s*!transit\.durationMin\s*&&\s*\n?\s*!geminiOriginal\.est_min/,
    );
  });

  it('naver_fallback branch toggles source/source flag based on isBlindFallback', () => {
    // The branch must now emit either 'naver_fallback' (Gemini estimate exists)
    // or 'blind_25_no_coords' (no signal at all).
    expect(agentSrc).toMatch(/source:\s*isBlindFallback\s*\?\s*['"]blind_25_no_coords['"]\s*:\s*['"]naver_fallback['"]/);
    expect(agentSrc).toMatch(/\.\.\.\(isBlindFallback\s*\?\s*\{\s*_blind_fallback:\s*true\s*\}\s*:\s*\{\s*\}\)/);
  });

  it('still console.warn\'s on blind fallback for legacy log readers', () => {
    expect(agentSrc).toMatch(/no coords \+ no Gemini est_min → using flat 25min fallback/);
  });
});

describe('PR #463 X-H4 — routeEnrichment aggregates + alerts', () => {
  it('counts blind_fallback stops in the summary log', () => {
    expect(enrichSrc).toMatch(/blindFallbackStops\s*=\s*allStops\.filter\(\(s\)\s*=>\s*s\.transit_from_prev\?\._blind_fallback\s*===\s*true\)\.length/);
    expect(enrichSrc).toMatch(/blind_fallback:\s*\$\{blindFallbackStops\}\/\$\{stopsWithTransit\}/);
  });

  it('declares the canonical thresholds (40% ratio, 5 transit minimum)', () => {
    expect(enrichSrc).toMatch(/const\s+BLIND_RATIO_THRESHOLD\s*=\s*0\.4/);
    expect(enrichSrc).toMatch(/const\s+MIN_TRANSITS_FOR_ALERT\s*=\s*5/);
  });

  it('guards the alert with both thresholds (NOT just ratio)', () => {
    // Find the guard block. The alert must require BOTH the minimum count
    // AND the ratio — a 4-transit day with 3 blind transits should NOT alert.
    expect(enrichSrc).toMatch(/if\s*\(\s*stopsWithTransit\s*>=\s*MIN_TRANSITS_FOR_ALERT\s*\)/);
    expect(enrichSrc).toMatch(/if\s*\(\s*blindRatio\s*>\s*BLIND_RATIO_THRESHOLD\s*\)/);
  });

  it('alerts on admin channel with severity high', () => {
    const block = enrichSrc.slice(enrichSrc.indexOf('route-blind-fallback'), enrichSrc.indexOf('route-blind-fallback') + 2000);
    expect(block).toMatch(/channel:\s*['"]admin['"]/);
    expect(block).toMatch(/severity:\s*['"]high['"]/);
  });

  it('dedup key includes regions (so seoul-day and busan-day surface separately)', () => {
    expect(enrichSrc).toMatch(/route-blind-fallback:\$\{regionsKey\}/);
    // regionsKey must derive from itinerary.regions (top-3 slice) with sensible fallbacks
    expect(enrichSrc).toMatch(/itinerary\.regions\.slice\(0,\s*3\)\.join\(['"]\+['"]\)/);
  });

  it('alert message mentions the % and includes hotel_address (frequent root cause)', () => {
    const block = enrichSrc.slice(enrichSrc.indexOf('route-blind-fallback'), enrichSrc.indexOf('route-blind-fallback') + 3000);
    expect(block).toMatch(/blindPct/);
    expect(block).toMatch(/hotel_address/);
  });

  it('alert is fire-and-forget (.catch swallow) — no enrichment latency impact', () => {
    expect(enrichSrc).toMatch(/throttledTelegramAlert\(\{[\s\S]*?route-blind-fallback[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });
});

describe('PR #463 X-H4 — synthetic ratio classification', () => {
  // Pure logic re-implementation that mirrors what the production guards
  // do. This locks in the exact threshold semantics so a future refactor
  // can't drift the ratio interpretation without flipping a test.
  function shouldAlert(blindCount: number, transitCount: number): boolean {
    const MIN = 5;
    const T = 0.4;
    if (transitCount < MIN) return false;
    return blindCount / transitCount > T;
  }

  it('5 transits / 2 blind (40% exact) → no alert (strictly >, not >=)', () => {
    expect(shouldAlert(2, 5)).toBe(false);
  });

  it('5 transits / 3 blind (60%) → alert', () => {
    expect(shouldAlert(3, 5)).toBe(true);
  });

  it('4 transits / 4 blind (100%, but below MIN=5) → NO alert (arrival-day edge case)', () => {
    expect(shouldAlert(4, 4)).toBe(false);
  });

  it('10 transits / 5 blind (50%) → alert', () => {
    expect(shouldAlert(5, 10)).toBe(true);
  });

  it('20 transits / 0 blind → no alert (happy path)', () => {
    expect(shouldAlert(0, 20)).toBe(false);
  });

  it('20 transits / 7 blind (35%) → no alert (below threshold)', () => {
    expect(shouldAlert(7, 20)).toBe(false);
  });
});
