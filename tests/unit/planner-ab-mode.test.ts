/**
 * Coverage for api/_ai_core/plannerMode.js — Phase 4 3-pass A/B test mode decider.
 *
 * Verifies:
 *   1. Hash determinism — same identifier always lands in the same mode (100x).
 *   2. PCT=0 → all identifiers map to 'legacy'.
 *   3. PCT=100 → all identifiers map to '3pass'.
 *   4. PCT=10 → empirical distribution lands in [8, 12]% across 10k identifiers.
 *   5. PLANNER_MODE='3pass' env override → ignores PCT, returns 3pass for all.
 *   6. Identifier source priority — uid > guestEmail > sessionId.
 *   7. parsePct edge cases (empty, NaN, > 100, negative, float).
 *   8. SAFETY-CRITICAL guard — decision NEVER throws (always returns mode).
 */
import { describe, it, expect } from 'vitest';
import {
  decidePlannerMode,
  parsePct,
  pickIdentifier,
  bucketFor,
  normalizeMode,
} from '../../api/_ai_core/plannerMode.js';

describe('parsePct — sanitization', () => {
  it.each([
    ['', 0],
    [undefined, 0],
    [null as any, 0],
    ['0', 0],
    ['1', 1],
    ['10', 10],
    ['100', 100],
    ['101', 100],   // clamp upper
    ['-1', 0],      // clamp lower
    ['  25  ', 25], // trim
    ['abc', 0],     // NaN → 0
    ['10.7', 10],   // float → floor via parseInt (drops decimal)
    ['10x', 10],    // parseInt grabs leading digits
  ])('parsePct(%j) === %i', (input, expected) => {
    expect(parsePct(input)).toBe(expected);
  });
});

describe('pickIdentifier — uid > guestEmail > sessionId precedence', () => {
  it('uid wins when all three present', () => {
    expect(pickIdentifier({ uid: 'UID-1', guestEmail: 'a@b.com', sessionId: 'sess-9' }))
      .toBe('uid-1');
  });

  it('falls back to guestEmail when uid missing', () => {
    expect(pickIdentifier({ uid: null, guestEmail: 'A@B.com', sessionId: 'sess-9' }))
      .toBe('a@b.com');
  });

  it('falls back to sessionId when uid + guestEmail both missing', () => {
    expect(pickIdentifier({ uid: '', guestEmail: '', sessionId: 'Sess-99' }))
      .toBe('sess-99');
  });

  it('returns null when nothing usable', () => {
    expect(pickIdentifier({})).toBeNull();
    expect(pickIdentifier({ uid: '   ', guestEmail: '', sessionId: undefined as any }))
      .toBeNull();
  });

  it('normalizes whitespace and case', () => {
    expect(pickIdentifier({ uid: '  HelloWorld  ' })).toBe('helloworld');
  });
});

