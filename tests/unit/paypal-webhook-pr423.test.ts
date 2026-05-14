/**
 * PR #423 — Audit CZ6 regression slot.
 *
 * `api/paypal-webhook.js` was effectively broken: Vercel auto-parsed the
 * request body, then `readRawBody` JSON.stringify'd it back — producing a
 * canonical form that drifts from PayPal's signed bytes. PayPal's
 * verify-webhook-signature API returned FAILURE on every legitimate event,
 * so the "auto confirm via webhook" path silently never fired. Operators
 * had to mark-paid manually every time.
 *
 * Static check (no live PayPal call): assert the module exports
 * `config.api.bodyParser === false` and that readRawBody no longer
 * re-stringifies a parsed object. If a future refactor drops the bodyParser
 * disable, this test fires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/paypal-webhook.js'),
  'utf8',
);

describe('PR #423 — paypal-webhook raw body / signature regression', () => {
  it('disables Vercel auto bodyParser so PayPal-signed bytes survive', () => {
    // Pattern allows `bodyParser: false` either as a direct config object
    // entry or via `api: { bodyParser: false }`.
    expect(src).toMatch(/api\s*:\s*\{\s*bodyParser\s*:\s*false\s*\}/);
  });

  it('readRawBody no longer re-stringifies the parsed body', () => {
    // The original bug was a `return JSON.stringify(req.body)` branch.
    // If anyone adds it back, this test catches it.
    expect(src).not.toMatch(/return\s+JSON\.stringify\(\s*req\.body\s*\)/);
  });

  it('readRawBody reads the raw incoming stream', () => {
    // The fix relies on the stream-reading promise being the primary path.
    // Match either `req.on('data'` or `for await (...of req)` patterns.
    expect(src).toMatch(/req\.on\(\s*['"`]data['"`]/);
    expect(src).toMatch(/req\.on\(\s*['"`]end['"`]/);
  });

  it('still calls verify-webhook-signature with verified webhook_event', () => {
    expect(src).toMatch(/\/v1\/notifications\/verify-webhook-signature/);
    expect(src).toMatch(/verification_status/);
  });
});
