/**
 * PR #431 — Audit Y-H6 regression slot.
 *
 * api/paypal-webhook.js used a hard-coded fallback rate of 1380 KRW/USD
 * when the env vars (KRW_USD_RATE / VITE_USD_KRW_RATE) were unset and
 * the pending booking didn't carry a priceUSD. The active policy rate
 * is 1430 (src/data/pricing_spec.json:policy_krw_per_usd) so the stale
 * 1380 produced a ~3.5 % expected-USD undershoot. Legit refund
 * webhooks where amount was within the user-side tolerance got logged
 * as `amount_mismatch` and routed to the operator's queue.
 *
 * Same env precedence as capturePaypalOrder.js (PR #425):
 *   KRW_USD_RATE > VITE_USD_KRW_RATE > 1430 default.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/paypal-webhook.js'),
  'utf8',
);

describe('PR #431 Y-H6 — paypal-webhook default rate aligned with policy (1430)', () => {
  it('no leftover 1380 hardcoded constant', () => {
    // 1380 was the launch-era stale value. Search must not find it as a
    // standalone numeric literal (we allow it inside comments-only lines).
    const codeOnly = src
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      })
      .join('\n');
    expect(codeOnly).not.toMatch(/\b1380\b/);
  });

  it('amount-mismatch branch reads env with proper precedence then defaults to 1430', () => {
    // The expectedUSD calculation now reaches for KRW_USD_RATE first,
    // VITE_USD_KRW_RATE as alias, and only falls back to 1430.
    expect(src).toMatch(/Number\(\s*process\.env\.KRW_USD_RATE\s*\)/);
    expect(src).toMatch(/Number\(\s*process\.env\.VITE_USD_KRW_RATE\s*\)/);
    expect(src).toMatch(/\|\|\s*1430/);
  });

  it('refund branch uses the same env precedence + 1430 default', () => {
    // Two distinct call sites; both should now compute usdToKrw the same
    // way. Lazy check: file contains at least two occurrences of the
    // KRW_USD_RATE env read (one per branch).
    const matches = src.match(/Number\(\s*process\.env\.KRW_USD_RATE\s*\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
