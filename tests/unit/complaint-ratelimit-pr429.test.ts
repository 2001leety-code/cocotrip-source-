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
 *
 * PR #432 (Audit W-H13) — moved the rate-limit helper to
 * `api/_shared/ip-rate-limit.js` so manual-payment-request can reuse it.
 * The behavioral assertions here now target the shared helper, while the
 * endpoint-side assertions confirm the endpoint *uses* the helper before
 * any side effects (Firestore write, Telegram notify).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/submit-plan-complaint.js'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/ip-rate-limit.js'),
  'utf8',
);
const rules = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #429 WC10 — shared IP rate-limit helper behavior', () => {
  it('extracts client IP from x-forwarded-for / x-real-ip / socket', () => {
    expect(helperSrc).toMatch(/x-forwarded-for/i);
    expect(helperSrc).toMatch(/x-real-ip/i);
    expect(helperSrc).toMatch(/remoteAddress/);
  });

  it('hashes the IP before persistence (privacy)', () => {
    expect(helperSrc).toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
  });

  it('uses a Firestore transaction to increment the bucket race-safely', () => {
    // Otherwise two simultaneous requests both see count=4 and both pass.
    expect(helperSrc).toMatch(/db\.runTransaction\s*\(/);
  });

  it('returns 429 with Retry-After when the bucket is full', () => {
    expect(helperSrc).toMatch(/status:\s*429/);
    expect(helperSrc).toMatch(/retryAfterSec/);
  });

  it('fail-OPEN when Firestore is unavailable (no DoS via rate-limit infra)', () => {
    // The check should silently degrade when db is null or the transaction
    // throws — better to accept a complaint than to block real users.
    expect(helperSrc).toMatch(/degraded\s*:\s*true/);
  });
});

describe('PR #429 WC10 — submit-plan-complaint wires the helper correctly', () => {
  it('imports the shared helper (not an inline copy)', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*checkIpRateLimit[^}]*\}\s*from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/,
    );
  });

  it('calls checkIpRateLimit with collection=complaint_rate_limits and a per-IP cap ≤ 10', () => {
    // The exact number is a tuning choice; we just guard against the cap
    // being lifted to "unlimited" (or accidentally to 100+).
    const callMatch = src.match(/checkIpRateLimit\s*\(\s*\{[\s\S]*?\}\s*\)/);
    expect(callMatch, 'checkIpRateLimit invocation must exist').not.toBeNull();
    expect(callMatch![0]).toMatch(/collection\s*:\s*['"]complaint_rate_limits['"]/);
    const capMatch = callMatch![0].match(/maxRequests\s*:\s*(\d+)/);
    expect(capMatch, 'maxRequests must be passed explicitly').not.toBeNull();
    const value = Number(capMatch![1]);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(10);
  });

  it('rate-limit check runs BEFORE the Firestore write + Telegram notify', () => {
    const checkIdx = src.indexOf('checkIpRateLimit(');
    const addIdx = src.indexOf("collection('plan_complaints').add");
    const notifyIdx = src.indexOf("notify('booking'");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(addIdx);
    expect(checkIdx).toBeLessThan(notifyIdx);
  });

  it('429 response sets Retry-After header (so the client can back off)', () => {
    expect(src).toMatch(/Retry-After/);
    expect(src).toMatch(/RATE_LIMITED/);
  });
});

describe('PR #429 WC10 — Firestore rules lock down the rate-limit bucket', () => {
  it('complaint_rate_limits collection is server-only', () => {
    expect(rules).toMatch(/match\s+\/complaint_rate_limits\/\{key\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/);
  });
});
