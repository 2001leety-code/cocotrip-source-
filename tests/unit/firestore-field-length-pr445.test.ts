/**
 * PR #445 — Audit W-H19 regression slot.
 *
 * Pre-fix: firestore.rules allowed signed-in users to update
 * `tours/{tourId}` with `currentBookings` + `updatedAt` (PR #420
 * field allowlist) and to create `tours/{tourId}/bookings/{bookingId}`
 * with userId/status/amountUSD validation — but NONE of these checked
 * value RANGE or string length. Attackers could:
 *   - write `currentBookings: 999999999999` (type-valid integer, breaks
 *     capacity checks + UI displays + Firestore quota during aggregation)
 *   - write `currentBookings: -1` (counter underflow)
 *   - create a tours/bookings doc with amountUSD: 999999999 + giant memo
 *     fields up to Firestore's 1MB doc limit (storage + read-cost DoS)
 *
 * Post-fix: rules now constrain:
 *   - tours.currentBookings: int 0-9999
 *   - tours/bookings.amountUSD: <= 100000
 *   - tours/bookings.memo / note: string size() <= 1000 (if present)
 *
 * Validation is rule-text shape only (no live Firestore emulator) —
 * the audit guard is "don't regress these constraints".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

function toursBlock() {
  // Extract the `match /tours/{tourId} { ... }` block by brace counting.
  // The match-path includes `{tourId}` placeholder braces that must NOT be
  // counted — start counting from the body-opening `{` that follows the
  // placeholder.
  const startMarker = 'match /tours/{tourId}';
  const startIdx = rules.indexOf(startMarker);
  expect(startIdx).toBeGreaterThan(-1);
  // Skip past `match /tours/{tourId}` (including the `{tourId}` placeholder
  // braces) to find the body-opening `{`.
  const afterPlaceholder = startIdx + startMarker.length;
  const bodyOpen = rules.indexOf('{', afterPlaceholder);
  expect(bodyOpen).toBeGreaterThan(-1);
  let depth = 1;
  for (let i = bodyOpen + 1; i < rules.length; i++) {
    const ch = rules[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return rules.slice(startIdx, i + 1);
    }
  }
  throw new Error('tours block not terminated');
}

describe('PR #445 W-H19 — tours.currentBookings range cap', () => {
  const block = toursBlock();

  it('non-admin update requires currentBookings is int', () => {
    expect(block).toMatch(/request\.resource\.data\.currentBookings\s+is\s+int/);
  });

  it('non-admin update caps currentBookings >= 0 (no underflow)', () => {
    expect(block).toMatch(/request\.resource\.data\.currentBookings\s*>=\s*0/);
  });

  it('non-admin update caps currentBookings <= 9999 (no DoS)', () => {
    expect(block).toMatch(/request\.resource\.data\.currentBookings\s*<=\s*9999/);
  });

  it('still uses the PR #420 affectedKeys allowlist (no widening)', () => {
    expect(block).toMatch(/affectedKeys\(\)\s*\.\s*hasOnly\(\s*\[\s*['"]currentBookings['"]\s*,\s*['"]updatedAt['"]\s*\]\s*\)/);
  });
});

describe('PR #445 W-H19 — tours/bookings amountUSD + string length caps', () => {
  const block = toursBlock();

  it('create requires amountUSD <= 100000 (sanity cap)', () => {
    expect(block).toMatch(/request\.resource\.data\.amountUSD\s*<=\s*100000/);
  });

  it('memo length capped at 1000 chars when present', () => {
    expect(block).toMatch(/'memo'\s+in\s+request\.resource\.data[\s\S]{0,400}request\.resource\.data\.memo\.size\(\)\s*<=\s*1000/);
  });

  it('note length capped at 1000 chars when present', () => {
    expect(block).toMatch(/'note'\s+in\s+request\.resource\.data[\s\S]{0,400}request\.resource\.data\.note\.size\(\)\s*<=\s*1000/);
  });

  it('still preserves PR #420 ownership + status + amount>0 guards', () => {
    expect(block).toMatch(/request\.resource\.data\.userId\s*==\s*request\.auth\.uid/);
    expect(block).toMatch(/request\.resource\.data\.status\s*==\s*'pending'/);
    expect(block).toMatch(/request\.resource\.data\.amountUSD\s*>\s*0/);
  });
});
