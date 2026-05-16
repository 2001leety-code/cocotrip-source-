/**
 * PR #432 — Audit W-H13 regression slot.
 *
 * Pre-fix: api/manual-payment-request.js had no auth gate (anonymous
 * users may submit a manual PayPal QR payment claim) and NO rate limit
 * either. Every accepted POST writes a `pending_bookings/{ref}` doc and
 * fires a Telegram message on the operator's `booking` channel. The
 * same blast radius as plan complaints (PR #429 / WC10) plus a much
 * worse signal-to-noise hit on the channel that the operator uses to
 * confirm real payments.
 *
 * Post-fix: per-IP token bucket (3 req / 1h rolling window) on a fresh
 * `manual_payment_rate_limits` collection, backed by the shared helper
 * `api/_shared/ip-rate-limit.js`. Payment endpoints get a tighter cap
 * than complaints (3 vs 5) — a legit user typically submits one manual
 * claim. Anonymous flow preserved. Fail-OPEN on Firestore outage so
 * real users don't get locked out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/manual-payment-request.js'),
  'utf8',
);
const rules = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #432 W-H13 — manual-payment-request wires the shared IP rate-limit helper', () => {
  it('imports checkIpRateLimit + getClientIp from the shared helper', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*checkIpRateLimit[^}]*\}\s*from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*getClientIp[^}]*\}\s*from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/,
    );
  });

  it('calls checkIpRateLimit on the manual_payment_rate_limits collection', () => {
    const callMatch = src.match(/checkIpRateLimit\s*\(\s*\{[\s\S]*?\}\s*\)/);
    expect(callMatch, 'checkIpRateLimit invocation must exist').not.toBeNull();
    expect(callMatch![0]).toMatch(/collection\s*:\s*['"]manual_payment_rate_limits['"]/);
  });

  it('cap is tighter than complaints (3) and at most 5 (sanity)', () => {
    const callMatch = src.match(/checkIpRateLimit\s*\(\s*\{[\s\S]*?\}\s*\)/);
    expect(callMatch).not.toBeNull();
    const capMatch = callMatch![0].match(/maxRequests\s*:\s*(\d+)/);
    expect(capMatch, 'maxRequests must be explicit').not.toBeNull();
    const value = Number(capMatch![1]);
    // Payment endpoints are higher-impact than complaints — keep tight.
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(5);
  });

  it('rate-limit check runs BEFORE pending_bookings write + Telegram notify', () => {
    const rateIdx = src.indexOf('checkIpRateLimit(');
    const writeIdx = src.indexOf("collection('pending_bookings')");
    const notifyIdx = src.indexOf("notify('booking'");
    expect(rateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(-1);
    // The write to pending_bookings actually goes through `docRef.set` —
    // confirm by docRef.set position instead if needed.
    const docSetIdx = src.indexOf('docRef.set(');
    expect(docSetIdx).toBeGreaterThan(-1);
    expect(rateIdx).toBeLessThan(docSetIdx);
    expect(rateIdx).toBeLessThan(notifyIdx);
  });

  it('429 response sets Retry-After header and RATE_LIMITED code', () => {
    expect(src).toMatch(/Retry-After/);
    expect(src).toMatch(/RATE_LIMITED/);
  });

  it('does NOT contain an inline createHash copy of the helper (regression guard)', () => {
    // If someone re-inlines the rate-limit logic, the shared helper drifts.
    // The endpoint file should rely entirely on the helper import.
    expect(src).not.toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
  });
});

describe('PR #432 W-H13 — Firestore rules lock down the rate-limit bucket', () => {
  it('manual_payment_rate_limits collection is server-only', () => {
    expect(rules).toMatch(
      /match\s+\/manual_payment_rate_limits\/\{key\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false/,
    );
  });
});
