/**
 * PR #434 — Audit Y-H11 regression slot.
 *
 * Pre-fix: api/applyPromoCode.js's `checkGlobalPromoLimit` was a
 * read-only gate. Two readers both see `usedCount < maxUses` and both
 * pass → both proceed to PayPal → both reach capturePaypalOrder, which
 * had a transactional but cap-LESS increment:
 *   tx.set(ref, { usedCount: cur + 1 })
 * → over-limit `usedCount` (e.g. 60/50 for EARLY50) with 10 unauthorized
 * 20% discounts handed out.
 *
 * Post-fix: api/_shared/global-promo.js exposes incrementGlobalPromoUsage
 * which runs cap-check + increment in one transaction (reads both the
 * usage doc AND admin/global_promo_limits inside the tx). On
 * PROMO_LIMIT_EXCEEDED the caller (capturePaypalOrder) refunds the
 * already-captured PayPal payment and marks the booking REFUNDED.
 *
 * Defaults live ONLY in api/_shared/global-promo.js. applyPromoCode
 * imports `GLOBAL_PROMO_DEFAULTS` from there so the two endpoints can
 * never disagree about the EARLY50/COCO5/COCO10 cap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GLOBAL_PROMO_DEFAULTS,
  KNOWN_GLOBAL_PROMO_CODES,
  resolveGlobalPromoLimit,
} from '../../api/_shared/global-promo.js';

const captureSrc = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);
const applySrc = readFileSync(
  resolve(process.cwd(), 'api/applyPromoCode.js'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/global-promo.js'),
  'utf8',
);

describe('PR #434 Y-H11 — shared global-promo helper', () => {
  it('exposes the historical caps (EARLY50=50, COCO5=9999, COCO10=9999)', () => {
    expect(GLOBAL_PROMO_DEFAULTS.EARLY50.limit).toBe(50);
    expect(GLOBAL_PROMO_DEFAULTS.COCO5.limit).toBe(9999);
    expect(GLOBAL_PROMO_DEFAULTS.COCO10.limit).toBe(9999);
  });

  it('KNOWN_GLOBAL_PROMO_CODES enumerates exactly the three current codes', () => {
    expect(new Set(KNOWN_GLOBAL_PROMO_CODES)).toEqual(new Set(['EARLY50', 'COCO5', 'COCO10']));
  });

  it('resolveGlobalPromoLimit honours env override over default', async () => {
    const before = process.env.GLOBAL_PROMO_LIMIT_EARLY50;
    process.env.GLOBAL_PROMO_LIMIT_EARLY50 = '7';
    try {
      const v = await resolveGlobalPromoLimit({ code: 'EARLY50' });
      expect(v).toBe(7);
    } finally {
      if (before === undefined) delete process.env.GLOBAL_PROMO_LIMIT_EARLY50;
      else process.env.GLOBAL_PROMO_LIMIT_EARLY50 = before;
    }
  });

  it('resolveGlobalPromoLimit honours limitDocSnap (inside-tx path)', async () => {
    const snap = { exists: true, data: () => ({ EARLY50: 33 }) } as unknown as FirebaseFirestore.DocumentSnapshot;
    const v = await resolveGlobalPromoLimit({ code: 'EARLY50', limitDocSnap: snap });
    expect(v).toBe(33);
  });

  it('resolveGlobalPromoLimit falls back to hardcoded default when nothing else applies', async () => {
    delete process.env.GLOBAL_PROMO_LIMIT_EARLY50;
    const snap = { exists: false } as unknown as FirebaseFirestore.DocumentSnapshot;
    const v = await resolveGlobalPromoLimit({ code: 'EARLY50', limitDocSnap: snap });
    expect(v).toBe(50);
  });

  it('helper file exposes incrementGlobalPromoUsage with cap-check inside the transaction', () => {
    expect(helperSrc).toMatch(/export\s+async\s+function\s+incrementGlobalPromoUsage/);
    expect(helperSrc).toMatch(/runTransaction\s*\(/);
    expect(helperSrc).toMatch(/PROMO_LIMIT_EXCEEDED/);
    // The transaction must call tx.get TWICE (usage doc + admin limit doc) so
    // the cap resolution is consistent with the increment.
    const txMatches = helperSrc.match(/tx\.get\s*\(/g) || [];
    expect(txMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PR #434 Y-H11 — capturePaypalOrder wires the transactional cap-check + refund', () => {
  it('imports incrementGlobalPromoUsage from the shared helper', () => {
    expect(captureSrc).toMatch(
      /import\s*\{[^}]*incrementGlobalPromoUsage[^}]*\}\s*from\s*['"]\.\/_shared\/global-promo\.js['"]/,
    );
  });

  it('no longer carries the old cap-LESS increment pattern (regression guard)', () => {
    // Old pattern was: const cur = ...; tx.set(ref, { usedCount: cur + 1 }) with
    // NO `cur >= maxUses` guard in the same tx. We removed the inline block,
    // so cap-less inline increment of usedCount should be gone.
    const inlineCapless = /tx\.set\s*\([^)]*usedCount\s*:\s*cur\s*\+\s*1/s;
    expect(captureSrc).not.toMatch(inlineCapless);
  });

  it('refunds the PayPal capture when PROMO_LIMIT_EXCEEDED is returned', () => {
    // The helper returns { ok: false, code: 'PROMO_LIMIT_EXCEEDED' } so callers
    // can branch — the capture path must call refundPaypalCapture on that branch.
    expect(captureSrc).toMatch(/PROMO_LIMIT_EXCEEDED/);
    expect(captureSrc).toMatch(/refundPaypalCapture\s*\(/);
  });

  it('marks the booking as REFUNDED (or REFUND_PENDING) on the race path', () => {
    expect(captureSrc).toMatch(/refundReason\s*:\s*['"]PROMO_LIMIT_EXCEEDED['"]/);
    expect(captureSrc).toMatch(/['"]REFUNDED['"]|['"]REFUND_PENDING['"]/);
  });

  it('alerts the operator via notifyOperator on the race path', () => {
    // Existing notifyOperator import is reused; we just check the channel + reason
    // are wired.
    expect(captureSrc).toMatch(/notifyOperator\s*\(\s*['"]coupon-race['"]/);
  });
});

describe('PR #434 Y-H11 — applyPromoCode reuses the shared defaults (no drift)', () => {
  it('imports GLOBAL_PROMO_DEFAULTS from the shared helper instead of inlining its own table', () => {
    expect(applySrc).toMatch(
      /import\s*\{[^}]*GLOBAL_PROMO_DEFAULTS[^}]*\}\s*from\s*['"]\.\/_shared\/global-promo\.js['"]/,
    );
  });

  it('uses resolveGlobalPromoLimit (not a local copy)', () => {
    expect(applySrc).toMatch(/resolveGlobalPromoLimit\s*\(/);
  });

  it('does NOT redefine its own EARLY50 cap inline', () => {
    // If someone re-adds `EARLY50.*limit: 50` inline, the helper drifts.
    // The only line with that literal should be the import — guard by checking
    // that EARLY50 doesn't appear in the same line as a literal `limit:`.
    const inlineRedef = /EARLY50[^\n]*limit\s*:\s*\d+/;
    expect(applySrc).not.toMatch(inlineRedef);
  });
});
