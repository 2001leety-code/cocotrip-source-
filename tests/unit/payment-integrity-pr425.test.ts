/**
 * PR #425 — Audit CY1 + CY2 + CY5 regression slot.
 *
 * Three payment-integrity bugs that all silently lost money or trapped
 * the user before this PR:
 *   - CY1: used_paypal_orders non-atomic check-then-set + locked the
 *          orderID before capture, so a capture failure stranded the
 *          user (retry → DUPLICATE_ORDER) and a race let two simultaneous
 *          requests both pass the existence check.
 *   - CY2: amountKRW was never stored, so cancelBooking.js computed
 *          refundKRW=0 and the customer's mypage showed "₩0 refunded".
 *   - CY5: admin mark-refunded set Firestore status='REFUNDED' and sent
 *          the refund email — but never called PayPal /captures/{id}/refund.
 *          Customers thought they'd been refunded; the money stayed.
 *
 * These are static-shape assertions over the source — full integration
 * tests would need PayPal sandbox + Firestore emulator which are out of
 * scope for fast vitest CI. The shape checks catch the original bug
 * pattern AND any future refactor that drops the safeguards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const capture = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
const adminAction = readFileSync(
  resolve(process.cwd(), 'api/admin-booking-action.js'),
  'utf8',
);
const cancel = readFileSync(
  resolve(process.cwd(), 'api/cancelBooking.js'),
  'utf8',
);
const paypalRefund = readFileSync(
  resolve(process.cwd(), 'api/_shared/paypal-refund.js'),
  'utf8',
);

describe('PR #425 CY1 — capturePaypalOrder lock is transactional + releasable', () => {
  it('lock acquire uses runTransaction (race-safe)', () => {
    // Must wrap the used_paypal_orders read+write in runTransaction so two
    // concurrent capture requests can't both pass the check.
    const lockSection = capture.match(/used_paypal_orders[\s\S]{0,1200}/);
    expect(lockSection, 'used_paypal_orders block must exist').not.toBeNull();
    expect(lockSection![0]).toMatch(/runTransaction/);
  });

  it('lock is released on capture failure (no permanent lockout)', () => {
    // After a capture exception we must delete (or invalidate) the lock so
    // a retry can succeed. The "stale pending" allowance also works.
    expect(capture).toMatch(/lockRef\.delete\(\)/);
  });

  it('lock is upgraded to status=captured on success', () => {
    expect(capture).toMatch(/status:\s*['"]captured['"]/);
  });
});

describe('PR #425 CY2 — capturePaypalOrder persists amountKRW', () => {
  it('computes amountKRW from amountUSD and exchange rate env vars', () => {
    expect(capture).toMatch(/KRW_USD_RATE|VITE_USD_KRW_RATE/);
    expect(capture).toMatch(/amountKRW\s*=\s*Math\.round\(/);
  });

  it('writes amountKRW into the booking document', () => {
    // Check that amountKRW appears in the bookings.set({...}) payload.
    expect(capture).toMatch(/amountKRW,?\s*\n/);
  });
});

describe('PR #425 CY5 — admin mark-refunded calls PayPal API when captureID present', () => {
  it('imports refundPaypalCapture from shared helper', () => {
    expect(adminAction).toMatch(/from\s+['"]\.\/_shared\/paypal-refund\.js['"]/);
  });

  it('invokes refundPaypalCapture inside the mark-refunded branch', () => {
    // Pull the mark-refunded section and assert the call appears there.
    const idx = adminAction.indexOf("action === 'mark-refunded'");
    expect(idx).toBeGreaterThan(-1);
    const section = adminAction.slice(idx, idx + 5000); // mark-refunded 섹션 전체 (가드 추가로 확장)
    expect(section).toMatch(/refundPaypalCapture\s*\(/);
  });

  it('aborts the Firestore update when PayPal refund fails', () => {
    // If PayPal refund fails we must NOT set status='REFUNDED' — otherwise
    // mypage/email say "refunded" but the money is still with the merchant
    // (exactly the CY5 production bug we are fixing).
    const idx = adminAction.indexOf("action === 'mark-refunded'");
    const section = adminAction.slice(idx, idx + 5000); // mark-refunded 섹션 전체 (가드 추가로 확장)
    expect(section).toMatch(/if\s*\(\s*!result\.ok\s*\)/);
    expect(section).toMatch(/return\s+res\.end\(JSON\.stringify\(_err/);
  });

  it('records refundSource=paypal-api vs manual on the Firestore doc', () => {
    const idx = adminAction.indexOf("action === 'mark-refunded'");
    const section = adminAction.slice(idx, idx + 5000); // mark-refunded 섹션 전체 (가드 추가로 확장)
    expect(section).toMatch(/refundSource:\s*['"]paypal-api['"]/);
    expect(section).toMatch(/refundSource:\s*['"]manual['"]/);
  });
});

describe('PR #425 — shared paypal-refund helper', () => {
  it('exposes refundPaypalCapture', () => {
    expect(paypalRefund).toMatch(/export\s+async\s+function\s+refundPaypalCapture/);
  });

  it('rejects calls without a captureID', () => {
    expect(paypalRefund).toMatch(/NO_CAPTURE_ID/);
  });

  it('classifies COMPLETED and PENDING as success', () => {
    expect(paypalRefund).toMatch(/COMPLETED.*PENDING|status\s*===\s*['"]COMPLETED['"]/s);
  });
});

describe('PR #425 — cancelBooking uses the shared helper', () => {
  it('imports refundPaypalCapture and no longer fetches PayPal directly', () => {
    expect(cancel).toMatch(/from\s+['"]\.\/_shared\/paypal-refund\.js['"]/);
    // The old direct fetch('...v2/payments/captures/...') call inside
    // cancelBooking.js is gone (now lives only in paypal-refund.js). Doc
    // comments mentioning the URL are fine — we only flag executable lines.
    const codeLines = cancel
      .split('\n')
      .filter((l) => {
        const trimmed = l.trim();
        // Skip doc/comment lines.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
        return l.includes('v2/payments/captures');
      });
    expect(codeLines.length, 'PayPal capture URL should only appear via the shared helper, never in raw fetch()').toBe(0);
  });
});