describe('bucketFor — deterministic + uniform hash bucketing', () => {
  it('same identifier → same bucket 100x in a row', () => {
    const id = '2001leety@gmail.com';
    const first = bucketFor(id);
    for (let i = 0; i < 100; i++) {
      expect(bucketFor(id)).toBe(first);
    }
  });

  it('bucket always in [0, 99]', () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketFor(`user-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(99);
    }
  });

  it('different identifiers produce reasonably distinct buckets', () => {
    // Trivial collision check — 200 distinct identifiers shouldn't all land
    // on the same bucket. Even with 100 buckets and 200 samples, expect
    // > 50 unique buckets (sanity, not statistical strictness).
    const buckets = new Set<number>();
    for (let i = 0; i < 200; i++) buckets.add(bucketFor(`user-${i}@test.com`));
    expect(buckets.size).toBeGreaterThan(50);
  });
});

describe('decidePlannerMode — env precedence + bucketing', () => {
  it('PCT=0 + no env override → ALL identifiers map to legacy', () => {
    for (let i = 0; i < 50; i++) {
      const d = decidePlannerMode({
        uid: `user-${i}`,
        env: { PLANNER_AB_3PASS_PCT: '0' },
      });
      expect(d.mode).toBe('legacy');
      expect(d.reason).toBe('ab-disabled');
    }
  });

  it('PCT unset + no env override → legacy (default safe)', () => {
    const d = decidePlannerMode({ uid: 'anyone', env: {} });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('ab-disabled');
  });

  it('PCT=100 → ALL identifiers map to 3pass', () => {
    for (let i = 0; i < 50; i++) {
      const d = decidePlannerMode({
        uid: `user-${i}`,
        env: { PLANNER_AB_3PASS_PCT: '100' },
      });
      expect(d.mode).toBe('3pass');
      expect(d.reason).toBe('pct-bucketing');
      expect(d.bucket).toBeGreaterThanOrEqual(0);
      expect(d.bucket).toBeLessThan(100);
    }
  });

  it('PCT=10 → empirical distribution in [8, 12]% across 10k identifiers', () => {
    let threePass = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const d = decidePlannerMode({
        uid: `synthetic-user-${i}@cocotripkr.com`,
        env: { PLANNER_AB_3PASS_PCT: '10' },
      });
      if (d.mode === '3pass') threePass++;
    }
    const pct = (threePass / N) * 100;
    // Hash is uniform → 10% target. Allow ±2% slack for sampling variance.
    expect(pct).toBeGreaterThanOrEqual(8);
    expect(pct).toBeLessThanOrEqual(12);
  });

  it('PLANNER_MODE=3pass env override → forces 3pass regardless of PCT', () => {
    for (let i = 0; i < 20; i++) {
      const d = decidePlannerMode({
        uid: `user-${i}`,
        env: { PLANNER_MODE: '3pass', PLANNER_AB_3PASS_PCT: '0' },
      });
      expect(d.mode).toBe('3pass');
      expect(d.reason).toBe('env-override-3pass');
      expect(d.bucket).toBeNull();
    }
  });

  it('PLANNER_MODE=legacy + PCT=50 → bucketing still active (not forced legacy)', () => {
    // 'legacy' is not a force-override — PCT-based bucketing still runs.
    // Only '3pass' env value is the hard override.
    let threePass = 0;
    for (let i = 0; i < 1000; i++) {
      const d = decidePlannerMode({
        uid: `user-${i}`,
        env: { PLANNER_MODE: 'legacy', PLANNER_AB_3PASS_PCT: '50' },
      });
      if (d.mode === '3pass') threePass++;
    }
    // ~50% expected
    const pct = (threePass / 1000) * 100;
    expect(pct).toBeGreaterThanOrEqual(45);
    expect(pct).toBeLessThanOrEqual(55);
  });

  it('determinism — same uid returns same mode 100x with PCT=10', () => {
    const uid = 'consistent-user@test.com';
    const first = decidePlannerMode({
      uid,
      env: { PLANNER_AB_3PASS_PCT: '10' },
    });
    for (let i = 0; i < 100; i++) {
      const d = decidePlannerMode({
        uid,
        env: { PLANNER_AB_3PASS_PCT: '10' },
      });
      expect(d.mode).toBe(first.mode);
      expect(d.bucket).toBe(first.bucket);
    }
  });

  it('uid / guestEmail / sessionId all viable hash inputs', () => {
    // With only one of the three, decision still resolves to a valid mode.
    const dUid = decidePlannerMode({
      uid: 'only-uid',
      env: { PLANNER_AB_3PASS_PCT: '50' },
    });
    expect(['legacy', '3pass']).toContain(dUid.mode);
    expect(dUid.reason).toBe('pct-bucketing');

    const dEmail = decidePlannerMode({
      guestEmail: 'only-email@test.com',
      env: { PLANNER_AB_3PASS_PCT: '50' },
    });
    expect(['legacy', '3pass']).toContain(dEmail.mode);
    expect(dEmail.reason).toBe('pct-bucketing');

    const dSess = decidePlannerMode({
      sessionId: 'only-session',
      env: { PLANNER_AB_3PASS_PCT: '50' },
    });
    expect(['legacy', '3pass']).toContain(dSess.mode);
    expect(dSess.reason).toBe('pct-bucketing');
  });

  it('PCT > 0 with no identifier → legacy fallback (safety net)', () => {
    const d = decidePlannerMode({
      env: { PLANNER_AB_3PASS_PCT: '100' },
    });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('no-identifier-fallback');
    expect(d.bucket).toBeNull();
  });

  it('never throws — even on malformed env or input', () => {
    expect(() => decidePlannerMode({})).not.toThrow();
    expect(() => decidePlannerMode({
      env: { PLANNER_AB_3PASS_PCT: 'garbage', PLANNER_MODE: 'unknown' },
    })).not.toThrow();
    expect(() => decidePlannerMode({
      uid: undefined as any,
      guestEmail: 42 as any,
      sessionId: null as any,
    })).not.toThrow();
  });
});

// P102 (2026-05-20): admin Test Mode (ADMIN-BYPASS-*) must always run on the
// legacy pipeline. 3-pass executes Pass1 (gemini) + Pass2 (DB) + Pass3 (gemini
// enrich) = 90-150s + retry → easily exceeds 5min Vercel cap → client sees
// "AI 플랜 생성이 5분 이상 걸려 중단" timeout. Test Mode is meant for fast
// happy-path verification, not A/B exposure. Customer flow (isAdminBypass=false)
// unaffected.
describe('P102 — isAdminBypass forces legacy (regardless of env/PCT)', () => {
  it('isAdminBypass=true overrides PLANNER_MODE=3pass env override', () => {
    const d = decidePlannerMode({
      uid: '2001leety@gmail.com',
      isAdminBypass: true,
      env: { PLANNER_MODE: '3pass' },
    });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('admin-bypass-force-legacy');
    expect(d.bucket).toBeNull();
  });

  it('isAdminBypass=true overrides PCT=100 bucketing', () => {
    const d = decidePlannerMode({
      uid: '2001leety@gmail.com',
      isAdminBypass: true,
      env: { PLANNER_AB_3PASS_PCT: '100' },
    });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('admin-bypass-force-legacy');
  });

  it('isAdminBypass=true survives Vercel BOM/CRLF env corruption', () => {
    // Replicates real prod incident: vercel env pull surfaced PLANNER_MODE as
    // "﻿3pass\r\n" — BOM + literal CRLF. JS .trim() strips both (per ES
    // WhiteSpace spec) → '3pass' → forces 3pass for everyone. Admin Test Mode
    // must remain immune to this latent prod-env hazard.
    const d = decidePlannerMode({
      uid: '2001leety@gmail.com',
      isAdminBypass: true,
      env: { PLANNER_MODE: '﻿3pass\r\n' },
    });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('admin-bypass-force-legacy');
  });

  it('isAdminBypass=false → normal A/B logic still applies (no regression)', () => {
    // Customer flow unaffected — PLANNER_MODE=3pass env still forces 3pass.
    const d = decidePlannerMode({
      uid: 'customer-uid',
      isAdminBypass: false,
      env: { PLANNER_MODE: '3pass' },
    });
    expect(d.mode).toBe('3pass');
    expect(d.reason).toBe('env-override-3pass');
  });

  it('isAdminBypass omitted (undefined) → normal A/B logic applies', () => {
    // Backward-compat: callers not yet passing isAdminBypass keep prior behavior.
    const d = decidePlannerMode({
      uid: 'customer-uid',
      env: { PLANNER_MODE: '3pass' },
    });
    expect(d.mode).toBe('3pass');
    expect(d.reason).toBe('env-override-3pass');
  });

  it('isAdminBypass=true with no identifier → still legacy (defense in depth)', () => {
    // Admin Test Mode without uid/email should not throw or fall through to
    // pct-bucketing fallback — admin-bypass-force-legacy is precedence 0.
    const d = decidePlannerMode({
      isAdminBypass: true,
      env: { PLANNER_AB_3PASS_PCT: '50' },
    });
    expect(d.mode).toBe('legacy');
    expect(d.reason).toBe('admin-bypass-force-legacy');
  });
});

describe('normalizeMode — only canonical values pass', () => {
  it.each([
    ['legacy', 'legacy'],
    ['3pass', '3pass'],
    ['LEGACY', 'legacy'],
    ['  3pass  ', '3pass'],
    ['unknown', 'legacy'],   // unrecognized → safe default
    ['', 'legacy'],
    [undefined as any, 'legacy'],
    [null as any, 'legacy'],
  ])('normalizeMode(%j) === %j', (input, expected) => {
    expect(normalizeMode(input)).toBe(expected);
  });
});
