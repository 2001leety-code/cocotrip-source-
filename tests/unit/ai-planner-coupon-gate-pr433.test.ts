/**
 * PR #433 — Audit Y-H10 regression slot.
 *
 * Pre-fix: `/api/createPaypalOrder` rejected `productType.startsWith('ai_planner')`
 * + coupon, but `/api/capturePaypalOrder` did not. PayPal Smart Buttons
 * can create orders client-side OR through a non-blocking path; an
 * attacker could capture-time submit `product='ai_planner_full'` with
 * a `couponDocId` and (a) burn a coupon for an AI plan that should be
 * full-price OR (b) record a booking as ai_planner at a charter
 * discounted price (if PayPal order was created at the discounted
 * charter price under a different product type).
 *
 * Post-fix: shared `api/_shared/ai-planner-policy.js` exposes
 * `checkAiPlannerCouponPolicy({product, promoCode, couponDocId})`.
 * Both endpoints call it; createPaypalOrder uses `productType`,
 * capturePaypalOrder uses `product` (same body key as legacy). The
 * policy module is the single source of truth — change it once when
 * the operator policy changes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isAiPlannerProduct,
  checkAiPlannerCouponPolicy,
} from '../../api/_shared/ai-planner-policy.js';

const createSrc = readFileSync(
  resolve(process.cwd(), 'api/createPaypalOrder.js'),
  'utf8',
);
const captureSrc = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);

describe('PR #433 Y-H10 — ai-planner-policy helper', () => {
  it('isAiPlannerProduct recognizes hyphen and underscore variants', () => {
    expect(isAiPlannerProduct('ai_planner_full')).toBe(true);
    expect(isAiPlannerProduct('ai-planner-full')).toBe(true);
    expect(isAiPlannerProduct('AI-Planner-Quick')).toBe(true);
    expect(isAiPlannerProduct('ai_planner_quick')).toBe(true);
  });

  it('isAiPlannerProduct returns false for non-planner products', () => {
    expect(isAiPlannerProduct('charter_seoul_city')).toBe(false);
    expect(isAiPlannerProduct('tour-package_a')).toBe(false);
    expect(isAiPlannerProduct('airport_seoul_central')).toBe(false);
    expect(isAiPlannerProduct('')).toBe(false);
    expect(isAiPlannerProduct(undefined)).toBe(false);
    expect(isAiPlannerProduct(null)).toBe(false);
  });

  it('checkAiPlannerCouponPolicy allows AI planner WITHOUT coupon', () => {
    expect(checkAiPlannerCouponPolicy({ productType: 'ai_planner_full' }).ok).toBe(true);
    expect(checkAiPlannerCouponPolicy({ product: 'ai-planner-quick' }).ok).toBe(true);
  });

  it('checkAiPlannerCouponPolicy allows non-AI products WITH coupon', () => {
    expect(checkAiPlannerCouponPolicy({ productType: 'charter_seoul_city', promoCode: 'EARLY50' }).ok).toBe(true);
    expect(checkAiPlannerCouponPolicy({ product: 'tour-package_a', couponDocId: 'cpn123' }).ok).toBe(true);
  });

  it('checkAiPlannerCouponPolicy REJECTS AI planner + promoCode', () => {
    const r = checkAiPlannerCouponPolicy({ productType: 'ai_planner_full', promoCode: 'EARLY50' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe('AI_PLANNER_NO_COUPON');
    }
  });

  it('checkAiPlannerCouponPolicy REJECTS AI planner + couponDocId', () => {
    const r = checkAiPlannerCouponPolicy({ product: 'ai-planner-full', couponDocId: 'cpn123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('AI_PLANNER_NO_COUPON');
  });

  it('accepts either `product` or `productType` key (capture uses `product`, create uses `productType`)', () => {
    const a = checkAiPlannerCouponPolicy({ product: 'ai_planner_full', promoCode: 'X' });
    const b = checkAiPlannerCouponPolicy({ productType: 'ai_planner_full', promoCode: 'X' });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });
});

describe('PR #433 Y-H10 — endpoint wire-up', () => {
  it('createPaypalOrder imports + calls the policy helper', () => {
    expect(createSrc).toMatch(
      /import\s*\{[^}]*checkAiPlannerCouponPolicy[^}]*\}\s*from\s*['"]\.\/_shared\/ai-planner-policy\.js['"]/,
    );
    expect(createSrc).toMatch(/checkAiPlannerCouponPolicy\s*\(/);
  });

  it('capturePaypalOrder imports + calls the policy helper', () => {
    expect(captureSrc).toMatch(
      /import\s*\{[^}]*checkAiPlannerCouponPolicy[^}]*\}\s*from\s*['"]\.\/_shared\/ai-planner-policy\.js['"]/,
    );
    expect(captureSrc).toMatch(/checkAiPlannerCouponPolicy\s*\(/);
  });

  it('capturePaypalOrder gate runs BEFORE the coupon pre-lock (no wasted Firestore writes)', () => {
    const gateIdx = captureSrc.indexOf('checkAiPlannerCouponPolicy(');
    const couponLockIdx = captureSrc.indexOf('couponLockRef');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(couponLockIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(couponLockIdx);
  });

  it('neither endpoint hardcodes the ai_planner startsWith check anymore (regression guard)', () => {
    // If someone re-inlines startsWith('ai_planner') + coupon check, the helper drifts.
    // We allow startsWith for the cutoff branch (non-coupon use), so the guard is
    // tied to coupon/promo neighborhood specifically.
    const inlineCreate = /startsWith\(\s*['"]ai_planner['"]\s*\)\s*&&\s*\(?\s*(promoCode|couponDocId)/;
    const inlineCapture = /startsWith\(\s*['"]ai_planner['"]\s*\)\s*&&\s*\(?\s*(promoCode|couponDocId)/;
    expect(createSrc).not.toMatch(inlineCreate);
    expect(captureSrc).not.toMatch(inlineCapture);
  });
});
