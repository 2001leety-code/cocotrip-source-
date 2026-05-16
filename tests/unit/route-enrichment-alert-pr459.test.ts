/**
 * PR #459 — Audit X-H5 regression slot.
 *
 * Pre-fix: api/_ai_core/routeEnrichment.js wrapped the RouteAgent
 * enrichment in a try/catch whose handler only did console.error.
 * If RouteAgent threw (Gemini quota / NAVER outage / coord parse
 * regression / TDZ ReferenceError), the AI plan was still returned
 * to the user but with NO transit_from_prev fields populated — the
 * user got an itinerary with 0 transit info. Operator only knew if
 * they tailed Vercel logs.
 *
 * Post-fix: keep the console.error (B-11's diagnostic line) and
 * additionally fire throttledTelegramAlert (P67) so the failure
 * surfaces to the admin channel. Dedup key includes the error type
 * AND the regions list so a single city-wide outage doesn't spam,
 * but distinct error types still alert independently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/routeEnrichment.js'),
  'utf8',
);

describe('PR #459 X-H5 — routeEnrichment imports throttle helper', () => {
  it('imports throttledTelegramAlert from telegram-throttle.js', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*throttledTelegramAlert[^}]*\}\s*from\s*['"]\.\.\/_shared\/telegram-throttle\.js['"]/,
    );
  });
});

describe('PR #459 X-H5 — catch block fires the alert', () => {
  it('catch handler still calls console.error (B-11 diagnostic preserved)', () => {
    expect(src).toMatch(/console\.error\(\s*'\[planner\] Route FAILED:'/);
  });

  it('catch handler also calls throttledTelegramAlert (no longer silent)', () => {
    const catchIdx = src.indexOf('catch (routeErr)');
    expect(catchIdx).toBeGreaterThan(-1);
    const block = src.slice(catchIdx, catchIdx + 2500);
    expect(block).toMatch(/throttledTelegramAlert\s*\(\s*\{/);
  });

  it('alert uses dedup key including errType + regions (storm protection)', () => {
    expect(src).toMatch(/key:\s*`route-enrich-fail:\$\{errType\}:\$\{regionsKey\}`/);
  });

  it('alert channel=admin + severity=high', () => {
    const catchIdx = src.indexOf('catch (routeErr)');
    const block = src.slice(catchIdx, catchIdx + 2500);
    expect(block).toMatch(/channel:\s*['"]admin['"]/);
    expect(block).toMatch(/severity:\s*['"]high['"]/);
  });

  it('alert message mentions transit-info-0 user impact (operator triage hint)', () => {
    const catchIdx = src.indexOf('catch (routeErr)');
    const block = src.slice(catchIdx, catchIdx + 2500);
    expect(block).toMatch(/transit info 0/);
    expect(block).toMatch(/NAVER_DEVELOPERS_/);
  });

  it('alert is fire-and-forget (caller does not await — preserves response latency)', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\s*\{[\s\S]*?\}\s*\)\.catch\(\(?\)?\s*=>\s*\{?\s*\}?\s*\)/);
  });
});

describe('PR #459 X-H5 — derived dedup inputs are defensive', () => {
  it('errType falls back to "Error" when err.name is missing', () => {
    expect(src).toMatch(/errType\s*=\s*routeErr\.name\s*\|\|\s*['"]Error['"]/);
  });

  it('regionsKey falls back to "unknown" when itinerary.regions is missing', () => {
    expect(src).toMatch(/regionsKey\s*=\s*Array\.isArray\(itinerary\?\.regions\)[\s\S]*?:\s*['"]unknown['"]/);
  });

  it('regionsKey is capped (slice(0,3)) so the dedup key stays small', () => {
    expect(src).toMatch(/itinerary\.regions\.slice\(0,\s*3\)/);
  });
});
