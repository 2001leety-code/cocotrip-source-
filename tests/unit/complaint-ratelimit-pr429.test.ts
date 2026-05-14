/**
 * PR #429 — Audit WC10 regression slot.
 *
 * Pre-fix: api/submit-plan-complaint.js had no auth gate (intentional —
 * anonymous complaints are part of the learning-loop UX) AND no IP rate
 * limit. Every accepted POST writes a Firestore doc AND sends a
 * Telegram message to the operator's `booking` channel. A trivial loop
 * from one machine could (a) spam the operator's Telegram chat into
 * unusable noise, (b) burn through Firestore write quota, (c) write
 * unbounded entries into the `plan_complaints` collection.
 *
 * Post-fix: per-IP token bucket (5 req / 1h rolling window) backed by
 * Firestore transactions. Anonymous flow preserved. If Firestore is
 * down we fail OPEN so real users can still submit complaints during
 * an outage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/submit-plan-complaint.js'),
  'utf8',
);
const rules = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #429 WC10 — submit-plan-complaint has an IP rate limit', () => {
  it('extracts client IP from x-forwarded-for / x-real-ip / socket', () => {
    expect(src).toMatch(/x-forwarded-for/i);
    expect(src).toMatch(/x-real-ip/i);
    expect(src).toMatch(/remoteAddress/);
  });

  it('hashes the IP before persistence (privacy)', () => {
    // We do not retain plaintext IPs. The doc id must come from a hash.
    expect(src).toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
  });

  it('uses a Firestore transaction to increment the bucket race-safely', () => {
    // Otherwise two simultaneous requests both see count=4 and both pass.
    expect(src).toMatch(/db\.runTransaction\s*\(/);
  });

  it('enforces a per-IP cap of at most 10/hour', () => {
    // The exact number is a tuning choice; we just guard against the cap
    // being lifted to "unlimited" (or accidentally to 100+).
    const m = src.match(/RATE_LIMIT_MAX\s*=\s*(\d+)/);
    expect(m, 'RATE_LIMIT_MAX must be defined').not.toBeNull();
    const value = Number(m![1]);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(10);
  });

  it('rate-limit window is exactly one hour', () => {
    expect(src).toMatch(/RATE_LIMIT_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('returns 429 with Retry-After when the bucket is full', () => {
    expect(src).toMatch(/status:\s*429/);
    expect(src).toMatch(/Retry-After/);
    expect(src).toMatch(/RATE_LIMITED/);
  });

  it('checkRateLimit runs BEFORE the Firestore write + Telegram notify', () => {
    const checkIdx = src.indexOf('checkRateLimit(');
    const addIdx = src.indexOf("collection('plan_complaints').add");
    const notifyIdx = src.indexOf("notify('booking'");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(addIdx);
    expect(checkIdx).toBeLessThan(notifyIdx);
  });

  it('fail-OPEN when Firestore is unavailable (no DoS via rate-limit infra)', () => {
    // The check should silently degrade when db is null or the transaction
    // throws — better to accept a complaint than to block real users.
    expect(src).toMatch(/degraded\s*:\s*true/);
  });
});

describe('PR #429 WC10 — Firestore rules lock down the rate-limit bucket', () => {
  it('complaint_rate_limits collection is server-only', () => {
    expect(rules).toMatch(/match\s+\/complaint_rate_limits\/\{key\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
  });
});
