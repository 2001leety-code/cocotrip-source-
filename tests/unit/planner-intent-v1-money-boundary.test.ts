/**
 * planner-intent-v1 (2026-08-24) — MONEY BOUNDARY regression proof.
 *
 * paymentGate.js / vehicleAndPrice.js price and gate a request using the
 * FLAT shaped fields (pax, durationDays, startDate) that requestShaper.js has
 * always computed — that logic is untouched by this work. plannerIntentV1.js
 * additionally builds a normalized `plannerIntent` object that block-mode /
 * persistence / Inngest now read. If a client could put a DIFFERENT value in
 * `planner_intent_v1.durationDays` (etc.) than the gate-approved flat field,
 * a downstream consumer trusting `plannerIntent` instead of the flat field
 * could silently build/store a different-scope plan than what was priced —
 * without ever touching the gate itself.
 *
 * So: startDate / durationDays / pax on `plannerIntent` must ALWAYS equal the
 * already-shaped flat value, even when the client sends a conflicting
 * explicit `planner_intent_v1` value for one of them.
 */
import { describe, it, expect } from 'vitest';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';

describe('planner-intent-v1 — money boundary (startDate/durationDays/pax)', () => {
  it('conflicting explicit v1 durationDays/startDate/pax never override the shaped flat values', () => {
    const body = {
      pax: 3,
      durationDays: 3,
      startDate: '2026-09-01',
      planner_intent_v1: {
        // a tampered/stale client asserting a bigger, more expensive trip
        pax: 20,
        durationDays: 14,
        startDate: '2026-09-10',
      },
    };
    const shaped = shapeRequest(body, 'test@example.com');
    expect(shaped.pax).toBe(3);
    expect(shaped.durationDays).toBe(3);
    expect(shaped.startDate).toBe('2026-09-01');
    expect(shaped.plannerIntent.pax).toBe(3);
    expect(shaped.plannerIntent.durationDays).toBe(3);
    expect(shaped.plannerIntent.startDate).toBe('2026-09-01');
  });

  it('legacy-only request (no planner_intent_v1) never throws and matches the pre-v1 clamp behavior', () => {
    expect(() => shapeRequest({ pax: 0 }, '')).not.toThrow();
    expect(shapeRequest({ pax: 0 }, '').pax).toBe(2);
    expect(shapeRequest({ pax: 999 }, '').pax).toBe(50);
    expect(shapeRequest({ pax: 999 }, '').plannerIntent.pax).toBe(50);
    const manyRegions = ['seoul', 'busan', 'jeju', 'daegu', 'gwangju', 'suwon', 'incheon'];
    const r = shapeRequest({ regions: manyRegions }, '');
    expect(r.regions.length).toBe(5);
    expect(r.plannerIntent.cityKeys.length).toBe(5);
  });

  it('explicit v1 still fails closed on a genuinely malformed field', () => {
    expect(() => shapeRequest({ planner_intent_v1: { pax: 'not-a-number' } }, '')).not.toThrow(); // pax is money-boundary — never strict
    expect(() => shapeRequest({ planner_intent_v1: { companions: 'not-a-real-option' } }, '')).toThrow(/INVALID_PLANNER_INTENT/);
  });
});
