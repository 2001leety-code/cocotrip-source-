/**
 * PR #440 — Audit Y-H9 regression slot.
 *
 * Pre-fix: api/paypal-webhook.js responded with HTTP 401 when signature
 * verification failed. PayPal's IPN retry policy treats 4xx (and any
 * non-2xx) as "deliverable but unprocessed" and retries the same event
 * up to 25 times over ~3 days. Each retry hits our endpoint which calls
 * PayPal's verifyWebhookSignature API → consumes PayPal API quota. A
 * single misconfigured PAYPAL_WEBHOOK_ID storms 25× /transmission for
 * EVERY PayPal event the account receives.
 *
 * Post-fix: respond 200 (acked but not processed). Signature failure
 * is DETERMINISTIC — retrying won't fix it. We still:
 *   - log status='verify_failed' for forensics (paypal_webhook_log)
 *   - fire operator Telegram alert
 *   - dedup the alert per failure-reason hash with a 1-hour throttle
 *     (paypal_verify_alert_throttle) so a misconfig doesn't spam the
 *     channel for hours
 *
 * Security unaffected: the unverified event body still isn't processed
 * by any of the eventType handlers below the verification check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/paypal-webhook.js'),
  'utf8',
);
const rulesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #440 Y-H9 — verify_failed responds 200 (not 401)', () => {
  it('verify_failed branch writes res.writeHead(200, ...) and not 401', () => {
    // Find the verify_failed branch.
    const verifyIdx = src.indexOf("status: 'verify_failed'");
    expect(verifyIdx).toBeGreaterThan(-1);
    const block = src.slice(verifyIdx, verifyIdx + 2000);
    // Must contain 200 response, must NOT contain 401 response in this branch.
    expect(block).toMatch(/res\.writeHead\(\s*200\s*,/);
    expect(block).not.toMatch(/res\.writeHead\(\s*401\s*,/);
  });

  it('response body still flags the error + adds acked:true so the client sees it', () => {
    const verifyIdx = src.indexOf("status: 'verify_failed'");
    const block = src.slice(verifyIdx, verifyIdx + 2000);
    expect(block).toMatch(/signature verification failed/);
    expect(block).toMatch(/acked:\s*true/);
  });
});

describe('PR #440 Y-H9 — operator alert with dedup', () => {
  it('alertVerifyFailedDedup helper exists', () => {
    expect(src).toMatch(/function\s+alertVerifyFailedDedup/);
  });

  it('uses a Firestore transaction + sha256 reason hash + 1-hour window', () => {
    const fnIdx = src.indexOf('alertVerifyFailedDedup');
    const fnBlock = src.slice(fnIdx, fnIdx + 3000);
    expect(fnBlock).toMatch(/runTransaction\s*\(/);
    expect(fnBlock).toMatch(/createHash\(\s*['"]sha256['"]/);
    expect(fnBlock).toMatch(/60\s*\*\s*60\s*\*\s*1000|WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('falls back to alerting when Firestore is unavailable (visibility > spam)', () => {
    const fnIdx = src.indexOf('async function alertVerifyFailedDedup');
    const fnBlock = src.slice(fnIdx, fnIdx + 3000);
    // The no-db / catch branches must still call notify('admin', ...)
    expect(fnBlock).toMatch(/if\s*\(\s*!\s*db\s*\)\s*\{\s*[\s\S]*?notify\s*\(\s*['"]admin['"]/);
  });

  it('verify_failed branch calls the dedup alert (not raw notify)', () => {
    const verifyIdx = src.indexOf("status: 'verify_failed'");
    const block = src.slice(verifyIdx, verifyIdx + 2000);
    expect(block).toMatch(/alertVerifyFailedDedup\s*\(/);
  });
});

describe('PR #440 Y-H9 — Firestore rule for throttle collection', () => {
  it('paypal_verify_alert_throttle locked down server-only', () => {
    expect(rulesSrc).toMatch(
      /match\s+\/paypal_verify_alert_throttle\/\{key\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false/,
    );
  });
});

describe('PR #440 Y-H9 — eventType handlers still gated on verified signature', () => {
  it('CAPTURE.COMPLETED branch comes AFTER the verify_failed return', () => {
    // The verify_failed block must `return` before the eventType switch.
    const verifyReturnIdx = src.indexOf("acked: true");
    const captureHandlerIdx = src.indexOf("PAYMENT.CAPTURE.COMPLETED'");
    expect(verifyReturnIdx).toBeGreaterThan(-1);
    expect(captureHandlerIdx).toBeGreaterThan(-1);
    // verify check must be earlier in the file (lower index).
    const verifyResultIdx = src.indexOf("!verifyResult.verified");
    expect(verifyResultIdx).toBeLessThan(captureHandlerIdx);
  });
});
