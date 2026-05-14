/**
 * PR #420 — Audit WC7 / WC8 / WC9 + H20 regression slot.
 *
 * Static analysis of firestore.rules — asserts the hardening predicates
 * remain in place. Full emulator-based behavior tests live in
 * `scripts/test-firestore-rules-hardening.mjs` (live Firestore, run
 * manually).
 *
 * If a future refactor deletes one of these guards, this slot fires
 * before the change reaches main.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const rules = readFileSync(RULES_PATH, 'utf8');

/**
 * Extract the body between `match /<collection>/{...}` and its closing
 * brace. Naive brace counter — fine for our rules file which has clean
 * single-level nesting per top-level match.
 */
function blockFor(matchSpec: string): string {
  const startMarker = `match ${matchSpec}`;
  const startIdx = rules.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`match block not found: ${matchSpec}`);
  // Find the body-opening `{` AFTER the matchSpec — the spec itself contains
  // braces like `{tourId}` so we must skip past the whole spec first.
  const braceIdx = rules.indexOf('{', startIdx + startMarker.length);
  let depth = 1;
  let i = braceIdx + 1;
  while (i < rules.length && depth > 0) {
    if (rules[i] === '{') depth++;
    else if (rules[i] === '}') depth--;
    i++;
  }
  return rules.slice(braceIdx, i);
}

describe('PR #420 — firestore.rules hardening regression slot', () => {
  describe('WC7 — tours update field allowlist', () => {
    const block = blockFor('/tours/{tourId}');

    it('non-admin update is restricted to currentBookings/updatedAt', () => {
      // Strip the nested /bookings/{bookingId} sub-match so we only inspect
      // the parent tours allow rules.
      const parent = block.slice(0, block.indexOf('match /bookings'));
      expect(parent).toMatch(/affectedKeys\(\)\s*\.\s*hasOnly\s*\(\s*\[\s*'currentBookings'/);
      expect(parent).toMatch(/'updatedAt'/);
    });

    it('isAdminEmail bypass still exists for catalog edits', () => {
      const parent = block.slice(0, block.indexOf('match /bookings'));
      expect(parent).toMatch(/allow update:[\s\S]*isAdminEmail\(\)[\s\S]*?\|\|/);
    });
  });

  describe('WC8 — tours/bookings create gate', () => {
    const block = blockFor('/tours/{tourId}');
    const sub = block.slice(block.indexOf('match /bookings/{bookingId}'));

    it("forces status == 'pending' on client create", () => {
      expect(sub).toMatch(/request\.resource\.data\.status\s*==\s*'pending'/);
    });

    it('rejects amountUSD <= 0 on client create', () => {
      expect(sub).toMatch(/request\.resource\.data\.amountUSD\s+is\s+number/);
      expect(sub).toMatch(/request\.resource\.data\.amountUSD\s*>\s*0/);
    });
  });

  describe('WC9 — users field allowlist', () => {
    const block = blockFor('/users/{uid}');

    it('create enforces default loyalty values', () => {
      expect(block).toMatch(/request\.resource\.data\.tier\s*==\s*'Bronze'/);
      expect(block).toMatch(/request\.resource\.data\.tripCoins\s*==\s*0/);
      expect(block).toMatch(/request\.resource\.data\.totalSpentUSD\s*==\s*0/);
      expect(block).toMatch(/request\.resource\.data\.bookingCount\s*==\s*0/);
    });

    it('update allowlist excludes loyalty/financial fields', () => {
      const updateRule = block.match(/allow update:[\s\S]*?hasOnly\s*\(\s*\[([\s\S]*?)\]\s*\)/);
      expect(updateRule, 'update rule with hasOnly() must be present').not.toBeNull();
      const allowedFields = updateRule![1];
      // Must NOT contain sensitive fields.
      expect(allowedFields).not.toMatch(/'tier'/);
      expect(allowedFields).not.toMatch(/'tripCoins'/);
      expect(allowedFields).not.toMatch(/'totalSpentUSD'/);
      expect(allowedFields).not.toMatch(/'bookingCount'/);
      expect(allowedFields).not.toMatch(/'createdAt'/);
      // Should contain profile fields.
      expect(allowedFields).toMatch(/'displayName'/);
      expect(allowedFields).toMatch(/'photoURL'/);
    });

    it('delete is locked off', () => {
      expect(block).toMatch(/allow delete:\s*if\s+false/);
    });
  });

  describe('H20 — plans update field allowlist', () => {
    const block = blockFor('/plans/{planId}');

    it('update is restricted to user-controlled fields', () => {
      const updateRule = block.match(/allow update:[\s\S]*?hasOnly\s*\(\s*\[([\s\S]*?)\]\s*\)/);
      expect(updateRule, 'update rule with hasOnly() must be present').not.toBeNull();
      const allowedFields = updateRule![1];
      // Server-computed fields must NOT be in the allowlist.
      expect(allowedFields).not.toMatch(/'quality'/);
      expect(allowedFields).not.toMatch(/'priceKRW'/);
      expect(allowedFields).not.toMatch(/'priceUSD'/);
      expect(allowedFields).not.toMatch(/'vehicle'/);
      expect(allowedFields).not.toMatch(/'itinerary'/);
      // Allowed: visibility/labels.
      expect(allowedFields).toMatch(/'isPublic'/);
    });

    it('uid stay-the-same predicate still present', () => {
      expect(block).toMatch(/request\.resource\.data\.uid\s*==\s*resource\.data\.uid/);
    });
  });

  describe('catch-all default-deny preserved', () => {
    it('rules end without a `match /{document=**}` wildcard allow', () => {
      // PR #420 must not regress the prior catch-all removal.
      expect(rules).not.toMatch(/match\s+\/\{document=\*\*\}[\s\S]*?allow\s+read,\s*write:\s*if\s+true/);
    });
  });
});
